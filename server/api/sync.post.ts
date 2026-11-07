/**
 * Pull the latest status of every open invoice from PayPal.
 * Webhooks do this automatically on a deployed app. Locally (no public URL) this
 * button is how payments show up, so the demo works without ngrok.
 */
export default defineEventHandler(async () => {
  const projects = await listProjects()
  let checked = 0
  const newlyPaid: string[] = []

  for (const project of projects) {
    for (const m of project.milestones) {
      if (!m.invoiceId || m.status === 'paid' || m.status === 'cancelled') continue
      const invoice = await getInvoice(m.invoiceId)
      checked++
      if (applyInvoiceState(m, invoice)) {
        newlyPaid.push(`${m.invoiceNumber} (${fmt(m.amount, project.currency)})`)
        await logActivity('paypal', `${project.client.name} paid ${m.invoiceNumber}: ${fmt(m.amount, project.currency)} for "${m.name}".`, project.id)
      }
    }
  }

  await saveProjects(projects)
  return { checked, newlyPaid }
})
