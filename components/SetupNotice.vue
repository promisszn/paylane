<script setup lang="ts">
/** Shown until both keys are present, so a fresh clone explains itself instead of erroring. */
const { status } = useDashboard()
</script>

<template>
  <aside v-if="status && (!status.paypalReady || !status.aiReady)" class="setup" role="status">
    <h2 class="setup__title">Finish setup to start billing</h2>
    <ul class="setup__list">
      <li :data-done="status.paypalReady">
        PayPal sandbox keys<span v-if="!status.paypalReady">: add <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code> to <code>.env</code></span>
      </li>
      <li :data-done="status.aiReady">
        AI key ({{ status.aiProvider }})<span v-if="!status.aiReady">: add <code>{{ ({ openai: 'OPENAI_API_KEY', google: 'GOOGLE_GENERATIVE_AI_API_KEY' } as Record<string, string>)[status.aiProvider] ?? 'ANTHROPIC_API_KEY' }}</code> to <code>.env</code></span>
      </li>
    </ul>
    <p class="setup__fine">Then restart <code>npm run dev</code>. The README has the full walkthrough.</p>
  </aside>
</template>

<style scoped>
.setup {
  background: var(--draft-soft);
  color: var(--draft);
  border-radius: var(--radius-sheet);
  padding: 1rem 1.25rem;
}
.setup__title {
  font-size: var(--t-md);
}
.setup__list {
  margin: 0.5rem 0 0;
  padding-left: 1.2rem;
}
.setup__list li[data-done='true'] {
  color: var(--paid);
  text-decoration: line-through;
}
.setup__fine {
  margin-top: 0.4rem;
  font-size: var(--t-xs);
}
code {
  font-family: var(--font-money);
  font-size: 0.85em;
}
</style>
