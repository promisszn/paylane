/**
 * Shared types for the client (pages/components) and the server (Nitro routes).
 */

/** When a milestone should be billed. */
export type MilestoneTrigger = 'upfront' | 'on_completion'

/**
 * Lifecycle of one billable milestone.
 * planned   -> agent proposed it, nothing exists on PayPal yet
 * draft     -> a PayPal draft invoice exists, waiting for your approval to send
 * sent      -> invoice is with the client (SENT / UNPAID on PayPal)
 * paid      -> PayPal reports PAID (via webhook or sync)
 * cancelled -> invoice cancelled on PayPal
 */
export type MilestoneStatus = 'planned' | 'draft' | 'sent' | 'paid' | 'cancelled'

export interface Reminder {
  sentAt: string
  subject: string
  note: string
}

export interface Milestone {
  id: string
  name: string
  description: string
  amount: number
  trigger: MilestoneTrigger
  /** Days the client has to pay once the invoice is sent. */
  dueDays: number
  status: MilestoneStatus
  completedAt?: string
  invoiceId?: string
  invoiceNumber?: string
  /** Link the client uses to pay. Comes from PayPal once the invoice is sent. */
  payerUrl?: string
  /** Subject and note the agent drafted for the invoice email. */
  draftSubject?: string
  draftNote?: string
  sentAt?: string
  dueDate?: string
  paidAt?: string
  reminders: Reminder[]
}

export interface Client {
  name: string
  email: string
}

export interface Project {
  id: string
  title: string
  client: Client
  currency: string
  total: number
  /** The raw client message the plan was built from. */
  sourceMessage: string
  createdAt: string
  milestones: Milestone[]
}

/** What the agent proposes from a client message. Nothing is saved or sent yet. */
export interface ProjectPlan {
  title: string
  summary: string
  client: { name: string; email: string | null }
  currency: string
  total: number
  milestones: Array<Pick<Milestone, 'name' | 'description' | 'amount' | 'trigger' | 'dueDays'>>
  /** Things the agent could not work out and wants you to confirm. */
  questions: string[]
}

export type Actor = 'agent' | 'you' | 'paypal'

export interface ActivityEntry {
  id: string
  at: string
  actor: Actor
  text: string
  projectId?: string
}

/** Something the agent thinks you should do next. Every money action waits for your click. */
export interface NextAction {
  kind: 'send_draft' | 'remind' | 'invoice_next'
  projectId: string
  milestoneId: string
  title: string
  detail: string
}

/** One row in the receivables grid. */
export interface ReceivableRow {
  projectId: string
  milestoneId: string
  client: string
  project: string
  milestone: string
  amount: number
  currency: string
  status: MilestoneStatus
  trigger: MilestoneTrigger
  invoiceNumber: string | null
  sentAt: string | null
  dueDate: string | null
  daysOverdue: number
  reminders: number
  payerUrl: string | null
}

export interface AppStatus {
  paypalReady: boolean
  aiReady: boolean
  paypalEnv: string
  aiProvider: string
  aiModel: string
  freelancer: { name: string; business: string; currency: string }
}
