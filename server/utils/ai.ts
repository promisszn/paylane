/**
 * The agent's "brain". Three jobs, each a single structured call to the model:
 *   1. planFromMessage   - read a client message, propose milestones and amounts
 *   2. draftInvoiceEmail - write the subject + note for an invoice
 *   3. draftReminder     - write a reminder whose tone fits how late the payment is
 *
 * The model never moves money by itself. Every PayPal action that sends something
 * to the client goes through a route the freelancer has to click (see server/api/milestones).
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output, type UserContent } from 'ai'
import { z } from 'zod'
import type { IntakeAttachment, Milestone, Project, ProjectPlan, ReminderTone } from '../../types'

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5-mini',
  // Flash-Lite has a much larger free-tier daily quota than Flash.
  google: 'gemini-flash-lite-latest',
} as const

type Provider = keyof typeof DEFAULT_MODELS

const KEY_ENV: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
}

export function aiInfo() {
  const { ai } = useRuntimeConfig()
  // Gemini is the default (free tier); Claude and OpenAI are opt-in.
  const provider: Provider = ai.provider === 'anthropic' || ai.provider === 'openai' ? ai.provider : 'google'
  const key = { anthropic: ai.anthropicKey, openai: ai.openaiKey, google: ai.googleKey }[provider]
  return { provider, model: ai.model || DEFAULT_MODELS[provider], ready: Boolean(key), key }
}

function model() {
  const info = aiInfo()
  if (!info.ready) {
    throw createError({
      statusCode: 500,
      statusMessage: `No AI key set. Add ${KEY_ENV[info.provider]} to .env`,
    })
  }
  if (info.provider === 'openai') return createOpenAI({ apiKey: info.key })(info.model)
  if (info.provider === 'google') return createGoogleGenerativeAI({ apiKey: info.key })(info.model)
  return createAnthropic({ apiKey: info.key })(info.model)
}

async function structured<T>(
  schema: z.ZodType<T>,
  system: string,
  promptOrContent: string | UserContent,
): Promise<T> {
  const { output } = await generateText({
    model: model(),
    system,
    ...(typeof promptOrContent === 'string'
      ? { prompt: promptOrContent }
      : { messages: [{ role: 'user', content: promptOrContent }] }),
    output: Output.object({ schema }),
  })
  if (!output) throw createError({ statusCode: 502, statusMessage: 'The model returned no usable output. Try again.' })
  return output as T
}

// ---------------------------------------------------------------------------
// 1. Plan a project from a client message
// ---------------------------------------------------------------------------

const planSchema = z.object({
  title: z.string().describe('Short project name, e.g. "Bakery landing page"'),
  summary: z.string().describe('One sentence on what the agent understood, in plain English'),
  client: z.object({
    name: z.string().describe('Client name, or "Client" if not given'),
    email: z.string().nullable().describe('Client email if it appears in the message, otherwise null'),
  }),
  currency: z.string().length(3).describe('ISO 4217 code, e.g. USD'),
  total: z.number().positive(),
  milestones: z
    .array(
      z.object({
        name: z.string().describe('e.g. "Deposit (50%)" or "Final delivery"'),
        description: z.string().describe('What this payment covers, as it should appear on the invoice line'),
        amount: z.number().positive(),
        trigger: z.enum(['upfront', 'on_completion']).describe('upfront = bill now, on_completion = bill when the work is done'),
        dueDays: z.number().int().min(0).max(90).describe('Days the client has to pay after receiving the invoice'),
      }),
    )
    .min(1)
    .max(6),
  questions: z.array(z.string()).describe('Anything ambiguous the freelancer should confirm before invoicing. Empty if all clear.'),
})

export async function planFromMessage(
  message: string,
  defaultCurrency: string,
  attachment?: IntakeAttachment,
): Promise<ProjectPlan> {
  const today = new Date().toISOString().slice(0, 10)
  const textPrompt = message.trim()
    ? `Client message:\n"""\n${message}\n"""`
    : 'Extract the deal details, client, total and payment milestones from the attached screenshot or document.'

  const userContent: string | UserContent = attachment
    ? [
        { type: 'text', text: textPrompt },
        attachment.mediaType.startsWith('image/')
          ? { type: 'image', image: attachment.data, mediaType: attachment.mediaType }
          : { type: 'file', data: attachment.data, mediaType: attachment.mediaType, filename: attachment.name },
      ]
    : textPrompt

  const plan = await structured(
    planSchema,
    [
      'You are the billing assistant for an independent freelancer.',
      'You read a message, chat screenshot or scope document from a client (or the freelancer\'s own notes about a deal) and turn it into a payment plan of milestones.',
      `Today's date is ${today}. Use this when a message mentions relative timing (e.g. "net 14" = 14 dueDays, "due upon receipt" = 0 dueDays).`,
      'Rules:',
      '- Milestone amounts MUST add up exactly to the total.',
      '- If the message mentions a deposit or "half upfront", make that the first milestone with trigger "upfront".',
      '- If no split is mentioned and the total is above 300, propose 50% upfront and 50% on completion, and add a question asking the freelancer to confirm the split.',
      `- If no currency is mentioned, use ${defaultCurrency}.`,
      '- Default dueDays: 3 for deposits, 7 for everything else, unless the message says otherwise.',
      '- Never invent an email address. If none is given, set email to null and add a question asking for it.',
      '- Keep names and descriptions short and professional. They appear on a real invoice.',
    ].join('\n'),
    userContent,
  )

  // Guard against rounding drift so the invoice totals always match the deal.
  const sum = plan.milestones.reduce((s, m) => s + m.amount, 0)
  const diff = Math.round((plan.total - sum) * 100) / 100
  if (diff !== 0 && plan.milestones.length) {
    const last = plan.milestones[plan.milestones.length - 1]!
    last.amount = Math.round((last.amount + diff) * 100) / 100
  }
  plan.currency = plan.currency.toUpperCase()
  return plan
}

// ---------------------------------------------------------------------------
// 2. Draft the email that goes out with an invoice
// ---------------------------------------------------------------------------

const emailSchema = z.object({
  subject: z.string().max(120),
  note: z.string().max(900).describe('2 to 4 short sentences. Plain text, no markdown, no placeholders.'),
})

export async function draftInvoiceEmail(project: Project, milestone: Milestone) {
  const { freelancer } = useRuntimeConfig()
  return structured(
    emailSchema,
    [
      `You write invoice emails for ${freelancer.name} (${freelancer.business}), a freelancer.`,
      'Tone: warm, direct, professional. Sound like a real person, not a company.',
      'Mention what the payment is for and the due date. Do not mention AI. Sign off with the freelancer\'s first name.',
    ].join('\n'),
    JSON.stringify({
      client: project.client.name,
      project: project.title,
      milestone: milestone.name,
      covers: milestone.description,
      amount: `${milestone.amount.toFixed(2)} ${project.currency}`,
      dueInDays: milestone.dueDays,
      otherMilestones: project.milestones.filter((m) => m.id !== milestone.id).map((m) => `${m.name} (${m.status})`),
    }),
  )
}

// ---------------------------------------------------------------------------
// 3. Draft a payment reminder
// ---------------------------------------------------------------------------

export async function draftReminder(project: Project, milestone: Milestone, daysOverdue: number) {
  const { freelancer } = useRuntimeConfig()
  const previous = milestone.reminders.length
  // Spell out the due state so the model never has to guess from a bare date.
  const today = new Date().toISOString().slice(0, 10)
  const daysUntilDue = milestone.dueDate
    ? Math.round((new Date(`${milestone.dueDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000)
    : null
  const dueLabel = milestone.dueDate
    ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${milestone.dueDate}T00:00:00Z`))
    : null
  const dueState =
    daysOverdue > 0
      ? `overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`
      : daysUntilDue === null
        ? 'no due date'
        : daysUntilDue > 0
          ? `not due yet, due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} on ${dueLabel}`
          : daysUntilDue === 0
            ? 'due today'
            : `past its due date of ${dueLabel}, within the grace period`
  // The tone is a rule, not a model judgement, so it is predictable and matches the docs.
  const tone = reminderTone(daysOverdue, previous)
  const draft = await structured(
    emailSchema,
    [
      `You write payment reminders for ${freelancer.name}, a freelancer who wants to get paid AND keep the client.`,
      'Write in the tone given in the "tone" field:',
      '- friendly: light nudge. The subject may say "friendly reminder".',
      '- clear: polite but direct. Restate the amount and invoice number. The subject names the invoice number and says it is overdue; do not call it friendly.',
      '- firm: calm and firm. Ask for a specific payment date and say further work is paused until it is settled. The subject says the payment is overdue; do not call it friendly or gentle.',
      'Use the "dueState" field as the only truth about timing. Never say the invoice is due today or late unless dueState says so; if it is not due yet, say it is a gentle heads-up with the due date.',
      'Never threaten, never guilt-trip, no ALL CAPS. Plain text. Sign off with the freelancer\'s first name.',
    ].join('\n'),
    JSON.stringify({
      client: project.client.name,
      project: project.title,
      milestone: milestone.name,
      amount: `${milestone.amount.toFixed(2)} ${project.currency}`,
      invoiceNumber: milestone.invoiceNumber,
      today,
      dueDate: dueLabel,
      dueState,
      tone,
      daysOverdue,
      previousReminders: previous,
    }),
  )
  return { ...draft, tone }
}

/** friendly up to 3 days late, clear from 4 days or after 1 reminder, firm from 15 days or after 2. */
export function reminderTone(daysOverdue: number, previousReminders: number): ReminderTone {
  if (daysOverdue >= 15 || previousReminders >= 2) return 'firm'
  if (daysOverdue >= 4 || previousReminders >= 1) return 'clear'
  return 'friendly'
}
