/**
 * Tiny JSON store on top of Nitro storage (./.data/db on disk, Redis when REDIS_URL is set).
 * Good enough for a single freelancer and keeps the project runnable with zero setup.
 *
 * Keys: projects, activity, requests (client asks the agent couldn't settle), chats (client page
 * conversations, by project) and mandate (what the agent may do on its own).
 * Every write publishes a live event so open pages update without a refresh.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { ActivityEntry, Actor, ChatTurn, Clause, ClientRequest, Mandate, Milestone, Project } from '../../types'

const db = () => useStorage('db')

export const newId = () => randomUUID().slice(0, 8)
/** Unguessable part of a client page URL. */
export const newToken = () => randomBytes(12).toString('base64url')

// Serialize read-modify-write operations on the JSON store so concurrent requests
// (a PayPal webhook, the client page agent, a dashboard click) never overwrite each other.
// Not re-entrant: never call a locked function from inside another one.
let writeQueue: Promise<unknown> = Promise.resolve()

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn)
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  return (await db().getItem<Project[]>('projects')) ?? []
}

export async function getProject(id: string): Promise<Project> {
  const project = (await listProjects()).find((p) => p.id === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: `Project ${id} not found` })
  return project
}

export async function upsertProject(project: Project) {
  await withLock(async () => {
    const projects = await listProjects()
    const i = projects.findIndex((p) => p.id === project.id)
    if (i === -1) projects.unshift(project)
    else projects[i] = project
    await db().setItem('projects', projects)
  })
  publish({ type: 'change', projectId: project.id })
  return project
}

/**
 * Change one project on its freshest stored copy, inside the lock. Use this after slow work
 * (PayPal, the model) so a change made meanwhile by someone else isn't lost.
 * `fn` must be quick and local: no PayPal, no model, no other store calls.
 */
export async function mutateProject<T>(id: string, fn: (project: Project) => T): Promise<{ project: Project; result: T }> {
  const out = await withLock(async () => {
    const projects = await listProjects()
    const project = projects.find((p) => p.id === id)
    if (!project) throw createError({ statusCode: 404, statusMessage: `Project ${id} not found` })
    const result = fn(project)
    await db().setItem('projects', projects)
    return { project, result }
  })
  publish({ type: 'change', projectId: id })
  return out
}

export function findMilestone(project: Project, milestoneId: string): Milestone {
  const m = project.milestones.find((x) => x.id === milestoneId)
  if (!m) throw createError({ statusCode: 404, statusMessage: `Milestone ${milestoneId} not found` })
  return m
}

/** Find the project + milestone that owns a PayPal invoice id (used by webhooks and sync). */
export async function findByInvoiceId(invoiceId: string) {
  for (const project of await listProjects()) {
    const milestone = project.milestones.find((m) => m.invoiceId === invoiceId)
    if (milestone) return { project, milestone }
  }
  return null
}

/** The project behind a client page link, or null. Tokens are compared exactly. */
export async function findByPortalToken(token: string) {
  if (!token || token.length < 12) return null
  return (await listProjects()).find((p) => p.portalToken === token) ?? null
}

/** Jobs created before client pages existed get a link the first time the dashboard loads. */
export async function ensurePortalTokens(projects: Project[]) {
  const missing = projects.filter((p) => !p.portalToken).map((p) => p.id)
  if (!missing.length) return projects
  await withLock(async () => {
    const stored = await listProjects()
    for (const p of stored) if (missing.includes(p.id) && !p.portalToken) p.portalToken = newToken()
    await db().setItem('projects', stored)
  })
  return listProjects()
}

