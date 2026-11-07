/**
 * PayPal webhook receiver. Subscribe your sandbox app to:
 *   INVOICING.INVOICE.PAID, INVOICING.INVOICE.CANCELLED, INVOICING.INVOICE.UPDATED
 * and put the webhook id in PAYPAL_WEBHOOK_ID. Every event is verified with PayPal
 * before we trust it.
 */
export default defineEventHandler(async (event) => {
  const payload = await readBody<{ event_type?: string; resource?: any }>(event)
  const headers = getHeaders(event)

  const verified = await verifyWebhook(headers, payload).catch(() => false)
  if (!verified) throw createError({ statusCode: 400, statusMessage: 'Webhook signature could not be verified' })

  const invoiceId: string | undefined = payload.resource?.invoice?.id ?? payload.resource?.id
  if (!invoiceId || !payload.event_type?.startsWith('INVOICING.')) return { ok: true, ignored: true }

  const match = await findByInvoiceId(invoiceId)
  if (!match) return { ok: true, ignored: true }

  // Don't trust the payload's copy. Fetch the invoice so we always store PayPal's current state.
  const { project, milestone } = match
  const invoice = await getInvoice(invoiceId)
  if (applyInvoiceState(milestone, invoice)) {
    await logActivity('paypal', `${project.client.name} paid ${milestone.invoiceNumber}: ${fmt(milestone.amount, project.currency)} for "${milestone.name}".`, project.id)
  }
  await upsertProject(project)
  return { ok: true }
})
