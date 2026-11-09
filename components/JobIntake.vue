<script setup lang="ts">
import type { IntakeAttachment } from '~/types'

const { planJob, busy, notify } = useDashboard()
const message = ref('')
const attachment = ref<IntakeAttachment | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

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

const canSubmit = computed(() => busy.value !== 'plan' && (message.value.trim().length >= 10 || Boolean(attachment.value)))

function readFile(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(file.type)) {
    notify('Use a PNG, JPEG, WebP screenshot or PDF scope.', 'error')
    return
  }
  if (file.size > 6 * 1024 * 1024) {
    notify('File is too large (max 6 MB).', 'error')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const result = String(reader.result ?? '')
    const base64 = result.includes(',') ? result.split(',')[1]! : result
    attachment.value = { name: file.name, mediaType: file.type, data: base64 }
  }
  reader.readAsDataURL(file)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  input.value = ''
}

function onPaste(e: ClipboardEvent) {
  const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
  const file = item?.getAsFile()
  if (file) readFile(file)
}

async function submit() {
  if (!canSubmit.value) return
  await planJob(message.value, attachment.value ?? undefined)
}
</script>

<template>
  <section class="intake" aria-labelledby="intake-heading">
    <h2 id="intake-heading" class="intake__title">New job</h2>
    <p class="intake__hint">Paste what the client sent you (or attach a screenshot / PDF). The agent works out the payment plan, you approve it.</p>

    <form class="intake__form" @submit.prevent="submit">
      <label class="visually-hidden" for="client-message">Client message</label>
      <textarea
        id="client-message"
        v-model="message"
        class="textarea intake__textarea"
        rows="7"
        placeholder="e.g. Approved! $1,200 for the app screens, 50% to start… (you can also paste a screenshot)"
        @paste="onPaste"
        @keydown.meta.enter="submit"
        @keydown.ctrl.enter="submit"
      />

      <div v-if="attachment" class="intake__attachment">
        <span class="intake__attachment-name">{{ attachment.name }}</span>
        <button type="button" class="intake__attachment-remove" @click="attachment = null">Remove</button>
      </div>

      <div class="intake__row">
        <button class="btn" type="submit" :disabled="!canSubmit" :data-loading="busy === 'plan'" :aria-busy="busy === 'plan'">
          Plan payments
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          class="visually-hidden"
          @change="onFileChange"
        />
        <button type="button" class="btn btn--quiet btn--small" @click="fileInput?.click()">
          {{ attachment ? 'Change file' : 'Attach screenshot / PDF' }}
        </button>
        <span class="intake__kbd">or ⌘ Enter</span>
      </div>
    </form>

    <div class="intake__examples">
      <p class="intake__examples-label">Try an example</p>
      <ul>
        <li v-for="ex in examples" :key="ex.label">
          <button type="button" class="intake__example" @click="message = ex.text; attachment = null">{{ ex.label }}</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.intake {
  background: var(--paper-pure);
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
}
.intake__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.intake__attachment {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0.75rem;
  background: var(--carbon-soft);
  color: var(--carbon);
  border-radius: var(--radius-control);
  font-size: var(--t-xs);
  font-weight: 500;
}
.intake__attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.intake__attachment-remove {
  border: 0;
  background: none;
  color: var(--ink-soft);
  font: var(--t-xs) var(--font-ui);
  text-decoration: underline;
  cursor: pointer;
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
  border-top: 1px solid var(--rule-soft);
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
  border: 0;
  background: var(--paper);
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  font: var(--t-xs) var(--font-ui);
  color: var(--ink-soft);
  cursor: pointer;
}
.intake__example {
  transition:
    transform var(--dur-press) var(--ease-out),
    background-color var(--dur-press) var(--ease-out),
    color var(--dur-press) var(--ease-out);
}
.intake__example:active {
  transform: scale(0.97);
}
@media (hover: hover) and (pointer: fine) {
  .intake__example:hover {
    background: var(--rule-soft);
    color: var(--ink);
  }
}
</style>
