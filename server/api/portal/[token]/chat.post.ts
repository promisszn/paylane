import { z } from 'zod'

const body = z.object({ message: z.string().trim().min(1, 'Type a message first.').max(800, 'Keep it under 800 characters.') })

// A shared demo is public, so each client page gets a modest message budget.
const recent = new Map<string, number[]>()
const WINDOW = 5 * 60_000
const MAX_MESSAGES = 15

/**
 * The client writes to the agent on their page. The agent answers, and may change their
 * invoices on PayPal if your mandate allows it. Both messages are kept for you to read.
 */
export default defineEventHandler(async (event) => {
  const project = await projectForToken(getRouterParam(event, 'token'))
  const { message } = await readValidatedBody(event, body.parse)

  const now = Date.now()
  const times = (recent.get(project.id) ?? []).filter((t) => now - t < WINDOW)
  if (times.length >= MAX_MESSAGES) {
    throw createError({ statusCode: 429, statusMessage: 'That’s a lot of messages in a short time. Wait a minute and try again.' })
  }
  recent.set(project.id, [...times, now])

  if (!aiInfo().ready) {
    throw createError({ statusCode: 503, statusMessage: 'The assistant is offline right now. Your invoices and the Pay buttons still work.' })
  }

  const history = await getChat(project.id)
  await appendChat(project.id, { role: 'client', text: message })

  const { freelancer } = useRuntimeConfig()
  const first = freelancer.name.trim().split(/\s+/)[0]
  try {
    const { reply, actions } = await concierge(project.id, message, history)
    await appendChat(project.id, { role: 'agent', text: reply, ...(actions.length ? { actions } : {}) })
  } catch (err: any) {
    console.error('[paylane] client page agent failed', err)
    await appendChat(project.id, {
      role: 'agent',
      text: `Sorry, I couldn’t answer that just now. I’ve let ${first} know, and your invoices and the Pay buttons still work.`,
    })
    await logActivity('agent', `Couldn’t answer ${project.client.name} on the client page (${err?.statusMessage ?? err?.message ?? 'model error'}). Read the conversation and reply.`, project.id)
  }
  return portalView(await getProject(project.id))
})
