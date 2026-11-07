/**
 * Tiny JSON store on top of Nitro storage (./.data/db on disk).
 * Good enough for a single freelancer and keeps the project runnable with zero setup.
 */
import { randomUUID } from 'node:crypto'
import type { ActivityEntry, Actor, Milestone, Project } from '../../types'

const db = () => useStorage('db')

export const newId = () => randomUUID().slice(0, 8)

export async function listProjects(): Promise<Project[]> {
  return (await db().getItem<Project[]>('projects')) ?? []
}

export async function saveProjects(projects: Project[]) {
  await db().setItem('projects', projects)
}

export async function getProject(id: string): Promise<Project> {
  const project = (await listProjects()).find((p) => p.id === id)
  if (!project) throw createError({ statusCode: 404, statusMessage: `Project ${id} not found` })
  return project
}

export async function upsertProject(project: Project) {
  const projects = await listProjects()
  const i = projects.findIndex((p) => p.id === project.id)
  if (i === -1) projects.unshift(project)
  else projects[i] = project
  await saveProjects(projects)
  return project
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

export async function listActivity(): Promise<ActivityEntry[]> {
  return (await db().getItem<ActivityEntry[]>('activity')) ?? []
}

export async function logActivity(actor: Actor, text: string, projectId?: string) {
  const entries = await listActivity()
  entries.unshift({ id: newId(), at: new Date().toISOString(), actor, text, projectId })
  await db().setItem('activity', entries.slice(0, 200))
}
