/**
 * Changing the payment terms of an invoice that's already with the client:
 * more time, installments, or a date the client promises to pay by.
 *
 * The agent calls these from the client page when your mandate allows it, and you call them
 * when you approve a client's request. Either way the order is the same: change PayPal first,
 * then our copy (on the freshest stored version), then write the activity log.
 * None of these can change what the client owes in total.
 */
import type { Clause, Milestone } from '../../types'

const DAY = 86_400_000

export interface By {
  actor: 'agent' | 'you'
  /** The mandate clause that allowed it, when the agent acted on its own. */
  clause?: Clause
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function assertOpen(m: Milestone) {
  if (m.status !== 'sent' || !m.invoiceId) {
    throw createError({ statusCode: 409, statusMessage: `${m.invoiceNumber ?? m.name} isn't an unpaid invoice, so its terms can't change.` })
  }
}

function assertDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
    throw createError({ statusCode: 400, statusMessage: `"${iso}" isn't a date (use YYYY-MM-DD).` })
  }
}

/** How many days later than now-or-the-due-date (whichever is later) `newDueDate` is. */
export function extraDays(m: Milestone, newDueDate: string, now = Date.now()) {
  const target = Date.parse(`${newDueDate}T00:00:00Z`)
  const due = m.dueDate ? Date.parse(`${m.dueDate}T00:00:00Z`) : startOfDay(now)
  return Math.round((target - Math.max(due, startOfDay(now))) / DAY)
}

/** Move the due date on PayPal. PayPal emails the client the updated invoice. */
export async function extendDueDate(projectId: string, milestoneId: string, newDueDate: string, by: By) {
  assertDate(newDueDate)
  const project = await getProject(projectId)
  const m = findMilestone(project, milestoneId)
  assertOpen(m)
  const extra = extraDays(m, newDueDate)
  if (extra < 1) {
    throw createError({ statusCode: 400, statusMessage: `${dayLabel(newDueDate)} isn't later than the current due date.` })
  }
  if (extra > 90) throw createError({ statusCode: 400, statusMessage: 'Due dates can move at most 90 days.' })

  progress(projectId, `Moving the due date of invoice ${m.invoiceNumber} on PayPal`)
  const invoice = await updateInvoiceDueDate(m.invoiceId!, newDueDate)

  await mutateProject(projectId, (p) => {
    const mm = findMilestone(p, milestoneId)
    // PayPal and Paylane agree on the date again, even if demo mode had moved ours.
    mm.demoBackdated = false
    applyInvoiceState(mm, invoice)
    mm.dueDate = newDueDate
    mm.extendedDays = (mm.extendedDays ?? 0) + extra
    delete mm.promise
  })
  await logActivity(
    by.actor,
    by.actor === 'agent'
      ? `Gave ${project.client.name} ${plural(extra, 'more day')} to pay ${m.invoiceNumber}, now due ${dayLabel(newDueDate)}. They asked on the client page. PayPal sent them the updated invoice.`
      : `Approved ${project.client.name}'s request: ${m.invoiceNumber} is now due ${dayLabel(newDueDate)}. PayPal sent them the updated invoice.`,
    projectId,
    by.clause,
  )
  return { invoiceNumber: m.invoiceNumber!, newDueDate, extraDays: extra }
}

/**
 * Replace one unpaid invoice with `parts` installments two weeks apart, same total.
 * New invoices are created and sent before the original is cancelled, and a failure halfway
 * undoes whatever reached PayPal, so the client never sees a half-made split.
 */
