import { z } from 'zod'
import type { TermsChange } from '../../../types'

const body = z.object({
  projectId: z.string(),
  milestoneId: z.string(),
  kind: z.enum(['amount', 'due_date', 'split']),
  amount: z.number().positive().optional(),
  dueDate: z.string().optional(),
  parts: z.number().int().min(2).max(6).optional(),
  /** Why, e.g. "$100 off". Kept with the payment and in the activity log. */
  note: z.string().trim().max(200).optional(),
  /** Post what changed on the client's page, as the agent. */
  tellClient: z.boolean().default(true),
})

/**
 * YOU change a payment from the ledger: its amount, a later due date, or a split.
 * Same path the agent uses when you agree to a change in a reply (applyChange).
 */
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body.parse)
  let change: TermsChange
  if (input.kind === 'amount') {
    if (input.amount == null) throw createError({ statusCode: 400, statusMessage: 'Enter the new amount.' })
    change = { kind: 'amount', milestoneId: input.milestoneId, amount: input.amount, note: input.note || undefined }
  } else if (input.kind === 'due_date') {
    if (!input.dueDate) throw createError({ statusCode: 400, statusMessage: 'Pick the new due date.' })
    change = { kind: 'due_date', milestoneId: input.milestoneId, dueDate: input.dueDate }
  } else {
    if (!input.parts) throw createError({ statusCode: 400, statusMessage: 'Choose how many payments.' })
    change = { kind: 'split', milestoneId: input.milestoneId, parts: input.parts }
  }

  const outcome = await applyChange(input.projectId, change, { actor: 'you' })
  if (!outcome.ok) throw createError({ statusCode: 400, statusMessage: outcome.text })
  if (input.tellClient) await tellClient(input.projectId, [outcome])
  return outcome
})
