<script setup lang="ts">
import type { Actor } from '~/types'

/** Audit trail: who did what. Makes it obvious the agent prepares and you decide. */
const { data } = useDashboard()

const who: Record<Actor, string> = { agent: 'Agent', you: 'You', paypal: 'PayPal' }

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <section class="log" aria-labelledby="log-heading">
    <h2 id="log-heading" class="log__title">Activity</h2>
    <p v-if="!data?.activity.length" class="log__empty">Every draft, approval and payment is recorded here.</p>
    <ol v-else class="log__list">
      <li v-for="e in data.activity" :key="e.id" class="log__item" :data-actor="e.actor">
        <span class="log__who">{{ who[e.actor] }}</span>
        <span class="log__text">{{ e.text }}</span>
        <time class="log__when" :datetime="e.at">{{ when(e.at) }}</time>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.log__title {
  font-size: var(--t-lg);
}
.log__empty {
  margin-top: 0.5rem;
  color: var(--ink-soft);
}
.log__list {
  list-style: none;
  margin: 0.9rem 0 0;
  padding: 0;
  max-height: 22rem;
  overflow-y: auto;
}
.log__item {
  display: grid;
  grid-template-columns: 4rem 1fr auto;
  gap: 0.75rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--rule-soft);
  font-size: var(--t-xs);
}
.log__who {
  font-weight: 600;
}
.log__item[data-actor='agent'] .log__who {
  color: var(--carbon);
}
.log__item[data-actor='paypal'] .log__who {
  color: var(--paid);
}
.log__text {
  color: var(--ink-soft);
}
.log__when {
  color: var(--ink-faint);
  white-space: nowrap;
}
</style>
