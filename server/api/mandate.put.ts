import { z } from 'zod'

const body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('sign'),
    reminders: z.enum(['off', 'friendly', 'clear']),
    extensionDays: z.number().int().min(0).max(30),
    installments: z.number().int().min(1).max(4),
    limit: z.number().min(0).max(1_000_000),
  }),
  z.object({ action: z.literal('revoke') }),
])

const toneWords = { off: 'no reminders', friendly: 'friendly reminders', clear: 'friendly and clear reminders' } as const

/** Sign (or re-sign) the agent's mandate, or revoke it. Only you can; the agent never edits it. */
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body.parse)
  const { freelancer } = useRuntimeConfig()
  const current = await getMandate()

  if (input.action === 'revoke') {
    const mandate = await saveMandate({ ...current, signedAt: null, signedBy: null })
    await logActivity('you', 'Revoked the agent’s mandate. It will ask you before everything again.')
    return { mandate }
  }

  const { action: _action, ...terms } = input
  const mandate = await saveMandate({ ...terms, signedAt: new Date().toISOString(), signedBy: freelancer.name })
  const parts = [
    toneWords[mandate.reminders],
    mandate.extensionDays ? `up to ${mandate.extensionDays} extra days` : 'no extra time',
    mandate.installments > 1 ? `splits into up to ${mandate.installments} payments` : 'no splits',
    `on ${freelancer.currency} invoices up to ${fmt(mandate.limit, freelancer.currency)}`,
  ]
  await logActivity('you', `Signed the agent’s mandate: ${parts.join(', ')}.`)
  // Reminders that just became allowed go out now rather than at the next tick.
  kickAutopilot()
  return { mandate }
})
