import { timingSafeEqual } from 'node:crypto'

/**
 * Demo mode only: wipe Paylane's projects and activity log, e.g. before recording
 * or before judging. Needs DEMO_MODE=true (sandbox) and the DEMO_RESET_TOKEN secret:
 *
 *   curl -X POST <app>/api/demo/reset -H "x-reset-token: $DEMO_RESET_TOKEN"
 *
 * There's no button for it, so visitors to a shared demo can't wipe each other's data.
 * Invoices already on PayPal stay there; Paylane just stops tracking them.
 */
export default defineEventHandler(async (event) => {
  if (!demoModeOn()) {
    throw createError({ statusCode: 404, statusMessage: 'Demo mode is off. Set DEMO_MODE=true (sandbox only).' })
  }
  const expected = process.env.DEMO_RESET_TOKEN ?? ''
  if (!expected) {
    throw createError({ statusCode: 403, statusMessage: 'Reset is disabled. Set DEMO_RESET_TOKEN to enable it.' })
  }
  const given = Buffer.from(getHeader(event, 'x-reset-token') ?? '')
  const want = Buffer.from(expected)
  const ok = given.length === want.length && timingSafeEqual(given, want)
  if (!ok) throw createError({ statusCode: 403, statusMessage: 'Wrong or missing x-reset-token header.' })

  const removed = await clearAll()
  return { ok: true, removed }
})
