import { z } from 'zod'

const body = z.object({
  projectId: z.string(),
  milestoneId: z.string(),
  days: z.number().int().min(1).max(90),
})

/**
 * Demo mode only (DEMO_MODE=true and PAYPAL_ENV=sandbox).
 * Makes a sent invoice overdue right now, so the reminder flow and its tone changes
 * can be shown without waiting days. Nothing is sent to PayPal or the client.
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

  backdateMilestone(milestone, input.days)
  await logActivity('you', `Demo mode: made ${milestone.invoiceNumber} ${input.days} day${input.days === 1 ? '' : 's'} overdue.`, project.id)
  await upsertProject(project)
  return { project, milestone, daysOverdue: daysOverdue(milestone) }
})