/** Demo reset: forget every project, conversation, request and activity entry. The mandate stays. */
export async function clearAll() {
  const counts = await withLock(async () => {
    const counts = { projects: (await listProjects()).length, activity: (await listActivity()).length }
    for (const key of ['projects', 'activity', 'requests', 'chats']) await db().removeItem(key)
    return counts
  })
  publish({ type: 'change' })
  return counts
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export async function listActivity(): Promise<ActivityEntry[]> {
  return (await db().getItem<ActivityEntry[]>('activity')) ?? []
}

/** `clause` marks something the agent did on its own, and which mandate clause allowed it. */
export async function logActivity(actor: Actor, text: string, projectId?: string, clause?: Clause) {
  await withLock(async () => {
    const entries = await listActivity()
    entries.unshift({ id: newId(), at: new Date().toISOString(), actor, text, projectId, ...(clause ? { clause } : {}) })
    await db().setItem('activity', entries.slice(0, 200))
  })
  publish({ type: 'change', projectId })
}

// ---------------------------------------------------------------------------
// Client requests: what the client asked for that the mandate didn't cover
// ---------------------------------------------------------------------------

export async function listRequests(): Promise<ClientRequest[]> {
  return (await db().getItem<ClientRequest[]>('requests')) ?? []
}

export async function addRequest(input: Omit<ClientRequest, 'id' | 'at' | 'status'>): Promise<ClientRequest> {
  const request: ClientRequest = {
    ...input,
    summary: input.summary.trim().replace(/[.\s]+$/, ''),
    id: newId(),
    at: new Date().toISOString(),
    status: 'open',
  }
  await withLock(async () => {
    const all = await listRequests()
    all.unshift(request)
    await db().setItem('requests', all.slice(0, 100))
  })
  publish({ type: 'change', projectId: input.projectId })
  return request
}

/** Close an open request. Returns null if it was already closed, so a double click does nothing twice. */
export async function closeRequest(id: string, status: Exclude<ClientRequest['status'], 'open'>): Promise<ClientRequest | null> {
  const closed = await withLock(async () => {
    const all = await listRequests()
    const r = all.find((x) => x.id === id)
    if (!r) throw createError({ statusCode: 404, statusMessage: 'That request no longer exists.' })
    if (r.status !== 'open') return null
    r.status = status
    await db().setItem('requests', all)
    return r
  })
  if (closed) publish({ type: 'change', projectId: closed.projectId })
  return closed
}

/** Undo a claim when applying an approved change failed, so you can try again. */
export async function reopenRequest(id: string) {
  await withLock(async () => {
    const all = await listRequests()
    const r = all.find((x) => x.id === id)
    if (r) r.status = 'open'
    await db().setItem('requests', all)
  })
  publish({ type: 'change' })
}

export async function getRequest(id: string) {
  const r = (await listRequests()).find((x) => x.id === id)
  if (!r) throw createError({ statusCode: 404, statusMessage: 'That request no longer exists.' })
  return r
}

// ---------------------------------------------------------------------------
// Client page conversations, kept apart from projects so a project save can't drop a message
// ---------------------------------------------------------------------------

type Chats = Record<string, ChatTurn[]>

export async function getChat(projectId: string): Promise<ChatTurn[]> {
  return ((await db().getItem<Chats>('chats')) ?? {})[projectId] ?? []
}

export async function listChats(): Promise<Chats> {
  return (await db().getItem<Chats>('chats')) ?? {}
}

export async function appendChat(projectId: string, turn: Omit<ChatTurn, 'id' | 'at'>): Promise<ChatTurn> {
  const full: ChatTurn = { ...turn, id: newId(), at: new Date().toISOString() }
  await withLock(async () => {
    const chats = (await db().getItem<Chats>('chats')) ?? {}
    chats[projectId] = [...(chats[projectId] ?? []), full].slice(-80)
    await db().setItem('chats', chats)
  })
  publish({ type: 'change', projectId })
  return full
}

// ---------------------------------------------------------------------------
// Mandate
// ---------------------------------------------------------------------------

/** Suggested terms. Unsigned, so the agent has no authority until you sign. */
export const DEFAULT_MANDATE: Mandate = {
  reminders: 'friendly',
  extensionDays: 7,
  installments: 2,
  limit: 1000,
  signedAt: null,
  signedBy: null,
}

export async function getMandate(): Promise<Mandate> {
  return { ...DEFAULT_MANDATE, ...((await db().getItem<Mandate>('mandate')) ?? {}) }
}

export async function saveMandate(mandate: Mandate) {
  await withLock(() => db().setItem('mandate', mandate))
  publish({ type: 'change' })
  return mandate
}
