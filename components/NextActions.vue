<script setup lang="ts">
import type { NextAction } from '~/types'

const { data, busy, reviewInvoice, reviewReminder } = useDashboard()

const actions = computed(() => data.value?.actions ?? [])

const verb: Record<NextAction['kind'], string> = {
  send_draft: 'Review and send',
  remind: 'Draft reminder',
  invoice_next: 'Mark done and draft invoice',
}

const toneLabel: Record<NonNullable<NextAction['tone']>, string> = {
  friendly: 'Friendly nudge',
  clear: 'Clear follow-up',
  firm: 'Firm notice',
}

function act(a: NextAction) {
  if (a.kind === 'send_draft') return reviewInvoice(a.projectId, a.milestoneId)
  if (a.kind === 'remind') return reviewReminder(a.projectId, a.milestoneId)
  return reviewInvoice(a.projectId, a.milestoneId, true)
}

const isBusy = (a: NextAction) => busy.value?.endsWith(a.milestoneId) ?? false
</script>

<template>
  <section class="next" aria-labelledby="next-heading">
    <h2 id="next-heading" class="next__title">Agent suggests</h2>
    <p v-if="!actions.length" class="next__empty">
      Nothing waiting on you. The agent flags drafts to send, overdue invoices and milestones ready to bill.
    </p>
    <TransitionGroup v-else tag="ul" name="next" class="next__list">
      <li v-for="a in actions" :key="a.kind + a.milestoneId" class="next__item" :data-kind="a.kind">
        <div>
          <p class="next__item-title">
            {{ a.title }}
            <span v-if="a.tone" class="next__tone" :data-tone="a.tone">{{ toneLabel[a.tone] }}</span>
          </p>
          <p class="next__item-detail">{{ a.detail }}</p>
        </div>
        <button class="btn btn--small" :class="{ 'btn--quiet': a.kind === 'invoice_next' }" :disabled="isBusy(a)" @click="act(a)">
          {{ isBusy(a) ? 'Agent is writing…' : verb[a.kind] }}
        </button>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.next__title {
  font-size: var(--t-lg);
}
.next__empty {
  margin-top: 0.5rem;
  color: var(--ink-soft);
  max-width: 48ch;
}
.next__list {
  list-style: none;
  margin: 0.9rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}
/* When you act on a suggestion it leaves; the rest slide up so you see what changed. */
.next-move,
.next-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
}
.next-leave-active {
  position: absolute;
  width: 100%;
  transition:
    opacity var(--dur-exit) ease-in,
    transform var(--dur-exit) ease-in;
}
.next-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.next-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
.next__list {
  position: relative;
}
.next__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  background: var(--paper);
  border-left: 3px solid var(--carbon);
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
}
.next__item[data-kind='remind'] {
  border-left-color: var(--overdue);
}
.next__item[data-kind='invoice_next'] {
  border-left-color: var(--paid);
}
.next__item-title {
  font-weight: 600;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
.next__tone {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--carbon-soft);
  color: var(--carbon);
}
.next__tone[data-tone='clear'] {
  background: var(--draft-soft);
  color: var(--draft);
}
.next__tone[data-tone='firm'] {
  background: var(--overdue-soft);
  color: var(--overdue);
}
.next__item-detail {
  color: var(--ink-soft);
  font-size: var(--t-xs);
  margin-top: 0.1rem;
}
.next__item .btn {
  flex-shrink: 0;
}
@media (max-width: 640px) {
  .next__item {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
