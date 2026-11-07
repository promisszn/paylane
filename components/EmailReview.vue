<script setup lang="ts">
import type { PendingEmail } from '~/composables/useDashboard'
/**
 * The human checkpoint. The agent wrote this email; you can edit it.
 * PayPal only sends it when you press the button.
 */
const { pendingEmail, sendPending, busy } = useDashboard()
const dialog = ref<HTMLDialogElement | null>(null)
const subject = ref('')
const note = ref('')
// Keep the last email rendered while the dialog animates out.
const shown = ref<PendingEmail | null>(null)

watch(
  pendingEmail,
  (email) => {
    if (email) {
      shown.value = email
      subject.value = email.subject
      note.value = email.note
      nextTick(() => dialog.value?.showModal())
    } else {
      dialog.value?.close()
    }
  },
  { flush: 'post' },
)

const sending = computed(() => busy.value?.startsWith('send:') || busy.value?.startsWith('remind:'))
const cta = computed(() => (shown.value?.mode === 'reminder' ? 'Send reminder' : 'Send invoice'))
</script>

<template>
  <dialog ref="dialog" class="review" aria-labelledby="review-heading" @close="pendingEmail = null">
    <form v-if="shown" method="dialog" class="review__form" @submit.prevent="sendPending(subject, note)">
      <header>
        <p class="review__eyebrow">Drafted by the agent. Edit anything before it goes out.</p>
        <h2 id="review-heading" class="review__title">{{ shown.heading }}</h2>
      </header>

      <p class="review__to"><span>To</span> {{ shown.to }}</p>

      <label class="field">
        <span class="field__label">Subject</span>
        <input v-model="subject" class="input" required />
      </label>
      <label class="field">
        <span class="field__label">Message</span>
        <textarea v-model="note" class="textarea" rows="7" required />
      </label>

      <p class="review__fine">
        {{ shown.mode === 'reminder' ? 'PayPal sends this as a reminder on the existing invoice.' : 'PayPal emails the invoice with a pay button. The client can pay with PayPal or a card.' }}
      </p>

      <footer class="review__actions">
        <button type="button" class="btn btn--quiet" @click="pendingEmail = null">Not now</button>
        <button type="submit" class="btn" :disabled="sending">{{ sending ? 'Sending…' : cta }}</button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.review {
  width: min(560px, calc(100vw - 32px));
  border: 0;
  padding: 0;
  border-radius: var(--radius-sheet);
  background: var(--paper-pure);
  color: var(--ink);
  box-shadow: 0 24px 64px -24px rgb(22 35 63 / 0.5);
}
/*
 * Enter: scale up from 0.96 with a strong ease-out. Exit: quicker and simpler.
 * Uses @starting-style + allow-discrete so the native <dialog> animates both ways
 * without a JS animation library.
 */
.review {
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity var(--dur-exit) ease-in,
    transform var(--dur-exit) ease-in,
    overlay var(--dur-exit) allow-discrete,
    display var(--dur-exit) allow-discrete;
}
.review[open] {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out),
    overlay var(--dur-enter) allow-discrete,
    display var(--dur-enter) allow-discrete;
}
@starting-style {
  .review[open] {
    opacity: 0;
    transform: scale(0.96);
  }
}
.review::backdrop {
  background: rgb(22 35 63 / 0);
  transition:
    background-color var(--dur-enter) var(--ease-out),
    overlay var(--dur-enter) allow-discrete,
    display var(--dur-enter) allow-discrete;
}
.review[open]::backdrop {
  background: rgb(22 35 63 / 0.4);
}
@starting-style {
  .review[open]::backdrop {
    background: rgb(22 35 63 / 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .review,
  .review[open] {
    transform: none;
  }
}
.review__form {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border-top: 4px solid var(--carbon);
}
.review__eyebrow {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.review__title {
  margin-top: 0.25rem;
  font-size: var(--t-lg);
}
.review__to {
  padding: 0.6rem 0.75rem;
  background: var(--paper);
  border-radius: var(--radius-control);
  font-size: var(--t-xs);
}
.review__to span {
  color: var(--ink-faint);
  margin-right: 0.4rem;
}
.review__fine {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.review__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
