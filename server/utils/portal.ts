/**
 * What the client page shows: one job's invoices, its payment schedule and the conversation.
 * Nothing internal (drafts, your notes, the source message, other clients) and never the
 * agent's limits, only whether it can help at all.
 */
import type { PortalView, Project } from '../../types'

export async function portalView(project: Project): Promise<PortalView> {
  const { freelancer } = useRuntimeConfig()
  const [mandate, conversation] = await Promise.all([getMandate(), getChat(project.id)])
  const numberOf = (id: string) => project.milestones.find((m) => m.id === id)?.invoiceNumber ?? ''

  const visible = project.milestones.filter(
    (m) => m.status === 'sent' || m.status === 'paid' || (m.status === 'cancelled' && m.replacedBy?.length),
  )
  const invoices: PortalView['invoices'] = visible.map((m) => ({
    id: m.id,
    number: m.invoiceNumber ?? null,
    name: m.name,
    description: m.description,
    amount: m.amount,
    status: m.status === 'paid' ? 'paid' : m.status === 'cancelled' ? 'replaced' : daysOverdue(m) > 0 ? 'overdue' : 'unpaid',
    dueDate: m.status === 'sent' ? (m.dueDate ?? null) : null,
    daysOverdue: daysOverdue(m),
    payUrl: m.status === 'sent' ? (m.payerUrl ?? null) : null,
    extendedDays: m.extendedDays ?? 0,
    promiseDate: promiseActive(m) ? m.promise!.date : null,
    installment: m.installment ? `${m.installment.index} of ${m.installment.count}` : null,
    replacedBy: (m.replacedBy ?? []).map(numberOf).filter(Boolean),
    wasAmount: m.adjusted?.from ?? null,
  }))

  const sum = (status: PortalView['invoices'][number]['status'][]) =>
    Math.round(invoices.filter((i) => status.includes(i.status)).reduce((s, i) => s + i.amount, 0) * 100) / 100

  return {
    freelancer: { name: freelancer.name, business: freelancer.business },
    client: project.client.name,
    project: project.title,
    currency: project.currency,
    total: project.total,
    paid: sum(['paid']),
    due: sum(['unpaid', 'overdue']),
    invoices,
    upcoming: project.milestones
      .filter((m) => m.status === 'planned' || m.status === 'draft')
      .map((m) => ({
        name: m.name,
        amount: m.amount,
        when: m.trigger === 'upfront' ? 'Billed soon' : 'Billed when the work is done',
        wasAmount: m.adjusted?.from ?? null,
      })),
    conversation,
    agentCanHelp: mandateActive(mandate),
  }
}

/** The client page's token, checked. Throws a 404 the page can show. */
export async function projectForToken(token: string | undefined) {
  const project = await findByPortalToken(token ?? '')
  if (!project) throw createError({ statusCode: 404, statusMessage: 'This payment link isn’t valid any more. Ask for a new one.' })
  return project
}
