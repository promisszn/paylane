import { z } from 'zod'
import type { Project } from '../../../types'

const body = z.object({
  sourceMessage: z.string().max(8000).default(''),
  plan: z.object({
    title: z.string().min(1),
    client: z.object({ name: z.string().min(1), email: z.string().email('Client email looks wrong') }),
    currency: z.string().length(3),
    milestones: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().default(''),
          amount: z.number().positive(),
          trigger: z.enum(['upfront', 'on_completion']),
          dueDays: z.number().int().min(0).max(90),
        }),
      )
      .min(1),
  }),
})

/**
 * Step 2: the freelancer approved the plan (possibly after editing it).
 * We save the project, and for every "upfront" milestone the agent creates a PayPal
 * DRAFT invoice and writes the email. Drafts are not visible to the client.
 * Sending is a separate click (POST /api/milestones/send).
 */
export default defineEventHandler(async (event) => {
  const { plan, sourceMessage } = await readValidatedBody(event, body.parse)
  // Checked again here so a direct API call can't save a project PayPal can never bill.
  if (!paypalSupportsCurrency(plan.currency)) {
    throw createError({ statusCode: 422, statusMessage: unsupportedCurrencyMessage(plan.currency) })
  }

  const project: Project = {
    id: newId(),
    title: plan.title,
    client: plan.client,
    currency: plan.currency.toUpperCase(),
    total: Math.round(plan.milestones.reduce((s, m) => s + m.amount, 0) * 100) / 100,
    sourceMessage,
    createdAt: new Date().toISOString(),
    milestones: plan.milestones.map((m) => ({ ...m, id: newId(), status: 'planned', reminders: [] })),
    portalToken: newToken(),
  }

  await upsertProject(project)
  await logActivity('you', `Approved the plan for "${project.title}" (${fmt(project.total, project.currency)}, ${project.milestones.length} milestones).`, project.id)

  const errors: string[] = []
  for (const milestone of project.milestones.filter((m) => m.trigger === 'upfront')) {
    try {
      await prepareDraft(project, milestone)
    } catch (err: any) {
      errors.push(`${milestone.name}: ${err?.statusMessage ?? err?.message ?? 'failed'}`)
    }
  }

  await upsertProject(project)
  return { project, errors }
})
