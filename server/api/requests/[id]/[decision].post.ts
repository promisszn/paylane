/**
 * Your answer to something a client asked the agent for, beyond its mandate.
 *   approve  apply the exact change (new due date or installments) on PayPal, as you
 *   decline  keep the current terms; the agent tells the client on their page
 *   handled  you dealt with it yourself (e.g. replied); just close it
 * The request is claimed before anything runs, so a double click can't apply it twice.
 */
const DECISIONS = ['approve', 'decline', 'handled'] as const
type Decision = (typeof DECISIONS)[number]

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const decision = getRouterParam(event, 'decision') as Decision
  if (!DECISIONS.includes(decision)) throw createError({ statusCode: 404, statusMessage: `Unknown decision "${decision}"` })

  const request = await getRequest(id)
  const project = await getProject(request.projectId)
  const { freelancer } = useRuntimeConfig()
  const first = freelancer.name.trim().split(/\s+/)[0]
  const client = project.client.name

  if (decision === 'approve' && request.kind === 'other') {
    throw createError({ statusCode: 400, statusMessage: 'There’s no change to apply on this one. Reply to the client instead.' })
  }
  const claimed = await closeRequest(id, decision === 'approve' ? 'approved' : decision === 'decline' ? 'declined' : 'handled')
  if (!claimed) throw createError({ statusCode: 409, statusMessage: 'That request was already answered.' })

  if (decision === 'approve') {
    try {
      if (request.kind === 'extension') {
        const r = await extendDueDate(project.id, request.milestoneId!, request.newDueDate!, { actor: 'you' })
        await appendChat(project.id, {
          role: 'agent',
          text: `Good news: ${first} approved it. Invoice ${r.invoiceNumber} is now due ${longDate(r.newDueDate)}, and PayPal has emailed you the updated invoice.`,
          actions: [{ kind: 'approved', text: `${r.invoiceNumber} is now due ${dayLabel(r.newDueDate)}` }],
        })
      } else {
        const r = await splitIntoInstallments(project.id, request.milestoneId!, request.parts!, { actor: 'you' })
        const schedule = r.installments.map((i) => `${fmt(i.amount, project.currency)} by ${longDate(i.dueDate)}`).join(', ')
        await appendChat(project.id, {
          role: 'agent',
          text: `Good news: ${first} approved it. Invoice ${r.original} is now ${r.installments.length} payments: ${schedule}. PayPal has emailed you an invoice for each.`,
          actions: [{ kind: 'approved', text: `${r.original} split into ${r.installments.length} payments` }],
        })
      }
    } catch (err) {
      await reopenRequest(id)
      throw err
    }
  } else if (decision === 'decline') {
    await appendChat(project.id, {
      role: 'agent',
      text: `${first} has looked at your request and can’t change that one, so the current terms stand. If something else would help, just ask here.`,
      actions: [{ kind: 'declined', text: `${first} kept the current terms` }],
    })
    await logActivity('you', `Declined ${client}’s request: ${request.summary}.`, project.id)
  } else {
    await logActivity('you', `Marked ${client}’s request as handled: ${request.summary}.`, project.id)
  }
  return { ok: true }
})

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
