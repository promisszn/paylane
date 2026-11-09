/**
 * Glue between the agent, PayPal and the local store.
 * This is where "you decide what the agent may do" lives:
 *   - prepareDraft() may create a PayPal DRAFT (invisible to the client)
 *   - approveAndSend() emails an invoice, and only runs from a route you click
 *   - anything the agent does on its own is checked against your mandate first (mandate.ts)
 */
import type { ClientRequest, Mandate, Milestone, NextAction, Project, ReceivableRow } from '../../types'
import type { PayPalInvoice } from './paypal'

const DAY = 86_400_000

export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY
/** "19 Nov", the format the ledger and the activity log use. */
export const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

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

// ---------------------------------------------------------------------------
// The client page link that goes out with every invoice and reminder
// ---------------------------------------------------------------------------

/** Where this app is reachable. Render sets RENDER_EXTERNAL_URL; PUBLIC_URL overrides it. */
export function publicBaseUrl() {
  const fromEnv = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return `http://localhost:${process.env.PORT || process.env.NITRO_PORT || 3000}`
}

export function clientPageUrl(project: Project) {
  return project.portalToken ? `${publicBaseUrl()}/pay/${project.portalToken}` : null
}

/** The last line of every invoice and reminder email. Shown in the review dialog too. */
export function clientPageLine(project: Project) {
  const url = clientPageUrl(project)
  return url ? `Questions, or need more time to pay? Ask my assistant: ${url}` : ''
}

export function withClientPageLink(note: string, project: Project) {
  const line = clientPageLine(project)
  return line && !note.includes(line) ? `${note.trim()}\n\n${line}`.slice(0, 4000) : note
}

// ---------------------------------------------------------------------------
// Drafting and sending (the human checkpoints)
// ---------------------------------------------------------------------------

/** Create the PayPal draft and let the agent write the email. Safe: the client sees nothing yet. */
export async function prepareDraft(project: Project, milestone: Milestone) {
  if (!project.client.email) {
    throw createError({ statusCode: 400, statusMessage: 'Add the client email before creating an invoice.' })
  }
  const email = await draftInvoiceEmail(project, milestone)
  milestone.draftSubject = email.subject
  milestone.draftNote = email.note

  if (!milestone.invoiceId) {
    const invoice = await createDraftInvoice(project, milestone, withClientPageLink(email.note, project))
    milestone.invoiceId = invoice.id
    applyInvoiceState(milestone, invoice)
  }
  milestone.status = 'draft'
  await logActivity('agent', `Drafted invoice ${milestone.invoiceNumber} for "${milestone.name}" and wrote the email. Waiting for your approval.`, project.id)
}

