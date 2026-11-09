import { z } from 'zod'

const body = z.object({
  text: z.string().trim().min(1, 'Write a reply first.').max(1500),
  /** Close this request as handled, when you're answering one. */
  requestId: z.string().optional(),
})

/** You reply to the client in person. It appears on their page straight away, marked as from you. */
export default defineEventHandler(async (event) => {
  const project = await getProject(getRouterParam(event, 'projectId') ?? '')
  const { text, requestId } = await readValidatedBody(event, body.parse)
  const turn = await appendChat(project.id, { role: 'freelancer', text })
  if (requestId) await closeRequest(requestId, 'handled')
  await logActivity('you', `Replied to ${project.client.name} on the client page.`, project.id)
  return { turn }
})
