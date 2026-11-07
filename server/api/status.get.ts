import type { AppStatus } from '../../types'

/** Lets the UI show a setup checklist instead of failing on the first click. */
export default defineEventHandler((): AppStatus => {
  const { paypal, freelancer } = useRuntimeConfig()
  const ai = aiInfo()
  return {
    paypalReady: paypalConfigured(),
    aiReady: ai.ready,
    paypalEnv: paypal.env,
    aiProvider: ai.provider,
    aiModel: ai.model,
    demoMode: demoModeOn(),
    storage: process.env.REDIS_URL ? 'redis' : 'files',
    freelancer: { name: freelancer.name, business: freelancer.business, currency: freelancer.currency },
  }
})
