import { z } from 'zod'

const ALLOWED_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
])

const body = z
  .object({
    message: z.string().trim().max(8000).default(''),
    attachment: z
      .object({
        name: z.string().min(1).max(200),
        mediaType: z.string().refine((m) => ALLOWED_MEDIA_TYPES.has(m), 'Unsupported file type. Use PNG, JPEG, WebP or PDF.'),
        // Base64 up to ~6 MB
        data: z.string().min(10).max(8_500_000, 'Attachment is too large (max 6 MB).'),
      })
      .optional(),
  })
  .refine((v) => v.message.length >= 10 || Boolean(v.attachment), {
    message: 'Paste a bit more of the client message or attach a screenshot / PDF.',
  })

/**
 * Step 1 of the flow: the agent reads a client message and proposes a payment plan.
 * Nothing is saved and nothing touches PayPal here. The freelancer reviews it first.
 */
export default defineEventHandler(async (event) => {
  const { message, attachment } = await readValidatedBody(event, body.parse)
  const { freelancer } = useRuntimeConfig()
  const plan = await planFromMessage(message, freelancer.currency, attachment)
  if (!paypalSupportsCurrency(plan.currency)) {
    throw createError({ statusCode: 422, statusMessage: unsupportedCurrencyMessage(plan.currency) })
  }
  return { plan }
})
