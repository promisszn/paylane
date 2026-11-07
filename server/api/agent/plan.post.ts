import { z } from 'zod'

const body = z.object({ message: z.string().trim().min(10, 'Paste a bit more of the client message').max(8000) })

/**
 * Step 1 of the flow: the agent reads a client message and proposes a payment plan.
 * Nothing is saved and nothing touches PayPal here. The freelancer reviews it first.
 */
export default defineEventHandler(async (event) => {
  const { message } = await readValidatedBody(event, body.parse)
  const { freelancer } = useRuntimeConfig()
  const plan = await planFromMessage(message, freelancer.currency)
  return { plan }
})