/** The only path that emails a client an invoice you drafted. Called after you click Send. */
export async function approveAndSend(project: Project, milestone: Milestone, subject: string, note: string) {
  if (!milestone.invoiceId) await prepareDraft(project, milestone)
  const invoice = await sendInvoice(milestone.invoiceId!, subject, withClientPageLink(note, project))
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
 * Demo mode: make a sent invoice `days` overdue right now, as if that much time had passed.
 * The whole invoice moves back together (sent date, reminders, promises), so the order of
 * events and the quiet period between reminders still hold.
 * Only our local copy changes. PayPal keeps the real due date, and sync leaves ours alone.
 */
export function backdateMilestone(m: Milestone, days: number, now = Date.now()) {
  // daysOverdue() counts from the end of the due day, so the due day is days + 1 back.
  const dueStart = startOfDay(now) - (days + 1) * DAY
  const oldDue = m.dueDate ? Date.parse(`${m.dueDate}T00:00:00Z`) : dueStart + m.dueDays * DAY
  const shift = oldDue - dueStart
  const back = (iso: string) => new Date(Date.parse(iso) - shift).toISOString()

  m.dueDate = isoDay(dueStart)
  m.sentAt = m.sentAt ? back(m.sentAt) : new Date(dueStart - m.dueDays * DAY).toISOString()
  for (const r of m.reminders) r.sentAt = back(r.sentAt)
  if (m.promise) m.promise = { date: isoDay(Date.parse(`${m.promise.date}T00:00:00Z`) - shift), at: back(m.promise.at) }
  m.demoBackdated = true
}

export function daysOverdue(m: Milestone, now = Date.now()) {
  if (m.status !== 'sent' || !m.dueDate) return 0
  const due = new Date(`${m.dueDate}T23:59:59Z`).getTime()
  return Math.max(0, Math.floor((now - due) / DAY))
}

/** The client promised a payment date that hasn't passed yet. Reminders wait for it. */
export function promiseActive(m: Milestone, now = Date.now()) {
  return Boolean(m.promise) && now <= new Date(`${m.promise!.date}T23:59:59Z`).getTime()
}

/** Late, no promise pending, and quiet for 3+ days since it was sent or last nudged. */
export function reminderDue(m: Milestone, now = Date.now()) {
  if (m.status !== 'sent' || !m.dueDate || daysOverdue(m, now) < 1 || promiseActive(m, now)) return false
  const lastNudge = m.reminders.at(-1)?.sentAt ?? m.sentAt
  const quietDays = lastNudge ? (now - new Date(lastNudge).getTime()) / DAY : Infinity
  return quietDays >= 3
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
      paidAt: m.status === 'paid' ? (m.paidAt ?? null) : null,
      dueDate: m.dueDate ?? null,
      daysOverdue: daysOverdue(m),
      reminders: m.reminders.length,
      payerUrl: m.payerUrl ?? null,
      clientPage: p.portalToken ? `/pay/${p.portalToken}` : null,
      extendedDays: m.extendedDays ?? 0,
      promiseDate: m.promise && promiseActive(m) ? m.promise.date : null,
      splitInto: m.replacedBy?.length ?? 0,
      installment: m.installment ? `${m.installment.index} of ${m.installment.count}` : null,
      wasAmount: m.adjusted?.from ?? null,
    })),
  )
}

/**
 * What the agent suggests doing next. Rules are deterministic on purpose,
 * so it's predictable what will be suggested. The AI only writes the words.
 * Reminders the mandate lets the agent send itself are left out: it sends them.
 */
export function nextActions(projects: Project[], requests: ClientRequest[] = [], mandate?: Mandate): NextAction[] {
  const actions: NextAction[] = []
  const now = Date.now()
  const byId = new Map(projects.map((p) => [p.id, p]))

  // A client is waiting on these, so they come first.
  for (const r of requests) {
    const p = byId.get(r.projectId)
    if (r.status !== 'open' || !p) continue
    // An ask about an invoice that has since been paid, split or cancelled no longer applies.
    if (r.kind !== 'other' && p.milestones.find((m) => m.id === r.milestoneId)?.status !== 'sent') continue
    actions.push({
      kind: 'client_request',
      projectId: p.id,
      milestoneId: r.milestoneId ?? '',
      requestId: r.id,
      requestKind: r.kind,
      title: r.summary,
      detail: r.reason,
      quote: r.quote,
    })
  }

  for (const p of projects) {
    // Bill the next on-completion milestone once every earlier milestone is settled.
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
      if (reminderDue(m, now)) {
        const late = daysOverdue(m, now)
        const tone = reminderTone(late, m.reminders.length)
        if (mandate && mayRemind(mandate, p, m, tone).ok && !m.autoRemindError) continue
        actions.push({
          kind: 'remind',
          projectId: p.id,
          milestoneId: m.id,
          title: `Remind ${p.client.name} about ${m.invoiceNumber}`,
          detail: m.autoRemindError
            ? `The agent couldn't send this on its own: ${m.autoRemindError}`
            : `${fmt(m.amount, p.currency)} is ${late} day${late === 1 ? '' : 's'} overdue${m.reminders.length ? `, ${m.reminders.length} reminder${m.reminders.length === 1 ? '' : 's'} sent` : ''}.`,
          tone,
        })
      }
    }

    const earlierSettled = nextUnbilled
      ? p.milestones.slice(0, p.milestones.indexOf(nextUnbilled)).every((m) => m.status === 'paid' || m.status === 'cancelled')
      : false
    if (nextUnbilled && earlierSettled) {
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
