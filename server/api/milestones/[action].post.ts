import { z } from 'zod'
import type { ReminderTone } from '../../../types'

/**
 * Every per-milestone action, one endpoint per verb:
 *
 *   POST /api/milestones/draft          agent (re)writes the invoice email, creates the PayPal draft if needed
 *   POST /api/milestones/send           YOU approve -> PayPal emails the invoice to the client
 *   POST /api/milestones/complete       YOU mark the work done -> agent drafts the next invoice (not sent)
 *   POST /api/milestones/reminder-draft agent writes a reminder suited to how late the payment is
 *   POST /api/milestones/remind         YOU approve -> PayPal sends the reminder
 *   POST /api/milestones/cancel         YOU cancel the invoice on PayPal
 *
 * Actions marked YOU are the human checkpoints. The agent can only prepare.
 */
const body = z.object({
  projectId: z.string(),
  milestoneId: z.string(),
  subject: z.string().max(4000).optional(),
  note: z.string().max(4000).optional(),
})

const ACTIONS = ['draft', 'send', 'complete', 'reminder-draft', 'remind', 'cancel'] as const
type Action = (typeof ACTIONS)[number]

export default defineEventHandler(async (event) => {
  const action = getRouterParam(event, 'action') as Action
  if (!ACTIONS.includes(action)) throw createError({ statusCode: 404, statusMessage: `Unknown action "${action}"` })

  const input = await readValidatedBody(event, body.parse)
  const project = await getProject(input.projectId)
  const milestone = findMilestone(project, input.milestoneId)
  let reminderDraft: { subject: string; note: string; tone: ReminderTone } | undefined

  switch (action) {
    case 'draft': {
      assertStatus(milestone.status, ['planned', 'draft'], 'draft')
      await prepareDraft(project, milestone)
      break
    }

    case 'send': {
      assertStatus(milestone.status, ['planned', 'draft'], 'send')
      const subject = input.subject ?? milestone.draftSubject
      const note = input.note ?? milestone.draftNote
      if (!subject || !note) throw createError({ statusCode: 400, statusMessage: 'Nothing to send yet. Draft the invoice first.' })
      await approveAndSend(project, milestone, subject, note)
      break
    }

    case 'complete': {
      assertStatus(milestone.status, ['planned'], 'complete')
      milestone.completedAt = new Date().toISOString()
      await logActivity('you', `Marked "${milestone.name}" as done on ${project.title}.`, project.id)
      await prepareDraft(project, milestone)
      break
    }

    case 'reminder-draft': {
      assertStatus(milestone.status, ['sent'], 'remind about')
      reminderDraft = await draftReminder(project, milestone, daysOverdue(milestone))
      await logActivity('agent', `Wrote a reminder for ${milestone.invoiceNumber}. Waiting for your approval.`, project.id)
      break
    }

    case 'remind': {
      assertStatus(milestone.status, ['sent'], 'remind about')
      if (!input.subject || !input.note) throw createError({ statusCode: 400, statusMessage: 'Reminder subject and note are required.' })
      const tone = reminderTone(daysOverdue(milestone), milestone.reminders.length)
      const note = withClientPageLink(input.note, project)
      await remindInvoice(milestone.invoiceId!, input.subject, note)
      milestone.reminders.push({ sentAt: new Date().toISOString(), subject: input.subject, note, tone, by: 'you' })
      delete milestone.autoRemindError
      await logActivity('you', `Sent reminder #${milestone.reminders.length} (${tone}) for ${milestone.invoiceNumber} to ${project.client.name}.`, project.id)
      break
    }

    case 'cancel': {
      assertStatus(milestone.status, ['draft', 'sent'], 'cancel')
      if (milestone.status === 'sent') await cancelInvoice(milestone.invoiceId!, input.note ?? 'This invoice has been cancelled.')
      milestone.status = 'cancelled'
      await logActivity('you', `Cancelled ${milestone.invoiceNumber ?? milestone.name}.`, project.id)
      break
    }
  }

  await upsertProject(project)
  return { project, milestone, reminderDraft }
})

function assertStatus(status: string, allowed: string[], verb: string) {
  if (!allowed.includes(status)) {
    throw createError({ statusCode: 409, statusMessage: `Can't ${verb} a milestone that is ${status}.` })
  }
}
