import type { CurrencySummary } from '../../types'

/** Everything the dashboard needs in one request. */
export default defineEventHandler(async () => {
  const projects = await listProjects()
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

  return {
    projects,
    rows,
    actions: nextActions(projects),
    activity: (await listActivity()).slice(0, 30),
    stats: {
      ...summarize(freelancer.currency, inBase),
      otherCurrencies,
    },
  }
})
