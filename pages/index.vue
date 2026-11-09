<script setup lang="ts">
const { status, plan, busy, data, agentProgress, conversation, mandateOpen, refresh, reloadConversation, loadStatus, syncPayPal } = useDashboard()

/** The mandate's state for the top bar. Unsigned is the one that asks for attention. */
const mandateSigned = computed(() => Boolean(data.value?.mandate.signedAt))

await Promise.all([refresh(), loadStatus()])

// Live: payments, client page conversations and the agent's own actions arrive as they happen.
let progressTimer: ReturnType<typeof setTimeout> | undefined
const { connected } = useLive('/api/events', {
  onChange: () => {
    refresh(true)
    if (conversation.value) reloadConversation()
  },
  onProgress: (text, projectId) => {
    const client = data.value?.projects.find((p) => p.id === projectId)?.client.name ?? 'a client'
    agentProgress.value = { text, client, at: Date.now() }
    clearTimeout(progressTimer)
    progressTimer = setTimeout(() => (agentProgress.value = null), 6000)
  },
})

// Fallback if the live connection is blocked (some proxies strip event streams).
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (!connected.value && document.visibilityState === 'visible') refresh(true)
  }, 30_000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(progressTimer)
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true" />
        <span class="brand__name">Paylane</span>
        <span v-if="status" class="brand__env">{{ status.freelancer.business }}<template v-if="status.paypalEnv === 'sandbox'">, PayPal sandbox</template></span>
      </div>
      <div class="topbar__right">
        <button
          v-if="data"
          type="button"
          class="mandate-chip"
          :data-signed="mandateSigned"
          aria-haspopup="dialog"
          :title="mandateSigned ? 'What the agent may do on its own' : 'The agent asks you before everything until you sign'"
          @click="mandateOpen = true"
        >
          <span class="mandate-chip__dot" aria-hidden="true" />
          <span>Mandate<span class="mandate-chip__state">{{ mandateSigned ? ': in force' : ': not signed' }}</span></span>
        </button>
        <span class="live" :data-on="connected" :title="connected ? 'Updates arrive as they happen' : 'Reconnecting…'">
          <span class="live__dot" aria-hidden="true" />{{ connected ? 'Live' : 'Offline' }}
        </span>
        <button class="btn btn--quiet btn--small" :disabled="busy === 'sync'" :data-loading="busy === 'sync'" :aria-busy="busy === 'sync'" @click="syncPayPal">
          Check for payments
        </button>
      </div>
    </header>

    <main class="main">
      <SetupNotice />
      <StatusLine class="main__status" />

      <div class="desk">
        <div class="desk__left">
          <PlanReceipt v-if="plan" />
          <JobIntake v-else />
        </div>
        <div class="desk__right">
          <NextActions />
        </div>
      </div>

      <ClientOnly>
        <CashFlowChart />
      </ClientOnly>

      <section class="ledger" aria-labelledby="ledger-heading">
        <ClientOnly>
          <ReceivablesGrid />
          <template #fallback>
            <h2 id="ledger-heading" class="ledger__title">Receivables</h2>
            <p class="ledger__loading">Loading the ledger…</p>
          </template>
        </ClientOnly>
      </section>

      <div class="records">
        <ActivityLog />
        <ClientConversations />
      </div>
    </main>

    <EmailReview />
    <ConversationDialog />
    <ChangePayment />
    <MandatePanel />

    <ToastStack />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem clamp(1rem, 4vw, 2.5rem);
  /* A translucent bar: content scrolls under it instead of behind an opaque strip. */
  background: rgb(245 245 247 / 0.78);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgb(0 0 0 / 0.06);
}
@media (prefers-reduced-transparency: reduce) {
  .topbar {
    background: var(--desk);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
.topbar__right {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.brand__mark {
  width: 1.1rem;
  height: 1.35rem;
  /* The original brand blue, same as the favicon. */
  background: #2747c9;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 83% 88%, 66% 100%, 50% 88%, 33% 100%, 17% 88%, 0 100%);
}
.brand__name {
  font-weight: 600;
  font-size: var(--t-md);
  letter-spacing: -0.015em;
}
.brand__env {
  color: var(--ink-faint);
  font-size: var(--t-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The way into the mandate panel: its state at a glance, the details one click away. */
.mandate-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--paper-pure);
  color: var(--ink);
  font: 500 var(--t-xs) / 1 var(--font-ui);
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform var(--dur-press) var(--ease-out),
    background-color var(--dur-press) var(--ease-out);
}
.mandate-chip:active {
  transform: scale(0.97);
}
@media (hover: hover) and (pointer: fine) {
  .mandate-chip:hover {
    background: var(--paper);
  }
}
.mandate-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--draft);
}
.mandate-chip[data-signed='true'] .mandate-chip__dot {
  background: var(--paid);
}
.mandate-chip__state {
  color: var(--ink-soft);
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.live__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-faint);
  transition: background-color var(--dur-enter) var(--ease-out);
}
.live[data-on='true'] {
  color: var(--paid);
}
.live[data-on='true'] .live__dot {
  background: var(--paid);
}
.main {
  max-width: 1240px;
  margin: 0 auto;
  padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 4vw, 2.5rem) 4rem;
  display: grid;
  gap: 2.5rem;
}
.desk {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  gap: 2rem;
  align-items: start;
}
.desk__right {
  display: grid;
  gap: 1.75rem;
}
.ledger__title {
  font-size: var(--t-lg);
  margin-bottom: 0.9rem;
}
.ledger__loading {
  color: var(--ink-faint);
}
.records {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(0, 4fr);
  gap: 2rem;
  align-items: start;
}
@media (max-width: 900px) {
  .desk,
  .records {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .brand__env,
  .mandate-chip__state {
    display: none;
  }
}
</style>
