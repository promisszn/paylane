<script setup lang="ts">
const { status, plan, busy, refresh, loadStatus, syncPayPal } = useDashboard()

await Promise.all([refresh(), loadStatus()])

// Pick up payments while the tab is open (webhooks cover this when deployed).
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true" />
        <span class="brand__name">Paylane</span>
        <span v-if="status" class="brand__env">{{ status.freelancer.business }}<template v-if="status.paypalEnv === 'sandbox'">, PayPal sandbox</template></span>
      </div>
      <button class="btn btn--quiet btn--small" :disabled="busy === 'sync'" @click="syncPayPal">
        {{ busy === 'sync' ? 'Checking PayPal…' : 'Check for payments' }}
      </button>
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

      <section class="ledger" aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" class="ledger__title">Receivables</h2>
        <ClientOnly>
          <ReceivablesGrid />
          <template #fallback><p class="ledger__loading">Loading the ledger…</p></template>
        </ClientOnly>
      </section>

      <ActivityLog class="main__log" />
    </main>

    <EmailReview />

    <ToastStack />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem clamp(1rem, 4vw, 2.5rem);
  border-bottom: 1px solid var(--rule);
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
  background: var(--carbon);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 83% 88%, 66% 100%, 50% 88%, 33% 100%, 17% 88%, 0 100%);
}
.brand__name {
  font-weight: 700;
  font-size: var(--t-md);
  letter-spacing: -0.02em;
}
.brand__env {
  color: var(--ink-faint);
  font-size: var(--t-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.ledger__title {
  font-size: var(--t-lg);
  margin-bottom: 0.9rem;
}
.ledger__loading {
  color: var(--ink-faint);
}
@media (max-width: 900px) {
  .desk {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .brand__env {
    display: none;
  }
}
</style>
