<script setup lang="ts">
const { planJob, busy } = useDashboard()
const message = ref('')

const examples = [
  {
    label: 'Landing page, half upfront',
    text: "Hi! It's Funke from Crust & Crumb Bakery (funke@crustandcrumb.example). We'd love a new landing page for our weekend orders. Your quote of $800 works for us. Happy to pay half now and the rest when it's live. Can we aim for the end of the month?",
  },
  {
    label: 'Retainer with three phases',
    text: 'Daniel here from Northwind Analytics, daniel.k@northwind.example. Approved: dashboard redesign, $2,400 total. Phase 1 discovery and wireframes, phase 2 UI build, phase 3 handover and docs. Pay per phase please, net 14.',
  },
  {
    label: 'Small fix, no details',
    text: 'hey can you fix the broken contact form on our site? $150 is fine. thanks, Ope',
  },
]

async function submit() {
  if (message.value.trim().length < 10) return
  await planJob(message.value)
}
</script>

<template>
  <section class="intake" aria-labelledby="intake-heading">
    <h2 id="intake-heading" class="intake__title">New job</h2>
    <p class="intake__hint">Paste what the client sent you. The agent works out the payment plan, you approve it.</p>

    <form class="intake__form" @submit.prevent="submit">
      <label class="visually-hidden" for="client-message">Client message</label>
      <textarea
        id="client-message"
        v-model="message"
        class="textarea intake__textarea"
        rows="7"
        placeholder="e.g. Approved! $1,200 for the app screens, 50% to start…"
        @keydown.meta.enter="submit"
        @keydown.ctrl.enter="submit"
      />
      <div class="intake__row">
        <button class="btn" type="submit" :disabled="busy === 'plan' || message.trim().length < 10">
          {{ busy === 'plan' ? 'Reading the message…' : 'Plan payments' }}
        </button>
        <span class="intake__kbd">or ⌘ Enter</span>
      </div>
    </form>

    <div class="intake__examples">
      <p class="intake__examples-label">Try an example</p>
      <ul>
        <li v-for="ex in examples" :key="ex.label">
          <button type="button" class="intake__example" @click="message = ex.text">{{ ex.label }}</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.intake {
  background: var(--paper);
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-sheet);
  padding: 1.5rem;
}
.intake__title {
  font-size: var(--t-lg);
}
.intake__hint {
  margin-top: 0.35rem;
  color: var(--ink-soft);
  max-width: 46ch;
}
.intake__form {
  margin-top: 1.1rem;
  display: grid;
  gap: 0.8rem;
}
.intake__textarea {
  min-height: 9rem;
  /* Ruled paper: one rule per text line, scrolling with the content. */
  background-image: linear-gradient(transparent calc(1.5em - 1px), var(--rule-soft) 0);
  background-size: 100% 1.5em;
  background-position: 0 0.55rem;
  background-attachment: local;
}
.intake__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.intake__kbd {
  color: var(--ink-faint);
  font-size: var(--t-xs);
}
@media (hover: none) {
  .intake__kbd {
    display: none;
  }
}
.intake__examples {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--rule);
}
.intake__examples-label {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.intake__examples ul {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.intake__example {
  border: 1px solid var(--rule);
  background: transparent;
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  font: var(--t-xs) var(--font-ui);
  color: var(--ink-soft);
  cursor: pointer;
}
.intake__example {
  transition:
    transform var(--dur-press) var(--ease-out),
    border-color var(--dur-press) var(--ease-out),
    color var(--dur-press) var(--ease-out);
}
.intake__example:active {
  transform: scale(0.97);
}
@media (hover: hover) and (pointer: fine) {
  .intake__example:hover {
    border-color: var(--carbon);
    color: var(--carbon);
  }
}
</style>
