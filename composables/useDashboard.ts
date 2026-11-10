import type {
  ActivityEntry,
  AppStatus,
  ChangeOutcome,
  ChatTurn,
  CurrencySummary,
  IntakeAttachment,
  Mandate,
  NextAction,
  Project,
  ProjectPlan,
  ReceivableRow,
  ReminderTone,
  TermsChange,
} from '~/types'

export interface ConversationSummary {
  projectId: string
  client: string
  project: string
  count: number
  lastAt: string
  lastRole: ChatTurn['role']
  lastText: string
}

export interface DashboardData {
  projects: Project[]
  rows: ReceivableRow[]
  actions: NextAction[]
  activity: ActivityEntry[]
  mandate: Mandate
  conversations: ConversationSummary[]
  stats: CurrencySummary & { otherCurrencies?: CurrencySummary[]; handledAlone: number }
}

/** The email the user reviews before anything is sent. */
export interface PendingEmail {
  mode: 'invoice' | 'reminder'
  projectId: string
  milestoneId: string
  heading: string
  to: string
  subject: string
  note: string
  tone?: ReminderTone
  /** The line Paylane adds below the note, pointing the client at their page. */
  footer?: string
}

/** A client page conversation open in the dialog, optionally answering one request. */
export interface OpenConversation {
  projectId: string
  client: string
  project: string
  clientPage: string | null
  turns: ChatTurn[]
  requestId?: string
}

/** The payment open in the Change dialog. */
export interface ChangingPayment {
  projectId: string
  milestoneId: string
}

export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error' | 'agent'
}

export function errorText(err: any) {
  return err?.data?.statusMessage ?? err?.statusMessage ?? err?.data?.message ?? err?.message ?? 'Something went wrong'
}

export const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

// ---------------------------------------------------------------------------
// Toast timers pause while the tab is hidden or the stack is hovered, as in Sonner. A payment or
// an agent action announced while you're on a client page's tab is still there when you return.
// ---------------------------------------------------------------------------

interface ToastTimer {
  left: number
  since: number
  handle?: ReturnType<typeof setTimeout>
  fire: () => void
}
const toastTimers = new Map<number, ToastTimer>()
const pauseReasons = new Set<string>()

function runToastTimer(id: number) {
  const t = toastTimers.get(id)
  if (!t || pauseReasons.size) return
  t.since = Date.now()
  t.handle = setTimeout(() => {
    toastTimers.delete(id)
    t.fire()
  }, t.left)
}

export function pauseToasts(reason: 'hover' | 'hidden') {
  if (pauseReasons.has(reason)) return
  pauseReasons.add(reason)
  if (pauseReasons.size > 1) return
  for (const t of toastTimers.values()) {
    clearTimeout(t.handle)
    // Leave enough time to read it once you're back.
    t.left = Math.max(1500, t.left - (Date.now() - t.since))
  }
}

export function resumeToasts(reason: 'hover' | 'hidden') {
  if (!pauseReasons.delete(reason) || pauseReasons.size) return
  for (const id of toastTimers.keys()) runToastTimer(id)
}

if (import.meta.client) {
  document.addEventListener('visibilitychange', () => (document.hidden ? pauseToasts('hidden') : resumeToasts('hidden')))
  if (document.hidden) pauseToasts('hidden')
}