export async function splitIntoInstallments(projectId: string, milestoneId: string, parts: number, by: By) {
  const project = await getProject(projectId)
  const original = findMilestone(project, milestoneId)
  assertOpen(original)
  if (original.installment) {
    throw createError({ statusCode: 409, statusMessage: `${original.invoiceNumber} is already an installment and can't be split again.` })
  }
  if (!Number.isInteger(parts) || parts < 2 || parts > 6) {
    throw createError({ statusCode: 400, statusMessage: 'An invoice can be split into 2 to 6 payments.' })
  }
  const cents = Math.round(original.amount * 100)
  if (cents < parts * 100) throw createError({ statusCode: 400, statusMessage: 'That invoice is too small to split.' })

  // Even parts in cents; any odd cent goes on the last one, so the total is exact.
  const base = Math.floor(cents / parts)
  const amounts = Array.from({ length: parts }, (_, i) => (i === parts - 1 ? cents - base * (parts - 1) : base) / 100)
  const today = startOfDay(Date.now())
  const currentDue = original.dueDate ? Date.parse(`${original.dueDate}T00:00:00Z`) : today
  const firstDue = Math.max(currentDue, today + 3 * DAY)

  const installments: Milestone[] = amounts.map((amount, i) => {
    const dueDate = isoDay(firstDue + i * 14 * DAY)
    return {
      id: newId(),
      name: `${original.name}, part ${i + 1} of ${parts}`,
      description: original.description,
      amount,
      trigger: original.trigger,
      dueDays: Math.max(0, Math.round((Date.parse(`${dueDate}T00:00:00Z`) - today) / DAY)),
      status: 'planned',
      reminders: [],
      installment: { of: original.id, index: i + 1, count: parts },
      dueDate,
    }
  })

  const { freelancer } = useRuntimeConfig()
  const first = freelancer.name.trim().split(/\s+/)[0]
  const sent: Milestone[] = []
  try {
    for (const [i, m] of installments.entries()) {
      progress(projectId, `Creating installment ${i + 1} of ${parts} on PayPal`)
      m.draftSubject = `Installment ${i + 1} of ${parts}: ${original.name}`
      m.draftNote = `Installment ${i + 1} of ${parts} for "${original.name}" on ${project.title}, due ${dayLabel(m.dueDate!)}. It replaces invoice ${original.invoiceNumber}; the total stays the same.`
      const invoice = await createDraftInvoice(project, m, withClientPageLink(m.draftNote, project), m.dueDate)
      m.invoiceId = invoice.id
      applyInvoiceState(m, invoice)
    }
    for (const [i, m] of installments.entries()) {
      progress(projectId, `Sending installment ${i + 1} of ${parts} through PayPal`)
      const note = `Hi ${project.client.name}, as agreed, here is installment ${i + 1} of ${parts} for "${original.name}": ${fmt(m.amount, project.currency)}, due ${dayLabel(m.dueDate!)}. It replaces invoice ${original.invoiceNumber}, and the total stays the same. Thanks, ${first}`
      const invoice = await sendInvoice(m.invoiceId!, m.draftSubject!, withClientPageLink(note, project))
      applyInvoiceState(m, invoice)
      m.sentAt = new Date().toISOString()
      sent.push(m)
    }
  } catch (err) {
    progress(projectId, 'Something went wrong on PayPal, undoing the split')
    for (const m of installments) {
      if (!m.invoiceId) continue
      const undo = sent.includes(m) ? cancelInvoice(m.invoiceId, 'Sent by mistake. Please ignore this one.', false) : deleteDraftInvoice(m.invoiceId)
      await undo.catch(() => undefined)
    }
    throw err
  }

  progress(projectId, `Cancelling the original invoice ${original.invoiceNumber}`)
  const numbers = installments.map((m) => m.invoiceNumber)
  const list = numbers.length > 1 ? `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}` : numbers[0]
  let cancelError = ''
  try {
    await cancelInvoice(original.invoiceId!, `Replaced by ${parts} installments: ${list}. The total stays the same.`)
  } catch (err: any) {
    cancelError = err?.statusMessage ?? err?.message ?? 'PayPal refused'
  }

  await mutateProject(projectId, (p) => {
    const o = findMilestone(p, milestoneId)
    if (!cancelError) o.status = 'cancelled'
    o.replacedBy = installments.map((m) => m.id)
    p.milestones.splice(p.milestones.indexOf(o) + 1, 0, ...installments)
  })
  const schedule = installments.map((m) => `${fmt(m.amount, project.currency)} by ${dayLabel(m.dueDate!)}`).join(', ')
  await logActivity(
    by.actor,
    by.actor === 'agent'
      ? `Split ${original.invoiceNumber} into ${parts} payments at ${project.client.name}'s request: ${schedule}. PayPal sent invoices ${list} and cancelled the original.`
      : `Approved ${project.client.name}'s request to pay ${original.invoiceNumber} in ${parts} parts: ${schedule}. PayPal sent invoices ${list}.`,
    projectId,
    by.clause,
  )
  if (cancelError) {
    await logActivity('agent', `Couldn't cancel the original ${original.invoiceNumber} on PayPal (${cancelError}). Cancel it from the ledger so the client isn't billed twice.`, projectId)
  }
  return {
    original: original.invoiceNumber!,
    installments: installments.map((m) => ({ invoiceNumber: m.invoiceNumber!, amount: m.amount, dueDate: m.dueDate! })),
  }
}

/** Promises can pause reminders for up to two weeks. Longer needs a real new due date. */
export const PROMISE_MAX_DAYS = 14

/** The client says they'll pay by `date`. Nothing changes on PayPal; reminders pause until then. */
export async function recordPromise(projectId: string, milestoneId: string, date: string, by: By) {
  assertDate(date)
  const project = await getProject(projectId)
  const m = findMilestone(project, milestoneId)
  assertOpen(m)
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - startOfDay(Date.now())) / DAY)
  if (days < 0) throw createError({ statusCode: 400, statusMessage: 'That date has already passed.' })
  if (days > PROMISE_MAX_DAYS) throw createError({ statusCode: 400, statusMessage: `Promises can be at most ${PROMISE_MAX_DAYS} days out.` })

  await mutateProject(projectId, (p) => {
    findMilestone(p, milestoneId).promise = { date, at: new Date().toISOString() }
  })
  await logActivity(
    by.actor,
    `Noted that ${project.client.name} will pay ${m.invoiceNumber} by ${dayLabel(date)}. Reminders are paused until then.`,
    projectId,
  )
  return { invoiceNumber: m.invoiceNumber!, date }
}
