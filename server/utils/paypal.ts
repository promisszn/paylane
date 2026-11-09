/**
 * Thin client for the PayPal REST APIs Paylane uses:
 *   - OAuth 2.0 client credentials           POST /v1/oauth2/token
 *   - Invoicing v2 (create, send, remind,    /v2/invoicing/invoices...
 *     get, cancel, next invoice number)
 *   - Webhook signature verification         POST /v1/notifications/verify-webhook-signature
 *
 * Docs: https://developer.paypal.com/docs/api/invoicing/v2/
 */
import type { Milestone, Project } from '../../types'

interface TokenCache {
  token: string
  expiresAt: number
}
let tokenCache: TokenCache | null = null

function config() {
  const { paypal } = useRuntimeConfig()
  if (!paypal.clientId || !paypal.clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env',
    })
  }
  const base = paypal.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  return { ...paypal, base }
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token

  const { base, clientId, clientSecret } = config()
  const res = await $fetch<{ access_token: string; expires_in: number }>(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  }).catch((err) => {
    throw paypalError(err, 'Could not get a PayPal access token. Check your client ID and secret.')
  })

  tokenCache = { token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 }
  return tokenCache.token
}

/** Turn a PayPal error response into something a human can read in the UI. */
function paypalError(err: any, fallback: string) {
  const data = err?.data
  const detail = data?.details?.[0]
  const message = detail
    ? `${detail.issue}: ${detail.description ?? ''}`.trim()
    : data?.message ?? data?.error_description ?? fallback
  return createError({ statusCode: err?.statusCode ?? 502, statusMessage: `PayPal: ${message}` })
}

async function pp<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; headers?: Record<string, string> } = {}) {
  const { base } = config()
  const token = await getAccessToken()
  return $fetch<T>(`${base}${path}`, {
    method: opts.method ?? 'GET',
    body: opts.body as any,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  }).catch((err) => {
    throw paypalError(err, `Request to ${path} failed`)
  })
}

// ---------------------------------------------------------------------------
// Invoicing
// ---------------------------------------------------------------------------

/** The subset of the PayPal invoice object we read. */
export interface PayPalInvoice {
  id: string
  status: string // DRAFT | SENT | SCHEDULED | PAID | MARKED_AS_PAID | CANCELLED | PARTIALLY_PAID | UNPAID | PAYMENT_PENDING ...
  detail: {
    invoice_number: string
    currency_code: string
    payment_term?: { due_date?: string }
    metadata?: { recipient_view_url?: string; invoicer_view_url?: string }
  }
  amount?: { value: string; currency_code: string }
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

function splitName(full: string) {
  const parts = full.trim().split(/\s+/)
  return { given_name: parts[0] ?? full, surname: parts.slice(1).join(' ') || undefined }
}

/**
 * Create a DRAFT invoice for one milestone. Nothing is emailed until sendInvoice().
 * `dueDate` (YYYY-MM-DD) overrides the usual "today + dueDays", e.g. for installments.
 */
export async function createDraftInvoice(project: Project, milestone: Milestone, note: string, dueDate?: string) {
  const { freelancer } = useRuntimeConfig()
  const { invoice_number } = await pp<{ invoice_number: string }>('/v2/invoicing/generate-next-invoice-number', {
    method: 'POST',
  })

  const due = dueDate ? new Date(`${dueDate}T00:00:00Z`) : new Date(Date.now() + milestone.dueDays * 86_400_000)

  return pp<PayPalInvoice>('/v2/invoicing/invoices', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      detail: {
        invoice_number,
        reference: `${project.id}/${milestone.id}`,
        currency_code: project.currency,
        note: note.slice(0, 4000),
        memo: `Paylane: ${project.title} / ${milestone.name}`,
        payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: isoDate(due) },
      },
      invoicer: {
        business_name: freelancer.business,
        name: splitName(freelancer.name),
      },
      primary_recipients: [
        {
          billing_info: {
            name: splitName(project.client.name),
            email_address: project.client.email,
          },
        },
      ],
      items: [
        {
          name: milestone.name.slice(0, 200),
          description: milestone.description.slice(0, 1000),
          quantity: '1',
          unit_amount: { currency_code: project.currency, value: milestone.amount.toFixed(2) },
          unit_of_measure: 'AMOUNT',
        },
      ],
    },
  })
}

/** Email the invoice to the client. Returns the invoice as it stands after sending. */
export async function sendInvoice(invoiceId: string, subject: string, note: string) {
  await pp(`/v2/invoicing/invoices/${invoiceId}/send`, {
    method: 'POST',
    body: { subject: subject.slice(0, 4000), note: note.slice(0, 4000), send_to_recipient: true, send_to_invoicer: false },
  })
  return getInvoice(invoiceId)
}

export function getInvoice(invoiceId: string) {
  return pp<PayPalInvoice>(`/v2/invoicing/invoices/${invoiceId}`)
}

export async function remindInvoice(invoiceId: string, subject: string, note: string) {
  await pp(`/v2/invoicing/invoices/${invoiceId}/remind`, {
    method: 'POST',
    body: { subject: subject.slice(0, 4000), note: note.slice(0, 4000), send_to_recipient: true, send_to_invoicer: false },
  })
}

export async function cancelInvoice(invoiceId: string, note: string, notifyClient = true) {
  await pp(`/v2/invoicing/invoices/${invoiceId}/cancel`, {
    method: 'POST',
    body: { subject: 'Invoice cancelled', note: note.slice(0, 4000), send_to_recipient: notifyClient, send_to_invoicer: false },
  })
}

/**
 * Move the due date of an invoice that's already with the client.
 * Invoicing v2 has no partial update, so this reads the full invoice, changes the date and
 * PUTs it back. PayPal then emails the client the updated invoice. The pay link stays the same.
 */
export async function updateInvoiceDueDate(invoiceId: string, dueDate: string, notifyClient = true) {
  const invoice = await pp<PayPalInvoice & { detail: { payment_term?: Record<string, unknown> } }>(`/v2/invoicing/invoices/${invoiceId}`)
  invoice.detail.payment_term = { ...invoice.detail.payment_term, term_type: 'DUE_ON_DATE_SPECIFIED', due_date: dueDate }
  return pp<PayPalInvoice>(
    `/v2/invoicing/invoices/${invoiceId}?send_to_recipient=${notifyClient}&send_to_invoicer=false`,
    { method: 'PUT', body: invoice, headers: { Prefer: 'return=representation' } },
  )
}

/** Delete a draft that never reached the client (used to roll back a half-finished split). */
export async function deleteDraftInvoice(invoiceId: string) {
  await pp(`/v2/invoicing/invoices/${invoiceId}`, { method: 'DELETE' })
}

/** PayPal statuses that mean the money arrived. */
export const PAID_STATUSES = new Set(['PAID', 'MARKED_AS_PAID'])

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Ask PayPal to confirm a webhook really came from PayPal. */
export async function verifyWebhook(headers: Record<string, string | undefined>, event: unknown) {
  const { webhookId } = config()
  if (!webhookId) return false
  const res = await pp<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    },
  })
  return res.verification_status === 'SUCCESS'
}

export function paypalConfigured() {
  const { paypal } = useRuntimeConfig()
  return Boolean(paypal.clientId && paypal.clientSecret)
}
