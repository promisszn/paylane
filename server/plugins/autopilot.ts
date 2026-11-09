/**
 * Wakes the agent every five minutes to send the reminders your mandate covers.
 * A hosted free instance sleeps when idle; it catches up on the first request after waking,
 * since the rules only look at dates, not at how long it slept.
 */
export default defineNitroPlugin(() => {
  const timer = setInterval(kickAutopilot, 5 * 60_000)
  timer.unref?.()
  // One pass shortly after start, so a restart doesn't delay overdue reminders by five minutes.
  setTimeout(kickAutopilot, 15_000).unref?.()
})
