/**
 * The mandate: what the agent may do on its own, signed by you.
 *
 * Every autonomous action asks one of these checks first, in code, right before it would
 * touch PayPal. The model never decides whether it is allowed: it calls a tool, the tool asks
 * here, and a "no" turns the client's ask into a request on your dashboard instead.
 *
 * Clauses, as numbered on the signed slip:
 *   1  reminders up to a tone            (firm notices always come to you)
 *   2  up to N extra days, once per invoice
 *   3  split into up to N installments
 *   4  only on invoices up to an amount, in your default currency
 * Never, whatever the mandate says: change a total, discount, cancel, or agree to new work.
 * There is simply no tool for those.
 */
import type { Clause, Mandate, Milestone, Project, ReminderTone } from '../../types'

export type Verdict = { ok: true; clause: Clause } | { ok: false; reason: string }

const no = (reason: string): Verdict => ({ ok: false, reason })

const TONE_RANK: Record<ReminderTone, number> = { friendly: 1, clear: 2, firm: 3 }
const LEVEL_RANK: Record<Mandate['reminders'], number> = { off: 0, friendly: 1, clear: 2 }

/** Clause 4. Returns why the invoice is out of bounds, or null if it's within the limit. */
function overLimit(mandate: Mandate, project: Project, milestone: Milestone): string | null {
  const { freelancer } = useRuntimeConfig()
  if (project.currency !== freelancer.currency) {
    return `It's a ${project.currency} invoice, and the agent only acts alone on ${freelancer.currency} invoices (clause 4).`
  }
  if (milestone.amount > mandate.limit) {
    return `${fmt(milestone.amount, project.currency)} is over your ${fmt(mandate.limit, freelancer.currency)} limit (clause 4).`
  }
  return null
}

export function mayRemind(mandate: Mandate, project: Project, milestone: Milestone, tone: ReminderTone): Verdict {
  if (!mandate.signedAt) return no('You haven’t signed a mandate, so the agent asks before every reminder.')
  if (LEVEL_RANK[mandate.reminders] < TONE_RANK[tone]) {
    if (tone === 'firm') return no('Firm notices always come to you.')
    return no(
      mandate.reminders === 'off'
        ? 'Your mandate doesn’t let the agent send reminders on its own (clause 1).'
        : `This one is ${tone}; your mandate lets the agent send ${mandate.reminders} reminders only (clause 1).`,
    )
  }
  const over = overLimit(mandate, project, milestone)
  return over ? no(over) : { ok: true, clause: 1 }
}

export function mayExtend(mandate: Mandate, project: Project, milestone: Milestone, extraDays: number): Verdict {
  if (!mandate.signedAt) return no('You haven’t signed a mandate, so the agent can’t move due dates.')
  if (!mandate.extensionDays) return no('Your mandate doesn’t let the agent give extra time (clause 2).')
  if (milestone.extendedDays) {
    return no(`${milestone.invoiceNumber} already got ${milestone.extendedDays} extra days. The agent gives one extension per invoice (clause 2).`)
  }
  if (extraDays > mandate.extensionDays) {
    return no(`That’s ${extraDays} extra days; your mandate allows up to ${mandate.extensionDays} (clause 2).`)
  }
  const over = overLimit(mandate, project, milestone)
  return over ? no(over) : { ok: true, clause: 2 }
}

export function maySplit(mandate: Mandate, project: Project, milestone: Milestone, parts: number): Verdict {
  if (!mandate.signedAt) return no('You haven’t signed a mandate, so the agent can’t split invoices.')
  if (mandate.installments < 2) return no('Your mandate doesn’t let the agent split invoices (clause 3).')
  if (parts > mandate.installments) {
    return no(`That’s ${parts} payments; your mandate allows up to ${mandate.installments} (clause 3).`)
  }
  const over = overLimit(mandate, project, milestone)
  return over ? no(over) : { ok: true, clause: 3 }
}

/** True when the agent has any authority, so the client page can say it can help. */
export function mandateActive(mandate: Mandate) {
  return Boolean(mandate.signedAt) && (mandate.reminders !== 'off' || mandate.extensionDays > 0 || mandate.installments > 1)
}
