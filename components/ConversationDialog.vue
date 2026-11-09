<script setup lang="ts">
import type { ChatTurn } from '~/types'
import type { OpenConversation } from '~/composables/useDashboard'

/**
 * Everything said on one client page: the client, the agent, and you.
 * Nothing the agent tells a client is hidden from you, and you can step in at any point.
 */
const { conversation, status, busy, sendReply } = useDashboard()
const dialog = ref<HTMLDialogElement | null>(null)
const list = ref<HTMLOListElement | null>(null)
const reply = ref('')
// Keep the last conversation rendered while the dialog animates out.
const shown = ref<OpenConversation | null>(null)

const first = computed(() => status.value?.freelancer.name.split(/\s+/)[0] ?? 'You')
const who = (role: ChatTurn['role']) => (role === 'client' ? shown.value?.client : role === 'agent' ? 'Agent' : `${first.value} (you)`)
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function toBottom() {
  nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight }))
}

watch(
  conversation,
  (c, prev) => {
    if (c) {
      const isNew = c.projectId !== shown.value?.projectId || !prev
      shown.value = c
      if (isNew) reply.value = ''
      nextTick(() => {
        if (!dialog.value?.open) dialog.value?.showModal()
        toBottom()
      })
    } else {
      dialog.value?.close()
    }
  },
  { flush: 'post' },
)

async function send() {
  if (!reply.value.trim()) return
  if (await sendReply(reply.value.trim())) {
    reply.value = ''
    toBottom()
  }
}
</script>

<template>
  <dialog ref="dialog" class="convo" aria-labelledby="convo-heading" @close="conversation = null">
    <div v-if="shown" class="convo__inner">
      <header class="convo__head">
        <div>
          <p class="convo__eyebrow">Client page conversation</p>
          <h2 id="convo-heading" class="convo__title">{{ shown.client }}, {{ shown.project }}</h2>
        </div>
        <a v-if="shown.clientPage" :href="shown.clientPage" target="_blank" rel="noopener" class="btn btn--quiet btn--small">Open their page</a>
      </header>

      <p v-if="!shown.turns.length" class="convo__empty">{{ shown.client }} hasn't written on their page yet.</p>
      <ol v-else ref="list" class="convo__turns">
        <li v-for="t in shown.turns" :key="t.id" class="turn" :data-role="t.role">
          <p class="turn__who">
            {{ who(t.role) }}
            <time :datetime="t.at">{{ when(t.at) }}</time>
          </p>
          <p class="turn__text">{{ t.text }}</p>
          <ul v-if="t.actions?.length" class="turn__receipts">
            <li v-for="(a, i) in t.actions" :key="i" class="receipt-line" :data-kind="a.kind">{{ a.text }}</li>
          </ul>
        </li>
      </ol>

      <form class="convo__reply" @submit.prevent="send">
        <label class="field">
          <span class="field__label">Reply as {{ first }}. It shows on {{ shown.client }}'s page straight away.</span>
          <textarea v-model="reply" class="textarea" rows="3" maxlength="1500" @keydown.meta.enter="send" @keydown.ctrl.enter="send" />
        </label>
        <footer class="convo__actions">
          <button type="button" class="btn btn--quiet" @click="conversation = null">Close</button>
          <button type="submit" class="btn" :disabled="!reply.trim() || busy === 'reply'">{{ busy === 'reply' ? 'Posting…' : 'Post reply' }}</button>
        </footer>
      </form>
    </div>
  </dialog>
</template>

<style scoped>
.convo {
  width: min(640px, calc(100vw - 32px));
  max-height: min(86vh, 860px);
  border: 0;
  padding: 0;
  border-radius: var(--radius-sheet);
  background: var(--paper-pure);
  color: var(--ink);
  box-shadow: 0 24px 64px -24px rgb(22 35 63 / 0.5);
}
/* Same enter and exit as the email review dialog. */
.convo {
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity var(--dur-exit) ease-in,
    transform var(--dur-exit) ease-in,
    overlay var(--dur-exit) allow-discrete,
    display var(--dur-exit) allow-discrete;
}
.convo[open] {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out),
    overlay var(--dur-enter) allow-discrete,
    display var(--dur-enter) allow-discrete;
}
@starting-style {
  .convo[open] {
    opacity: 0;
    transform: scale(0.96);
  }
}
.convo::backdrop {
  background: rgb(22 35 63 / 0);
  transition:
    background-color var(--dur-enter) var(--ease-out),
    overlay var(--dur-enter) allow-discrete,
    display var(--dur-enter) allow-discrete;
}
.convo[open]::backdrop {
  background: rgb(22 35 63 / 0.4);
}
@starting-style {
  .convo[open]::backdrop {
    background: rgb(22 35 63 / 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .convo,
  .convo[open] {
    transform: none;
  }
}
.convo__inner {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border-top: 4px solid var(--draft);
}
.convo__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}
.convo__eyebrow {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.convo__title {
  margin-top: 0.2rem;
  font-size: var(--t-lg);
}
.convo__empty {
  color: var(--ink-soft);
}
.convo__turns {
  list-style: none;
  margin: 0;
  padding: 0 0.25rem 0 0;
  display: grid;
  gap: 0.75rem;
  max-height: 46vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.turn {
  max-width: 88%;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  background: var(--paper);
}
.turn[data-role='client'] {
  justify-self: end;
  background: var(--carbon-soft);
}
.turn[data-role='freelancer'] {
  background: var(--paper-pure);
  border: 1px solid var(--ink-soft);
}
.turn__who {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--ink-soft);
  display: flex;
  gap: 0.5rem;
}
.turn__who time {
  font-weight: 400;
  color: var(--ink-faint);
}
.turn__text {
  margin-top: 0.15rem;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.turn__receipts {
  list-style: none;
  margin: 0.45rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
.convo__reply {
  display: grid;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--rule);
}
.convo__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
