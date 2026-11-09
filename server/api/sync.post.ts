/**
 * Pull the latest status of every open invoice from PayPal.
 * Webhooks do this automatically on a deployed app. Locally (no public URL) this
 * button is how payments show up, so the demo works without ngrok.
 *
 * PayPal is asked first, outside the store lock; each answer is then applied to the freshest
 * copy of its job, so a change made meanwhile (say by the agent on a client page) isn't lost.
 */
export default defineEventHandler(async () => {
  const projects = await listProjects()
  let checked = 0
  const newlyPaid: string[] = []

  for (const project of projects) {
    for (const m of project.milestones) {
      if (!m.invoiceId || m.status === 'paid' || m.status === 'cancelled' || m.status === 'planned') continue
      const invoice = await getInvoice(m.invoiceId)
      checked++
      const { result: justPaid } = await mutateProject(project.id, (p) => applyInvoiceState(findMilestone(p, m.id), invoice))
      if (justPaid) {
        newlyPaid.push(`${m.invoiceNumber} (${fmt(m.amount, project.currency)})`)
        await logActivity('paypal', `${project.client.name} paid ${m.invoiceNumber}: ${fmt(m.amount, project.currency)} for "${m.name}".`, project.id)
      }
    }
  }

  kickAutopilot()
  return { checked, newlyPaid }
})
