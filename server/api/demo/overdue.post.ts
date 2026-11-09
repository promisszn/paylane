import { z } from 'zod'

const body = z.object({
  projectId: z.string(),
  milestoneId: z.string(),
  days: z.number().int().min(1).max(90),
})

/**
 * Demo mode only (DEMO_MODE=true and PAYPAL_ENV=sandbox).
 * Makes a sent invoice overdue right now, as if days had passed, so the reminder flow and its
 * tone changes can be shown without waiting. Nothing is sent to PayPal or the client by this
 * route itself; if your mandate covers the reminder that's now due, the agent sends it.
 */
export default defineEventHandler(async (event) => {
  if (!demoModeOn()) {
    throw createError({ statusCode: 404, statusMessage: 'Demo mode is off. Set DEMO_MODE=true in .env (sandbox only).' })
  }
  const input = await readValidatedBody(event, body.parse)
  const project = await getProject(input.projectId)
  const milestone = findMilestone(project, input.milestoneId)
  if (milestone.status !== 'sent') {
    throw createError({ statusCode: 409, statusMessage: `Only sent invoices can be made overdue. This one is ${milestone.status}.` })
  }

  const { result: updated } = await mutateProject(project.id, (p) => {
    const m = findMilestone(p, milestone.id)
    backdateMilestone(m, input.days)
    return m
  })
  await logActivity('you', `Demo mode: moved ${milestone.invoiceNumber} forward in time, so it's ${input.days} day${input.days === 1 ? '' : 's'} overdue.`, project.id)
  // If the mandate covers a reminder now, the agent sends it on its own; pages update live.
  kickAutopilot()
  return { milestone: updated, daysOverdue: daysOverdue(updated) }
})
