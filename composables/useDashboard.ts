import type {
  ActivityEntry,
  AppStatus,
  CurrencySummary,
  IntakeAttachment,
  NextAction,
  Project,
  ProjectPlan,
  ReceivableRow,
  ReminderTone,
} from '~/types'

export interface DashboardData {
  projects: Project[]
  rows: ReceivableRow[]
  actions: NextAction[]
  activity: ActivityEntry[]
  stats: CurrencySummary & { otherCurrencies?: CurrencySummary[] }
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
}

export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
}

export function errorText(err: any) {
  return err?.data?.statusMessage ?? err?.statusMessage ?? err?.data?.message ?? err?.message ?? 'Something went wrong'
}

export const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

/** Shared app state and the calls that change it. */
export function useDashboard() {
  const data = useState<DashboardData | null>('dashboard', () => null)
  const status = useState<AppStatus | null>('status', () => null)
  const plan = useState<ProjectPlan | null>('plan', () => null)
  const sourceMessage = useState('sourceMessage', () => '')
  const pendingEmail = useState<PendingEmail | null>('pendingEmail', () => null)
  const toasts = useState<Toast[]>('toasts', () => [])
  const busy = useState<string | null>('busy', () => null)

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /** Sonner-style: newest on top, max 3 visible, errors stay a little longer. */
  function notify(text: string, tone: Toast['tone'] = 'ok') {
    const id = Date.now() + Math.random()
    toasts.value = [{ id, text, tone }, ...toasts.value].slice(0, 3)
    setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500)
  }

  async function refresh() {
    data.value = await $fetch<DashboardData>('/api/dashboard')
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
    const res = await run('demo', () =>
      $fetch<{ milestone: { invoiceNumber?: string } }>('/api/demo/overdue', { method: 'POST', body: { projectId, milestoneId, days } }),
    )
    if (!res) return
    await refresh()
    notify(`Demo: ${res.milestone.invoiceNumber ?? 'Invoice'} is now ${days} days overdue.`)
  }

  async function syncPayPal() {
    const res = await run('sync', () => $fetch<{ checked: number; newlyPaid: string[] }>('/api/sync', { method: 'POST' }))
    if (!res) return
    await refresh()
    notify(res.newlyPaid.length ? `Paid: ${res.newlyPaid.join(', ')}` : `Checked ${res.checked} invoice${res.checked === 1 ? '' : 's'}. No new payments.`)
  }

  return {
    data,
    status,
    plan,
    pendingEmail,
    toasts,
    dismiss,
    busy,
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
    notify,
  }
}
