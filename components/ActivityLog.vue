<script setup lang="ts">
import type { Actor } from '~/types'

/** Audit trail: who did what. Marks what the agent did on its own and which mandate clause allowed it. */
const { data, mandateOpen, openConversation } = useDashboard()

const who: Record<Actor, string> = { agent: 'Agent', you: 'You', paypal: 'PayPal', client: 'Client' }

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <section class="log" aria-labelledby="log-heading">
    <h2 id="log-heading" class="log__title">Activity</h2>
    <p v-if="!data?.activity.length" class="log__empty">Every draft, approval, payment and agent decision is recorded here.</p>
    <ol v-else class="log__list">
      <li v-for="e in data.activity" :key="e.id" class="log__item" :data-actor="e.actor">
        <span class="log__who">{{ who[e.actor] }}</span>
        <span class="log__text">
          <button v-if="e.clause" type="button" class="log__clause" :title="`Allowed by clause ${e.clause} of your mandate. Open the mandate.`" @click="mandateOpen = true">
            On its own, clause {{ e.clause }}
          </button>
          {{ e.text }}
          <button v-if="e.actor === 'client' && e.projectId" type="button" class="log__open" @click="openConversation(e.projectId)">Read</button>
        </span>
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
  font-weight: 500;
  color: var(--ink);
}
.log__text {
  color: var(--ink-soft);
}
.log__clause {
  display: inline-block;
  border: 0;
  font-family: inherit;
  cursor: pointer;
  transition: background-color var(--dur-press) var(--ease-out);
  margin-right: 0.3rem;
  padding: 0 0.45rem;
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 0.7rem;
  line-height: 1.5;
  white-space: nowrap;
}
@media (hover: hover) and (pointer: fine) {
  .log__clause:hover {
    background: var(--rule-soft);
    color: var(--ink);
  }
}
.log__open {
  border: 0;
  background: none;
  padding: 0;
  margin-left: 0.2rem;
  font: inherit;
  color: var(--carbon);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .log__open:hover {
    text-decoration: underline;
  }
}
.log__when {
  color: var(--ink-faint);
  white-space: nowrap;
}
@media (max-width: 520px) {
  .log__item {
    grid-template-columns: 3.6rem 1fr;
    gap: 0.25rem 0.6rem;
  }
  .log__when {
    grid-column: 2;
    font-size: 0.72rem;
  }
}
</style>
