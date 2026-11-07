/** Everything the dashboard needs in one request. */
export default defineEventHandler(async () => {
  const projects = await listProjects()
  const rows = toRows(projects)
  const { freelancer } = useRuntimeConfig()

  // Totals in the default currency. Other currencies are listed separately in the grid.
  const inBase = rows.filter((r) => r.currency === freelancer.currency)
  const sum = (list: typeof rows) => Math.round(list.reduce((s, r) => s + r.amount, 0) * 100) / 100

  return {
    projects,
    rows,
    actions: nextActions(projects),
    activity: (await listActivity()).slice(0, 30),
    stats: {
      currency: freelancer.currency,
      outstanding: sum(inBase.filter((r) => r.status === 'sent')),
      overdue: sum(inBase.filter((r) => r.status === 'sent' && r.daysOverdue > 0)),
      paid: sum(inBase.filter((r) => r.status === 'paid')),
      pipeline: sum(inBase.filter((r) => r.status === 'planned' || r.status === 'draft')),
    },
  }
})
