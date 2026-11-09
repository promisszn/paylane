/**
 * One way in for every change you make to what a client owes, or when: a new amount, a later
 * due date, or a split into installments. The ledger's Change dialog calls it, and so does the
 * agent when you agree to something in a reply on the client page (followThrough.ts).
 *
 * Each change goes through the same functions as everything else (terms.ts), so PayPal is
 * updated first and the client gets PayPal's email for anything they've already been sent.
 */
import type { ChangeOutcome, ClientRequest, TermsChange } from '../../types'
import type { By } from './terms'

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })

/** Which open client requests a change answers, so they leave your suggestions once it's done. */
const ANSWERS: Record<TermsChange['kind'], ClientRequest['kind']> = { amount: 'other', due_date: 'extension', split: 'installments' }

export async function applyChange(projectId: string, change: TermsChange, by: By): Promise<ChangeOutcome> {
  const project = await getProject(projectId)
  const money = (n: number) => fmt(n, project.currency)
  const m = project.milestones.find((x) => x.id === change.milestoneId)
  const label = m ? (m.invoiceNumber ? `invoice ${m.invoiceNumber}` : m.name) : 'that payment'

  let outcome: ChangeOutcome
  try {
    if (change.kind === 'amount') {
      const r = await changeAmount(projectId, change.milestoneId, change.amount, by, change.note)
      const what = r.invoiceNumber ? `Invoice ${r.invoiceNumber} (${r.name})` : r.name
      outcome = {
        ok: true,
        text: `${what} is now ${money(r.amount)}, was ${money(r.before)}.`,
        clientText:
          `${what} is now ${money(r.amount)} instead of ${money(r.before)}.` +
          (r.status === 'sent' ? ' PayPal has emailed you the updated invoice.' : ''),
      }
    } else if (change.kind === 'due_date') {
      const r = await extendDueDate(projectId, change.milestoneId, change.dueDate, by)
      outcome = {
        ok: true,
        text: `Invoice ${r.invoiceNumber} is now due ${dayLabel(r.newDueDate)}.`,
        clientText: `Invoice ${r.invoiceNumber} is now due ${longDate(r.newDueDate)}. PayPal has emailed you the updated invoice.`,
      }
    } else {
      const r = await splitIntoInstallments(projectId, change.milestoneId, change.parts, by)
      const schedule = r.installments.map((i) => `${money(i.amount)} by ${longDate(i.dueDate)}`).join(', ')
      outcome = {
        ok: true,
        text: `Invoice ${r.original} is now ${r.installments.length} payments.`,
        clientText: `Invoice ${r.original} is now ${r.installments.length} payments: ${schedule}. PayPal has emailed you an invoice for each.`,
      }
    }
  } catch (err: any) {
    const why = err?.statusMessage ?? err?.message ?? 'unknown error'
    return { ok: false, text: `Couldn't change ${label}: ${why}` }
  }

  // The client's own ask about this payment is settled now.
  for (const r of await listRequests()) {
    if (r.projectId === projectId && r.status === 'open' && r.milestoneId === change.milestoneId && r.kind === ANSWERS[change.kind]) {
      await closeRequest(r.id, 'approved')
    }
  }
  return outcome
}

/** Tell the client on their page what changed, as the agent, with a receipt line per change. */
export async function tellClient(projectId: string, outcomes: ChangeOutcome[]) {
  const done = outcomes.filter((o) => o.ok && o.clientText)
  if (!done.length) return
  const { freelancer } = useRuntimeConfig()
  const first = freelancer.name.trim().split(/\s+/)[0]
  await appendChat(projectId, {
    role: 'agent',
    text: `${first} has made the change. ${done.map((o) => o.clientText).join(' ')}`,
    actions: done.map((o) => ({ kind: 'changed' as const, text: o.text })),
  })
}
