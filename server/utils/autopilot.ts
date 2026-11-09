/**
 * The agent working on its own. Every few minutes, and right after anything that can make a
 * payment late (demo backdating, a sync, signing the mandate), it looks for reminders that are
 * due and sends the ones your mandate covers (clause 1). Everything else stays in
 * "Agent suggests" for you.
 *
 * It uses the same rules as the suggestions: late, quiet for 3 days since the last nudge,
 * and no payment promise pending. So it never nudges the same invoice twice in a row.
 */
let running: Promise<number> | null = null

/** Runs one pass. Calls made while a pass is running share it instead of starting another. */
export function runAutopilot(): Promise<number> {
  running ??= pass().finally(() => {
    running = null
  })
  return running
}

async function pass() {
  const mandate = await getMandate()
  if (!mandate.signedAt || mandate.reminders === 'off' || !paypalConfigured() || !aiInfo().ready) return 0

  let sent = 0
  for (const project of await listProjects()) {
    for (const m of project.milestones) {
      if (!reminderDue(m) || m.autoRemindError) continue
      const late = daysOverdue(m)
      const tone = reminderTone(late, m.reminders.length)
      const verdict = mayRemind(mandate, project, m, tone)
      if (!verdict.ok) continue

      try {
        const draft = await draftReminder(project, m, late)
        const note = withClientPageLink(draft.note, project)
        await remindInvoice(m.invoiceId!, draft.subject, note)
        await mutateProject(project.id, (p) => {
          const mm = findMilestone(p, m.id)
          mm.reminders.push({ sentAt: new Date().toISOString(), subject: draft.subject, note, tone, by: 'agent' })
          delete mm.autoRemindError
        })
        await logActivity(
          'agent',
          `Sent ${project.client.name} a ${tone} reminder for ${m.invoiceNumber} (${fmt(m.amount, project.currency)}, ${late} day${late === 1 ? '' : 's'} overdue).`,
          project.id,
          verdict.clause,
        )
        sent++
      } catch (err: any) {
        const why = err?.statusMessage ?? err?.message ?? 'unknown error'
        await mutateProject(project.id, (p) => {
          findMilestone(p, m.id).autoRemindError = why
        })
        await logActivity('agent', `Couldn't send the reminder for ${m.invoiceNumber} on its own (${why}). It's waiting in your suggestions.`, project.id)
      }
    }
  }
  return sent
}

/** Fire and forget: the open pages update over the live connection when it's done. */
export function kickAutopilot() {
  void runAutopilot().catch((err) => console.error('[paylane] autopilot failed', err))
}
