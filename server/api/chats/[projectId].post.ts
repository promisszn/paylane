import { z } from 'zod'
import type { ChangeOutcome } from '../../../types'

const body = z.object({
  text: z.string().trim().min(1, 'Write a reply first.').max(1500),
  /** Close this request as handled, when you're answering one. */
  requestId: z.string().optional(),
  /** Let the agent apply any change to a payment you agree to in this reply. */
  apply: z.boolean().default(true),
})

/**
 * You reply to the client in person. It appears on their page straight away, marked as from you.
 * Then the agent reads it, and if you agreed to a change (a discount, more time, a split), it
 * makes that change on PayPal and tells the client (followThrough.ts).
 */
export default defineEventHandler(async (event) => {
  const project = await getProject(getRouterParam(event, 'projectId') ?? '')
  const { text, requestId, apply } = await readValidatedBody(event, body.parse)
  const history = await getChat(project.id)
  const turn = await appendChat(project.id, { role: 'freelancer', text })
  if (requestId) await closeRequest(requestId, 'handled')
  await logActivity('you', `Replied to ${project.client.name} on the client page.`, project.id)

  let changes: ChangeOutcome[] = []
  let followError: string | undefined
  if (apply && aiInfo().ready) {
    try {
      changes = await followThrough(project.id, text, history)
    } catch (err: any) {
      console.error('[paylane] reading your reply for changes failed', err)
      followError = `Your reply is posted, but the agent couldn't read it for changes (${err?.statusMessage ?? err?.message ?? 'model error'}). If you agreed to one, make it with Change in the ledger.`
      await logActivity('agent', followError, project.id)
    }
  }
  return { turn, changes, followError }
})
