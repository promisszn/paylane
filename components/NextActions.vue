<script setup lang="ts">
import type { NextAction } from '~/types'

const { data, busy, agentProgress, reviewInvoice, reviewReminder, decideRequest, openConversation } = useDashboard()

const actions = computed(() => data.value?.actions ?? [])

const verb: Record<Exclude<NextAction['kind'], 'client_request'>, string> = {
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
  if (a.kind === 'invoice_next') return reviewInvoice(a.projectId, a.milestoneId, true)
}

const isBusy = (a: NextAction) =>
  a.requestId ? busy.value === `request:${a.requestId}` : (busy.value?.endsWith(a.milestoneId) ?? false)
const keyOf = (a: NextAction) => a.kind + (a.requestId ?? a.milestoneId)
</script>

<template>
  <section class="next" aria-labelledby="next-heading">
    <header class="next__head">
      <h2 id="next-heading" class="next__title">Agent suggests</h2>
      <Transition name="live">
        <p v-if="agentProgress" class="next__live" role="status">
          <span class="next__pulse" aria-hidden="true" />
          On {{ agentProgress.client }}'s page: {{ agentProgress.text }}
        </p>
      </Transition>
    </header>
    <p v-if="!actions.length" class="next__empty">
      Nothing waiting on you. The agent flags drafts to send, overdue invoices, milestones ready to bill and anything a client asks for that your mandate doesn't cover.
    </p>
    <TransitionGroup v-else tag="ul" name="next" class="next__list">
      <li v-for="a in actions" :key="keyOf(a)" class="next__item" :data-kind="a.kind">
        <div class="next__body">
          <p class="next__item-title">
            <span v-if="a.kind === 'client_request'" class="next__tone next__tone--client">Client asks</span>
            {{ a.title }}
            <span v-if="a.tone" class="next__tone" :data-tone="a.tone">{{ toneLabel[a.tone] }}</span>
          </p>
          <blockquote v-if="a.quote" class="next__quote">{{ a.quote }}</blockquote>
          <p class="next__item-detail">
            {{ a.detail }}
            <button v-if="a.kind === 'client_request'" type="button" class="next__link" @click="openConversation(a.projectId, a.requestId)">
              Read the conversation
            </button>
          </p>
        </div>

        <div v-if="a.kind === 'client_request' && a.requestKind !== 'other'" class="next__buttons">
          <button class="btn btn--small" :disabled="isBusy(a)" @click="decideRequest(a.requestId!, 'approve')">
            {{ isBusy(a) ? 'Updating PayPal…' : 'Approve' }}
          </button>
          <button class="btn btn--quiet btn--small" :disabled="isBusy(a)" @click="decideRequest(a.requestId!, 'decline')">Decline</button>
        </div>
        <div v-else-if="a.kind === 'client_request'" class="next__buttons">
          <button class="btn btn--small" @click="openConversation(a.projectId, a.requestId)">Reply</button>
          <button class="btn btn--quiet btn--small" :disabled="isBusy(a)" @click="decideRequest(a.requestId!, 'handled')">Mark handled</button>
        </div>
        <button v-else class="btn btn--small" :class="{ 'btn--quiet': a.kind === 'invoice_next' }" :disabled="isBusy(a)" @click="act(a)">
          {{ isBusy(a) ? 'Agent is writing…' : verb[a.kind] }}
        </button>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.next__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem 1rem;
}
.next__title {
  font-size: var(--t-lg);
}
.next__live {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: var(--t-xs);
  color: var(--carbon);
  font-weight: 500;
}
.next__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--carbon);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.25;
  }
}
.live-enter-active {
  transition: opacity var(--dur-enter) var(--ease-out);
}
.live-leave-active {
  transition: opacity var(--dur-exit) ease-in;
}
.live-enter-from,
.live-leave-to {
  opacity: 0;
}
.next__empty {
  margin-top: 0.5rem;
  color: var(--ink-soft);
  max-width: 52ch;
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
.next__item[data-kind='client_request'] {
  border-left-color: var(--draft);
  background: var(--paper-pure);
}
.next__body {
  min-width: 0;
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
.next__tone--client {
  background: var(--draft-soft);
  color: var(--draft);
}
.next__quote {
  margin: 0.4rem 0 0;
  padding-left: 0.65rem;
  border-left: 2px solid var(--rule);
  color: var(--ink-soft);
  font-size: var(--t-xs);
  font-style: italic;
  overflow-wrap: anywhere;
}
.next__item-detail {
  color: var(--ink-soft);
  font-size: var(--t-xs);
  margin-top: 0.25rem;
}
.next__link {
  border: 0;
  background: none;
  padding: 0;
  margin-left: 0.25rem;
  font: inherit;
  color: var(--carbon);
  text-decoration: underline;
  cursor: pointer;
}
.next__buttons {
  display: flex;
  flex-shrink: 0;
  gap: 0.4rem;
}
.next__item > .btn {
  flex-shrink: 0;
}
@media (max-width: 640px) {
  .next__item {
    flex-direction: column;
    align-items: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .next__pulse {
    animation: none;
  }
}
</style>
