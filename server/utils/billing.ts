/**
 * Glue between the agent, PayPal and the local store.
 * This is where the "human approves every money move" rule lives:
 *   - prepareDraft() may create a PayPal DRAFT (invisible to the client)
 *   - only approveAndSend() emails anything, and it is only called from a route the freelancer clicks
 */
import type { Milestone, NextAction, Project, ReceivableRow } from '../../types'
import type { PayPalInvoice } from './paypal'

const DAY = 86_400_000

/** Copy the PayPal-side truth onto our milestone. Returns true if it just became paid. */
export function applyInvoiceState(milestone: Milestone, invoice: PayPalInvoice): boolean {
  milestone.invoiceNumber = invoice.detail.invoice_number
  // A demo-backdated invoice keeps its local due date; PayPal still has the real one.
  if (!milestone.demoBackdated) milestone.dueDate = invoice.detail.payment_term?.due_date ?? milestone.dueDate
  milestone.payerUrl = invoice.detail.metadata?.recipient_view_url ?? milestone.payerUrl

  const wasPaid = milestone.status === 'paid'
  if (PAID_STATUSES.has(invoice.status)) {
    milestone.status = 'paid'
    milestone.paidAt ??= new Date().toISOString()
  } else if (invoice.status === 'CANCELLED') {
    milestone.status = 'cancelled'
  } else if (invoice.status === 'DRAFT') {
    milestone.status = 'draft'
  } else {
    milestone.status = 'sent'
  }
  return !wasPaid && milestone.status === 'paid'
}

/** Create the PayPal draft and let the agent write the email. Safe: the client sees nothing yet. */
export async function prepareDraft(project: Project, milestone: Milestone) {
  if (!project.client.email) {
    throw createError({ statusCode: 400, statusMessage: 'Add the client email before creating an invoice.' })
  }
  const email = await draftInvoiceEmail(project, milestone)
  milestone.draftSubject = email.subject
  milestone.draftNote = email.note

  if (!milestone.invoiceId) {
    const invoice = await createDraftInvoice(project, milestone, email.note)
    milestone.invoiceId = invoice.id
    applyInvoiceState(milestone, invoice)
  }
  milestone.status = 'draft'
  await logActivity('agent', `Drafted invoice ${milestone.invoiceNumber} for "${milestone.name}" and wrote the email. Waiting for your approval.`, project.id)
}

/** The only path that emails a client an invoice. Called after the freelancer clicks Send. */
export async function approveAndSend(project: Project, milestone: Milestone, subject: string, note: string) {
  if (!milestone.invoiceId) await prepareDraft(project, milestone)
  const invoice = await sendInvoice(milestone.invoiceId!, subject, note)
  applyInvoiceState(milestone, invoice)
  milestone.sentAt = new Date().toISOString()
  milestone.draftSubject = subject
  milestone.draftNote = note
  await logActivity('you', `Approved and sent invoice ${milestone.invoiceNumber} (${fmt(milestone.amount, project.currency)}) to ${project.client.name}.`, project.id)
}

/** Demo helpers only run on sandbox with DEMO_MODE=true, never against live PayPal. */
export function demoModeOn() {
  const { demoMode, paypal } = useRuntimeConfig()
  return Boolean(demoMode) && paypal.env === 'sandbox'
}

/**
 * Demo mode: move a sent invoice's due date back so it is `days` overdue right now.
 * Only our local copy changes. PayPal keeps the real due date, and sync leaves ours alone.
 */
export function backdateMilestone(m: Milestone, days: number, now = Date.now()) {
  const todayStart = Math.floor(now / DAY) * DAY
  // daysOverdue() counts from the end of the due day, so the due day is days + 1 back.
  const dueStart = todayStart - (days + 1) * DAY
  m.dueDate = new Date(dueStart).toISOString().slice(0, 10)
  // Keep "sent" before "due" so the timeline and the reminder-quiet-period rule still make sense.
  m.sentAt = new Date(dueStart - m.dueDays * DAY).toISOString()
  m.demoBackdated = true
}

export function daysOverdue(m: Milestone, now = Date.now()) {
  if (m.status !== 'sent' || !m.dueDate) return 0
  const due = new Date(`${m.dueDate}T23:59:59Z`).getTime()
  return Math.max(0, Math.floor((now - due) / DAY))
}

export const fmt = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

/** Flatten projects into rows for the AG Grid receivables table. */
export function toRows(projects: Project[]): ReceivableRow[] {
  return projects.flatMap((p) =>
    p.milestones.map((m) => ({
      projectId: p.id,
      milestoneId: m.id,
      client: p.client.name,
      project: p.title,
      milestone: m.name,
      amount: m.amount,
      currency: p.currency,
      status: m.status,
      trigger: m.trigger,
      invoiceNumber: m.invoiceNumber ?? null,
      sentAt: m.sentAt ?? null,
      dueDate: m.dueDate ?? null,
      daysOverdue: daysOverdue(m),
      reminders: m.reminders.length,
      payerUrl: m.payerUrl ?? null,
    })),
  )
}

/**
 * What the agent suggests doing next. Rules are deterministic on purpose,
 * so it's predictable what will be suggested. The AI only writes the words.
 */
export function nextActions(projects: Project[]): NextAction[] {
  const actions: NextAction[] = []
  const now = Date.now()

  for (const p of projects) {
    // Bill the next on-completion milestone once every earlier milestone is paid.
    const nextUnbilled = p.milestones.find((m) => m.status === 'planned' && m.trigger === 'on_completion')

    for (const m of p.milestones) {
      if (m.status === 'draft') {
        actions.push({
          kind: 'send_draft',
          projectId: p.id,
          milestoneId: m.id,
          title: `Send ${m.name} to ${p.client.name}`,
          detail: `${fmt(m.amount, p.currency)} invoice is drafted and ready. Review the email and send.`,
        })
      }
      if (m.status === 'sent' && m.dueDate) {
        const late = daysOverdue(m, now)
        const lastNudge = m.reminders.at(-1)?.sentAt ?? m.sentAt
        const quietDays = lastNudge ? (now - new Date(lastNudge).getTime()) / DAY : Infinity
        if (late > 0 && quietDays >= 3) {
          actions.push({
            kind: 'remind',
            projectId: p.id,
            milestoneId: m.id,
            title: `Remind ${p.client.name} about ${m.invoiceNumber}`,
            detail: `${fmt(m.amount, p.currency)} is ${late} day${late === 1 ? '' : 's'} overdue${m.reminders.length ? `, ${m.reminders.length} reminder(s) sent` : ''}.`,
          })
        }
      }
    }

    const earlierPaid = nextUnbilled
      ? p.milestones.slice(0, p.milestones.indexOf(nextUnbilled)).every((m) => m.status === 'paid')
      : false
    if (nextUnbilled && earlierPaid) {
      actions.push({
        kind: 'invoice_next',
        projectId: p.id,
        milestoneId: nextUnbilled.id,
        title: `Ready to bill "${nextUnbilled.name}"?`,
        detail: `Everything before it on ${p.title} is paid. Mark the work done and the agent drafts the invoice.`,
      })
    }
  }
  return actions
}