/** Shared app state and the calls that change it. */
export function useDashboard() {
  const data = useState<DashboardData | null>('dashboard', () => null)
  const status = useState<AppStatus | null>('status', () => null)
  const plan = useState<ProjectPlan | null>('plan', () => null)
  const sourceMessage = useState('sourceMessage', () => '')
  const pendingEmail = useState<PendingEmail | null>('pendingEmail', () => null)
  const conversation = useState<OpenConversation | null>('conversation', () => null)
  const changing = useState<ChangingPayment | null>('changing', () => null)
  /** The mandate panel, opened from the top bar, a suggestion or a clause tag in the activity log. */
  const mandateOpen = useState('mandateOpen', () => false)
  const toasts = useState<Toast[]>('toasts', () => [])
  const busy = useState<string | null>('busy', () => null)
  /** What the agent is doing on a client page right now, for the live line on the dashboard. */
  const agentProgress = useState<{ text: string; client: string; at: number } | null>('agentProgress', () => null)
  /** Milestones that just turned paid, so the ledger and stamps can mark the moment. */
  const justPaid = useState<string[]>('justPaid', () => [])
  /** What's been announced already, so a live refresh and a click racing each other toast once. */
  const announced = useState<string[]>('announced', () => [])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
    clearTimeout(toastTimers.get(id)?.handle)
    toastTimers.delete(id)
  }

  /** Sonner-style: newest on top, max 3 visible, errors and agent news stay a little longer. */
  function notify(text: string, tone: Toast['tone'] = 'ok') {
    const id = Date.now() + Math.random()
    const next = [{ id, text, tone }, ...toasts.value]
    for (const dropped of next.slice(3)) dismiss(dropped.id)
    toasts.value = next.slice(0, 3)
    toastTimers.set(id, { left: tone === 'error' ? 7000 : tone === 'agent' ? 6500 : 4500, since: Date.now(), fire: () => dismiss(id) })
    runToastTimer(id)
  }

  /**
   * Re-fetch everything, and tell the user about what changed without them: payments that
   * landed and things the agent did on its own or was asked by a client. On by default, so a
   * refresh after one of your own clicks never swallows something the agent did meanwhile.
   * Each thing is announced once (see `announced`).
   */
  async function refresh(announce = true) {
    const before = data.value
    const next = await $fetch<DashboardData>('/api/dashboard')
    data.value = next
    if (!announce || !before) return

    const done = new Set(announced.value)
    const fresh = (key: string) => !done.has(key) && Boolean(done.add(key))

    const wasPaid = new Set(before.rows.filter((r) => r.status === 'paid').map((r) => r.milestoneId))
    const paidNow = next.rows.filter((r) => r.status === 'paid' && !wasPaid.has(r.milestoneId) && fresh(`paid:${r.milestoneId}`))
    for (const r of paidNow) notify(`${r.client} paid ${formatMoney(r.amount, r.currency)} for invoice ${r.invoiceNumber ?? r.milestone}.`)
    if (paidNow.length) {
      justPaid.value = paidNow.map((r) => r.milestoneId)
      setTimeout(() => (justPaid.value = []), 2500)
    }

    const seen = new Set(before.activity.map((e) => e.id))
    for (const e of next.activity.filter((x) => !seen.has(x.id)).reverse()) {
      if (!fresh(`activity:${e.id}`)) continue
      if (e.actor === 'agent' && e.clause) notify(`On its own: ${e.text}`, 'agent')
      else if (e.actor === 'client') notify(e.text.replace(/ The agent passed it to you\.$/, ' Waiting for you in Agent suggests.'), 'agent')
    }
    announced.value = [...done].slice(-300)
  }

  async function loadStatus() {
    status.value = await $fetch<AppStatus>('/api/status')
  }

  /** Wraps a call with a busy flag and turns errors into a toast. */
  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    busy.value = key
    try {
      return await fn()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      busy.value = null
    }
  }

  const findProject = (id: string) => data.value?.projects.find((p) => p.id === id)

  function clientPageLine(project: Project) {
    if (!project.portalToken || !status.value) return undefined
    return `Questions, or need more time to pay? Ask my assistant: ${status.value.publicUrl}/pay/${project.portalToken}`
  }

  async function planJob(message: string, attachment?: IntakeAttachment) {
    const res = await run('plan', () =>
      $fetch<{ plan: ProjectPlan }>('/api/agent/plan', { method: 'POST', body: { message, attachment } }),
    )
    if (res) {
      plan.value = res.plan
      sourceMessage.value = message || (attachment ? `[Attached: ${attachment.name}]` : '')
    }
  }

  async function approvePlan(edited: ProjectPlan & { client: { name: string; email: string } }) {
    const res = await run('approve', () =>
      $fetch<{ project: Project; errors: string[] }>('/api/projects', {
        method: 'POST',
        body: { plan: edited, sourceMessage: sourceMessage.value },
      }),
    )
    if (!res) return
    plan.value = null
    sourceMessage.value = ''
    await refresh()
    if (res.errors.length) notify(res.errors.join(' '), 'error')
    else notify(`Saved "${res.project.title}". Deposit invoice drafted, review it in the suggestions.`)
  }

  async function milestoneAction(action: string, projectId: string, milestoneId: string, extra: Record<string, string> = {}) {
    return run(`${action}:${milestoneId}`, () =>
      $fetch<{ project: Project; milestone: Project['milestones'][number]; reminderDraft?: { subject: string; note: string; tone?: ReminderTone } }>(
        `/api/milestones/${action}`,
        { method: 'POST', body: { projectId, milestoneId, ...extra } },
      ),
    )
  }

  /** Open the review dialog for an invoice. Drafts it first if the agent hasn't yet. */
  async function reviewInvoice(projectId: string, milestoneId: string, markDone = false) {
    const project = findProject(projectId)
    let milestone = project?.milestones.find((m) => m.id === milestoneId)
    if (!project || !milestone) return

    if (markDone || !milestone.draftNote) {
      const res = await milestoneAction(markDone ? 'complete' : 'draft', projectId, milestoneId)
      if (!res) return
      milestone = res.milestone
      await refresh()
    }

    pendingEmail.value = {
      mode: 'invoice',
      projectId,
      milestoneId,
      heading: `Send ${milestone.name}: ${formatMoney(milestone.amount, project.currency)}`,
      to: `${project.client.name} <${project.client.email}>`,
      subject: milestone.draftSubject ?? '',
      note: milestone.draftNote ?? '',
      footer: clientPageLine(project),
    }
  }

  async function reviewReminder(projectId: string, milestoneId: string) {
    const project = findProject(projectId)
    const res = await milestoneAction('reminder-draft', projectId, milestoneId)
    if (!res?.reminderDraft || !project) return
    pendingEmail.value = {
      mode: 'reminder',
      projectId,
      milestoneId,
      heading: `Remind ${project.client.name} about ${res.milestone.invoiceNumber}`,
      to: `${project.client.name} <${project.client.email}>`,
      ...res.reminderDraft,
      footer: clientPageLine(project),
    }
  }

  async function sendPending(subject: string, note: string) {
    const email = pendingEmail.value
    if (!email) return
    const res = await milestoneAction(email.mode === 'invoice' ? 'send' : 'remind', email.projectId, email.milestoneId, { subject, note })
    if (!res) return
    pendingEmail.value = null
    await refresh()
    notify(email.mode === 'invoice' ? `Invoice ${res.milestone.invoiceNumber} sent through PayPal.` : 'Reminder sent through PayPal.')
  }

  async function cancelMilestone(projectId: string, milestoneId: string) {
    const res = await milestoneAction('cancel', projectId, milestoneId)
    if (res) {
      await refresh()
      notify('Invoice cancelled.')
    }
  }

  /**
   * Demo mode: push a sent invoice further overdue, one reminder tone at a time
   * (2 days = friendly, 10 = clear, 20 = firm). Only our local copy changes.
   */
  async function makeOverdue(projectId: string, milestoneId: string, currentDaysOverdue: number) {
    const days = currentDaysOverdue < 2 ? 2 : currentDaysOverdue < 10 ? 10 : currentDaysOverdue < 20 ? 20 : currentDaysOverdue + 10
    // The server waits for the agent's reminder pass, so this resolves after any reminder it sent.
    const res = await run(`demo:${milestoneId}`, () =>
      $fetch<{ milestone: { invoiceNumber?: string } }>('/api/demo/overdue', { method: 'POST', body: { projectId, milestoneId, days } }),
    )
    if (!res) return
    notify(`Demo: ${res.milestone.invoiceNumber ?? 'Invoice'} is now ${days} days overdue.`)
    // Announces the reminder the agent sent on its own, if it sent one (newest toast on top).
    await refresh()
  }

  async function syncPayPal() {
    const res = await run('sync', () => $fetch<{ checked: number; newlyPaid: string[] }>('/api/sync', { method: 'POST' }))
    if (!res) return
    // New payments are announced by the refresh itself (once, even if the live update got there first).
    await refresh(true)
    if (!res.newlyPaid.length) notify(`Checked ${res.checked} invoice${res.checked === 1 ? '' : 's'}. No new payments.`)
  }

  // ---------------------------------------------------------------------------
  // The mandate, client requests and client page conversations
  // ---------------------------------------------------------------------------

  async function signMandate(terms: Pick<Mandate, 'reminders' | 'extensionDays' | 'installments' | 'limit'>) {
    const res = await run('mandate', () => $fetch<{ mandate: Mandate }>('/api/mandate', { method: 'PUT', body: { action: 'sign', ...terms } }))
    if (!res) return false
    await refresh()
    notify('Mandate signed. The agent can now act within it, and asks you about everything else.')
    return true
  }

  async function revokeMandate() {
    const res = await run('mandate', () => $fetch<{ mandate: Mandate }>('/api/mandate', { method: 'PUT', body: { action: 'revoke' } }))
    if (!res) return
    await refresh()
    notify('Mandate revoked. The agent asks you before everything again.')
  }

  async function decideRequest(requestId: string, decision: 'approve' | 'decline' | 'handled') {
    const res = await run(`request:${requestId}`, () =>
      // A plain string URL keeps Nitro's route typing from recursing on the template literal.
      $fetch<{ ok: boolean }>(`/api/requests/${requestId}/${decision}` as string, { method: 'POST' }),
    )
    if (res === undefined) return
    await refresh()
    notify(
      decision === 'approve'
        ? 'Approved. PayPal has the new terms, and the agent told your client.'
        : decision === 'decline'
          ? 'Declined. The agent told your client the current terms stand.'
          : 'Marked as handled.',
    )
  }

  async function openConversation(projectId: string, requestId?: string) {
    const res = await run(`chat:${projectId}`, () => $fetch<Omit<OpenConversation, 'requestId'>>(`/api/chats/${projectId}`))
    if (res) conversation.value = { ...res, requestId }
  }

  /** Re-read the open conversation, e.g. when the client writes while you're reading. */
  async function reloadConversation() {
    const open = conversation.value
    if (!open) return
    const res = await $fetch<Omit<OpenConversation, 'requestId'>>(`/api/chats/${open.projectId}`).catch(() => null)
    if (res && conversation.value?.projectId === open.projectId) conversation.value = { ...res, requestId: conversation.value.requestId }
  }

  /**
   * Post your reply. With `apply`, the agent then reads it and makes any change to a payment
   * you agreed to (a discount, more time, a split), and says so on the client's page.
   */
  async function sendReply(text: string, apply = true) {
    const open = conversation.value
    if (!open) return false
    const res = await run('reply', () =>
      $fetch<{ changes: ChangeOutcome[]; followError?: string }>(`/api/chats/${open.projectId}` as string, {
        method: 'POST',
        body: { text, requestId: open.requestId, apply },
      }),
    )
    if (res === undefined) return false
    conversation.value = { ...open, requestId: undefined }
    await Promise.all([reloadConversation(), refresh()])
    notify(`Reply posted on ${open.client}'s page.`)
    for (const c of res.changes) notify(c.ok ? `On your word: ${c.text}` : c.text, c.ok ? 'agent' : 'error')
    if (res.followError) notify(res.followError, 'error')
    return true
  }

  // ---------------------------------------------------------------------------
  // Changing a payment yourself: amount, due date or split
  // ---------------------------------------------------------------------------

  function openChange(projectId: string, milestoneId: string) {
    changing.value = { projectId, milestoneId }
  }

  type ChangeInput =
    | Omit<Extract<TermsChange, { kind: 'amount' }>, 'milestoneId'>
    | Omit<Extract<TermsChange, { kind: 'due_date' }>, 'milestoneId'>
    | Omit<Extract<TermsChange, { kind: 'split' }>, 'milestoneId'>

  async function changePayment(change: ChangeInput, tellClient: boolean) {
    const target = changing.value
    if (!target) return false
    const res = await run('change', () =>
      $fetch<ChangeOutcome>('/api/milestones/change', { method: 'POST', body: { ...target, ...change, tellClient } }),
    )
    if (!res) return false
    changing.value = null
    await refresh()
    notify(res.text)
    return true
  }

  return {
    data,
    status,
    plan,
    pendingEmail,
    conversation,
    changing,
    mandateOpen,
    toasts,
    dismiss,
    busy,
    agentProgress,
    justPaid,
    refresh,
    loadStatus,
    planJob,
    approvePlan,
    reviewInvoice,
    reviewReminder,
    sendPending,
    cancelMilestone,
    makeOverdue,
    syncPayPal,
    signMandate,
    revokeMandate,
    decideRequest,
    openConversation,
    reloadConversation,
    sendReply,
    openChange,
    changePayment,
    notify,
  }
}

