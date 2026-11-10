<script setup lang="ts">
import type { NextAction } from '~/types'

const { data, busy, agentProgress, mandateOpen, reviewInvoice, reviewReminder, decideRequest, openConversation } = useDashboard()

const actions = computed(() => data.value?.actions ?? [])
/** Until a mandate is signed, signing one is the first thing to do. */
const askToSign = computed(() => Boolean(data.value) && !data.value!.mandate.signedAt)

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

/** Busy with this suggestion's own action. Backdating the same invoice in the ledger doesn't count. */
const isBusy = (a: NextAction) =>
  a.requestId
    ? busy.value === `request:${a.requestId}`
    : Boolean(busy.value?.endsWith(a.milestoneId) && !busy.value.startsWith('demo:'))
/** Approve and Decline share one busy key, so remember which of the two you pressed. */
const pressed = ref<'approve' | 'decline' | 'handled' | null>(null)
function decide(a: NextAction, decision: 'approve' | 'decline' | 'handled') {
  pressed.value = decision
  decideRequest(a.requestId!, decision)
}
const loading = (a: NextAction, decision: 'approve' | 'decline' | 'handled') => isBusy(a) && pressed.value === decision
/** A finished suggestion folds away from its own height, so what's below slides up instead of jumping. */
function holdHeight(el: Element) {
  const e = el as HTMLElement
  e.style.height = `${e.offsetHeight}px`
}
const keyOf = (a: NextAction) => a.kind + (a.requestId ?? a.milestoneId)
</script>

<template>
  <section class="next" aria-labelledby="next-heading">
    <header class="next__head">
      <h2 id="next-heading" class="next__title">Agent suggests</h2>
      <Transition name="live">
        <p v-if="agentProgress" class="next__live" role="status">
          <span class="next__pulse" aria-hidden="true" />
          <span class="next__live-text" :title="`On ${agentProgress.client}'s page: ${agentProgress.text}`">On {{ agentProgress.client }}'s page: {{ agentProgress.text }}</span>
        </p>
      </Transition>
    </header>
    <p v-if="!actions.length && !askToSign" class="next__empty">
      Nothing waiting on you. The agent flags drafts to send, overdue invoices, milestones ready to bill and anything a client asks for that your mandate doesn't cover.
    </p>
    <TransitionGroup v-else tag="ul" name="next" class="next__list" @before-leave="holdHeight">
      <li v-if="askToSign" key="mandate" class="next__item" data-kind="mandate">
        <div class="next__body">
          <p class="next__item-title">Sign a mandate so the agent can act on its own</p>
          <p class="next__item-detail">Until you do, it asks you before every reminder, extra day and split.</p>
        </div>
        <button type="button" class="btn btn--small" aria-haspopup="dialog" @click="mandateOpen = true">Set up mandate</button>
      </li>
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
          <button class="btn btn--small" :disabled="isBusy(a)" :data-loading="loading(a, 'approve')" :aria-busy="loading(a, 'approve')" @click="decide(a, 'approve')">
            Approve
          </button>
          <button class="btn btn--quiet btn--small" :disabled="isBusy(a)" :data-loading="loading(a, 'decline')" :aria-busy="loading(a, 'decline')" @click="decide(a, 'decline')">Decline</button>
        </div>
        <div v-else-if="a.kind === 'client_request'" class="next__buttons">
          <button class="btn btn--small" @click="openConversation(a.projectId, a.requestId)">Reply</button>
          <button class="btn btn--quiet btn--small" :disabled="isBusy(a)" :data-loading="loading(a, 'handled')" :aria-busy="loading(a, 'handled')" @click="decide(a, 'handled')">Mark handled</button>
        </div>
        <button v-else class="btn btn--small" :class="{ 'btn--quiet': a.kind === 'invoice_next' }" :disabled="isBusy(a)" :data-loading="isBusy(a)" :aria-busy="isBusy(a)" @click="act(a)">
          {{ verb[a.kind] }}
        </button>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
/* The live line sits beside the title on one line, so it never pushes the list down. */
.next__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  min-width: 0;
}
.next__title {
  flex-shrink: 0;
}
.next__title {
  font-size: var(--t-lg);
}
.next__live {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  font-size: var(--t-xs);
  color: var(--carbon);
  font-weight: 500;
}
.next__live-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.next__pulse {
  flex-shrink: 0;
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
  transition: opacity var(--dur-exit) var(--ease-out);
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
  margin: 0.9rem 0 -0.6rem;
  padding: 0;
  display: flex;
  flex-direction: column;
}
/* Spacing as a margin (not a gap) so it folds away with a leaving item. */
.next__list > .next__item {
  margin-bottom: 0.6rem;
}
/* When you act on a suggestion it leaves; the rest slide up so you see what changed. */
.next-move,
.next-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
}
.next-leave-active {
  overflow: hidden;
  transition:
    opacity var(--dur-exit) var(--ease-out),
    height var(--dur-enter) var(--ease-out),
    padding var(--dur-enter) var(--ease-out),
    margin var(--dur-enter) var(--ease-out);
}
.next-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.next-leave-to {
  opacity: 0;
  height: 0 !important;
  padding-top: 0;
  padding-bottom: 0;
  margin-bottom: 0 !important;
}
.next__list {
  position: relative;
}
.next__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 1rem;
  background: var(--paper-pure);
  border-radius: 12px;
  box-shadow: var(--shadow-sheet);
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
  font-weight: 500;
  padding: 0.1rem 0.5rem;
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
  margin: 0.45rem 0 0;
  padding: 0.45rem 0.65rem;
  background: var(--paper);
  border-radius: var(--radius-control);
  color: var(--ink-soft);
  font-size: var(--t-xs);
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
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .next__link:hover {
    text-decoration: underline;
  }
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
