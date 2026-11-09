import type { CurrencySummary } from '../../types'

const WEEK = 7 * 86_400_000

/** Everything the dashboard needs in one request. */
export default defineEventHandler(async () => {
  const projects = await ensurePortalTokens(await listProjects())
  const [activity, requests, mandate, chats] = await Promise.all([listActivity(), listRequests(), getMandate(), listChats()])
  const rows = toRows(projects)
  const { freelancer } = useRuntimeConfig()

  const sum = (list: typeof rows) => Math.round(list.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const summarize = (currency: string, list: typeof rows): CurrencySummary => ({
    currency,
    outstanding: sum(list.filter((r) => r.status === 'sent')),
    overdue: sum(list.filter((r) => r.status === 'sent' && r.daysOverdue > 0)),
    paid: sum(list.filter((r) => r.status === 'paid')),
    pipeline: sum(list.filter((r) => r.status === 'planned' || r.status === 'draft')),
  })

  // Totals in the default currency. Other currencies are listed separately in the grid and summary.
  const inBase = rows.filter((r) => r.currency === freelancer.currency)
  const extraCodes = [...new Set(rows.map((r) => r.currency).filter((c) => c !== freelancer.currency))]
  const otherCurrencies = extraCodes.map((c) => summarize(c, rows.filter((r) => r.currency === c)))

  // One line per job that has a client page conversation, newest first.
  const conversations = projects
    .filter((p) => chats[p.id]?.length)
    .map((p) => {
      const turns = chats[p.id]!
      const last = turns.at(-1)!
      return { projectId: p.id, client: p.client.name, project: p.title, count: turns.length, lastAt: last.at, lastRole: last.role, lastText: last.text }
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))

  const weekAgo = Date.now() - WEEK
  const handledAlone = activity.filter((e) => e.clause && Date.parse(e.at) > weekAgo).length

  return {
    projects,
    rows,
    actions: nextActions(projects, requests, mandate),
    activity: activity.slice(0, 40),
    mandate,
    conversations,
    stats: {
      ...summarize(freelancer.currency, inBase),
      otherCurrencies,
      handledAlone,
    },
  }
})
