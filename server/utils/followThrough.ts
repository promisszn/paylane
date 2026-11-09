/**
 * You reply to a client on their page and say yes to something: "$100 off the last payment",
 * "sure, pay it by the 30th", "fine, split it in two". The agent reads that reply, works out the
 * exact change, and makes it, so what you promised is what PayPal bills.
 *
 * Only your own replies are read this way, never the client's messages, so a client can't talk
 * the agent into a discount. The model only reads; applying goes through applyChange, and
 * every number it proposes is checked in code against the job first.
 */
import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { ChangeOutcome, ChatTurn, Milestone, TermsChange } from '../../types'

const changeSchema = z.object({
  changes: z
    .array(
      z.object({
        kind: z.enum(['amount', 'due_date', 'split']),
        payment: z.string().describe('The ref of the payment from the list, e.g. "p3".'),
        newAmount: z.number().nullable().describe('For amount: what the payment should charge after the change, e.g. 700 for $100 off 800. Otherwise null.'),
        newDueDate: z.string().nullable().describe('For due_date: the new due date, YYYY-MM-DD. Otherwise null.'),
        parts: z.number().int().nullable().describe('For split: how many payments, 2 to 6. Otherwise null.'),
        note: z.string().nullable().describe('For amount: a few words on why, e.g. "$100 off" or "10% discount". Otherwise null.'),
        quote: z.string().describe('The exact words in the reply that commit to this change, copied character for character.'),
        conditional: z.boolean().describe('True if the reply makes this depend on something the client has not done yet ("if you pay by Friday", "once you sign off").'),
      }),
    )
    .max(6),
})

function describe(m: Milestone, currency: string) {
  const status =
    m.status === 'planned'
      ? 'not billed yet'
      : m.status === 'draft'
        ? 'drafted, not sent yet'
        : m.status === 'sent'
          ? `sent, unpaid, due ${m.dueDate ?? 'unknown'}`
          : m.status
  return {
    name: m.name,
    invoiceNumber: m.invoiceNumber,
    amount: `${m.amount.toFixed(2)} ${currency}`,
    status,
    installment: m.installment ? `${m.installment.index} of ${m.installment.count}` : undefined,
  }
}

/**
 * Read what you just wrote, apply every change you agreed to, and tell the client.
 * `history` is the conversation before your reply.
 */
export async function followThrough(projectId: string, reply: string, history: ChatTurn[]): Promise<ChangeOutcome[]> {
  const { freelancer } = useRuntimeConfig()
  const first = freelancer.name.trim().split(/\s+/)[0] || freelancer.name
  const project = await getProject(projectId)
  const client = project.client.name

  // Short refs, so the model never has to copy an id. Cancelled invoices can't change.
  const payments = project.milestones.filter((m) => m.status !== 'cancelled')
  const refOf = new Map(payments.map((m, i) => [`p${i + 1}`, m]))
  const list = Object.fromEntries([...refOf].map(([ref, m]) => [ref, describe(m, project.currency)]))
  const requests = (await listRequests()).filter((r) => r.projectId === projectId && r.status === 'open').map((r) => r.summary)
  const conversation = history
    .slice(-12)
    .map((t) => `${t.role === 'client' ? client : t.role === 'agent' ? 'Assistant' : first}: ${t.text}`)
    .join('\n')

  progress(projectId, `Reading ${first}'s reply`)
  const { output } = await generateText({
    model: agentModel(),
    system: [
      `${first} is a freelancer. They just replied in person (newReply) to their client ${client} on the page where ${client} sees and pays the invoices for "${project.title}".`,
      `Your job: list every change to a payment that ${first} commits to in that reply, so it can be applied to the invoices exactly as promised.`,
      'Kinds of change:',
      '- amount: the payment should charge a different amount (a discount, a reduction, a correction, extra work). Give the final amount, not the difference.',
      '- due_date: a sent, unpaid invoice gets a later due date.',
      '- split: a sent, unpaid invoice is split into equal payments two weeks apart.',
      'Rules:',
      `- Only what ${first} clearly agrees to or offers in this reply, concrete enough to apply: which payment and what amount, date or number of parts. Use the conversation to resolve short answers like "yes, that's fine" to what ${client} asked for.`,
      `- Only the new reply counts. Everything in conversationBefore already happened and was already handled: never list a change because it was mentioned there.`,
      '- Leave out anything tentative ("maybe", "let me think"), a question, a refusal, or a promise about something other than these payments. If the reply makes a change depend on something the client has not done yet, still list it but set conditional to true.',
      '- "The last payment" is the last one in the list that is not paid. "The next payment" is the first one that is not paid. Never change a paid payment.',
      '- A discount on the whole job or "the rest" with no payment named goes on the last unpaid payment, unless the reply says how to spread it.',
      '- Percentages are of that payment\'s current amount. Keep cents exact.',
      '- Work dates out from today. If nothing applies, return an empty list.',
    ].join('\n'),
    prompt: JSON.stringify({
      today: isoDay(Date.now()),
      currency: project.currency,
      payments: list,
      openRequestsFrom: requests.length ? requests : undefined,
      conversationBefore: conversation || '(none)',
      newReply: reply,
    }),
    output: Output.object({ schema: changeSchema }),
  })

  // Check every proposed change against the job before anything touches PayPal.
  const changes: TermsChange[] = []
  // The quote must really be in this reply: a change only ever comes from what you just wrote.
  const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}%$€£.]+/gu, ' ').trim()
  const said = plain(reply)
  for (const c of output?.changes ?? []) {
    const m = refOf.get(c.payment.trim().toLowerCase())
    if (!m || m.status === 'paid' || c.conditional) continue
    if (!c.quote.trim() || !said.includes(plain(c.quote))) continue
    if (c.kind === 'amount' && c.newAmount != null && c.newAmount > 0) {
      changes.push({ kind: 'amount', milestoneId: m.id, amount: Math.round(c.newAmount * 100) / 100, note: c.note ?? undefined })
    } else if (c.kind === 'due_date' && c.newDueDate && m.status === 'sent') {
      changes.push({ kind: 'due_date', milestoneId: m.id, dueDate: c.newDueDate })
    } else if (c.kind === 'split' && c.parts && m.status === 'sent') {
      changes.push({ kind: 'split', milestoneId: m.id, parts: c.parts })
    }
  }
  if (!changes.length) return []

  // One at a time: a split adds payments, and each step reads the freshest copy of the job.
  const outcomes: ChangeOutcome[] = []
  for (const change of changes) outcomes.push(await applyChange(projectId, change, { actor: 'agent', via: 'reply' }))

  await tellClient(projectId, outcomes)
  for (const o of outcomes.filter((x) => !x.ok)) {
    await logActivity('agent', `You agreed to a change in your reply to ${client}, but it didn't go through. ${o.text} Make it from the ledger with Change.`, projectId)
  }
  return outcomes
}
