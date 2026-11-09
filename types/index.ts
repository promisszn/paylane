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

export type ReminderTone = 'friendly' | 'clear' | 'firm'

export interface IntakeAttachment {
  name: string
  /** MIME type, e.g. image/png, image/jpeg, image/webp, application/pdf */
  mediaType: string
  /** Base64-encoded payload (without data:...;base64, prefix) */
  data: string
}

export interface CurrencySummary {
  currency: string
  outstanding: number
  overdue: number
  paid: number
  pipeline: number
}

export interface Reminder {
  sentAt: string
  subject: string
  note: string
  tone?: ReminderTone
  /** "agent" when the agent sent it on its own under the mandate. */
  by?: 'agent' | 'you'
}

/** The client said they'll pay by a date. Reminders pause until it passes. */
export interface PaymentPromise {
  date: string
  at: string
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
  /** Demo mode moved the due date into the past. Sync then keeps our date instead of PayPal's. */
  demoBackdated?: boolean
  /** Extra days given on this invoice after it was sent. Only one extension per invoice. */
  extendedDays?: number
  promise?: PaymentPromise
  /** This invoice was cancelled and replaced by these installment milestones. */
  replacedBy?: string[]
  /** This milestone is one installment of a split invoice. */
  installment?: { of: string; index: number; count: number }
  /** Why the agent's last attempt to send a reminder on its own failed. Cleared when one goes out. */
  autoRemindError?: string
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
  /** Secret part of the client page URL (/pay/<token>). Whoever has it can see and discuss this job's invoices. */
  portalToken?: string
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

export type Actor = 'agent' | 'you' | 'paypal' | 'client'

/** Mandate clauses, numbered as they appear on the signed slip. */
export type Clause = 1 | 2 | 3 | 4

export interface ActivityEntry {
  id: string
  at: string
  actor: Actor
  text: string
  projectId?: string
  /** Set when the agent acted on its own. Names the mandate clause that allowed it. */
  clause?: Clause
}

/**
 * What the agent may do without asking, signed by the freelancer.
 * Enforced in server/utils/mandate.ts before every autonomous action.
 */
export interface Mandate {
  /** Clause 1: reminders the agent may send on its own, up to this tone. Firm notices always wait for you. */
  reminders: 'off' | 'friendly' | 'clear'
  /** Clause 2: extra days the agent may give a client to pay, once per invoice. 0 = never. */
  extensionDays: number
  /** Clause 3: most installments the agent may split an unpaid invoice into, two weeks apart. 1 = never. */
  installments: number
  /** Clause 4: the agent only acts alone on invoices up to this amount, in your default currency. */
  limit: number
  /** Null until signed. An unsigned mandate gives the agent no authority at all. */
  signedAt: string | null
  signedBy: string | null
}

/** Something the agent did during a chat turn, shown as a receipt line under its reply. */
export interface ChatAction {
  kind: 'extended' | 'split' | 'promise' | 'checked' | 'escalated' | 'approved' | 'declined'
  text: string
}

/** One message on the client page. "freelancer" is you replying from the dashboard. */
export interface ChatTurn {
  id: string
  role: 'client' | 'agent' | 'freelancer'
  text: string
  at: string
  actions?: ChatAction[]
}

/**
 * Something the client asked for that the mandate doesn't cover.
 * The agent hands it to you with the exact change ready, so approving is one click.
 */
export interface ClientRequest {
  id: string
  projectId: string
  milestoneId?: string
  at: string
  kind: 'extension' | 'installments' | 'other'
  /** The client's own words. */
  quote: string
  /** The agent's one-line summary for you. */
  summary: string
  /** Why the agent couldn't do it alone. */
  reason: string
  newDueDate?: string
  parts?: number
  status: 'open' | 'approved' | 'declined' | 'handled'
}

/** Something the agent thinks you should do next. Every money action outside the mandate waits for your click. */
export interface NextAction {
  kind: 'send_draft' | 'remind' | 'invoice_next' | 'client_request'
  projectId: string
  milestoneId: string
  title: string
  detail: string
  tone?: ReminderTone
  /** For client_request: the request to approve or decline. */
  requestId?: string
  requestKind?: ClientRequest['kind']
  quote?: string
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
  /** Relative link to this job's client page. */
  clientPage: string | null
  extendedDays: number
  promiseDate: string | null
  /** How many installments replaced this invoice (0 if it wasn't split). */
  splitInto: number
  installment: string | null
}

/** What the client page shows. Only this job, nothing internal. */
export interface PortalView {
  freelancer: { name: string; business: string }
  client: string
  project: string
  currency: string
  total: number
  paid: number
  due: number
  invoices: Array<{
    id: string
    number: string | null
    name: string
    description: string
    amount: number
    status: 'unpaid' | 'overdue' | 'paid' | 'replaced'
    dueDate: string | null
    daysOverdue: number
    payUrl: string | null
    extendedDays: number
    promiseDate: string | null
    installment: string | null
    replacedBy: string[]
  }>
  upcoming: Array<{ name: string; amount: number; when: string }>
  conversation: ChatTurn[]
  /** The agent's limits are never shown, only whether it has any authority. */
  agentCanHelp: boolean
}

export interface AppStatus {
  paypalReady: boolean
  aiReady: boolean
  paypalEnv: string
  aiProvider: string
  aiModel: string
  /** DEMO_MODE=true on sandbox: shows a "Backdate" button so the reminder flow can be recorded right away. */
  demoMode: boolean
  /** Where projects and activity are kept: Redis when REDIS_URL is set, else JSON files in .data/. */
  storage: 'redis' | 'files'
  /** Base URL client page links are built from (PUBLIC_URL, RENDER_EXTERNAL_URL or localhost). */
  publicUrl: string
  freelancer: { name: string; business: string; currency: string }
}
