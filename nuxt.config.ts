// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'Paylane',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'An AI payments agent for freelancers, built on PayPal Invoicing.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  // Everything here can be overridden with NUXT_* env vars at runtime.
  runtimeConfig: {
    // Demo helpers for recording the video. Only honoured when PAYPAL_ENV is sandbox.
    demoMode: process.env.DEMO_MODE === 'true',
    paypal: {
      clientId: process.env.PAYPAL_CLIENT_ID ?? '',
      clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
      // "sandbox" or "live". The hackathon only allows sandbox.
      env: process.env.PAYPAL_ENV ?? 'sandbox',
      webhookId: process.env.PAYPAL_WEBHOOK_ID ?? '',
    },
    ai: {
      provider: process.env.AI_PROVIDER ?? 'google',
      model: process.env.AI_MODEL ?? '',
      anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
      openaiKey: process.env.OPENAI_API_KEY ?? '',
      googleKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
    },
    freelancer: {
      name: process.env.FREELANCER_NAME ?? 'Alex Freelancer',
      business: process.env.FREELANCER_BUSINESS ?? 'Alex Studio',
      currency: process.env.DEFAULT_CURRENCY ?? 'USD',
    },
  },

  // The "db" store is mounted at startup by server/plugins/storage.ts:
  // JSON files in ./.data/db locally, Redis when REDIS_URL is set (hosted).

  typescript: { strict: true },
})
