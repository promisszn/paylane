<script setup lang="ts">
import type { Milestone, Project } from '~/types'

/**
 * Change one payment yourself: what it charges, a later due date, or a split into installments.
 * The agent does the same when you agree to a change in a reply on the client page; this is
 * the way to do it by hand, or to fix something it didn't pick up.
 */
const { changing, data, busy, changePayment } = useDashboard()
const dialog = ref<HTMLDialogElement | null>(null)

type Kind = 'amount' | 'due_date' | 'split'
const kind = ref<Kind>('amount')
const amount = ref<number | null>(null)
const note = ref('')
const dueDate = ref('')
const parts = ref(2)
const tell = ref(true)

// Keep the last payment rendered while the dialog animates out.
const shown = ref<{ project: Project; milestone: Milestone } | null>(null)

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })

watch(
  changing,
  (c) => {
    const project = c && data.value?.projects.find((p) => p.id === c.projectId)
    const milestone = project?.milestones.find((m) => m.id === c?.milestoneId)
    if (project && milestone) {
      shown.value = { project, milestone }
      kind.value = 'amount'
      amount.value = milestone.amount
      note.value = ''
      dueDate.value = ''
      parts.value = 2
      tell.value = true
      nextTick(() => dialog.value?.showModal())
    } else {
      dialog.value?.close()
    }
  },
  { flush: 'post' },
)

const m = computed(() => shown.value?.milestone)
const client = computed(() => shown.value?.project.client.name ?? 'the client')
const money = (n: number) => formatMoney(n, shown.value?.project.currency ?? 'USD')
const isSent = computed(() => m.value?.status === 'sent')
const canSplit = computed(() => isSent.value && !m.value?.installment && (m.value?.amount ?? 0) >= 2)

/** Earliest new due date: the day after the later of today and the current due date. */
const minDue = computed(() => {
  const today = Date.parse(`${iso(Date.now())}T00:00:00Z`)
  const due = m.value?.dueDate ? Date.parse(`${m.value.dueDate}T00:00:00Z`) : today
  return iso(Math.max(today, due) + DAY)
})

const difference = computed(() => {
  if (!m.value || amount.value == null || !Number.isFinite(amount.value)) return ''
  const d = Math.round((amount.value - m.value.amount) * 100) / 100
  if (!d) return ''
  return d < 0 ? `${money(-d)} less` : `${money(d)} more`
})

/** Even parts in cents, any odd cent on the last, as the server does it. */
const splitPreview = computed(() => {
  if (!m.value) return ''
  const cents = Math.round(m.value.amount * 100)
  const base = Math.floor(cents / parts.value)
  const last = cents - base * (parts.value - 1)
  return base === last ? `${parts.value} × ${money(base / 100)}` : `${parts.value - 1} × ${money(base / 100)} and 1 × ${money(last / 100)}`
})

const ready = computed(() => {
  if (!m.value) return false
  if (kind.value === 'amount') return amount.value != null && amount.value >= 1 && Math.round(amount.value * 100) !== Math.round(m.value.amount * 100)
  if (kind.value === 'due_date') return Boolean(dueDate.value) && dueDate.value >= minDue.value
  return canSplit.value
})

const fine = computed(() => {
  if (kind.value === 'due_date') return `PayPal emails ${client.value} the invoice with the new due date. The pay link stays the same.`
  if (kind.value === 'split') return `PayPal sends ${client.value} one invoice per payment, two weeks apart, and cancels invoice ${m.value?.invoiceNumber}. The total stays the same.`
  if (m.value?.status === 'sent') return `PayPal emails ${client.value} the updated invoice. The pay link stays the same.`
  if (m.value?.status === 'draft') return 'The draft on PayPal is updated, and the agent rewrites the email before you send it.'
  return 'Nothing is billed yet. The new amount is used when you invoice it, and the job total changes with it.'
})

async function submit() {
  if (!ready.value) return
  const change =
    kind.value === 'amount'
      ? { kind: 'amount' as const, amount: amount.value!, note: note.value.trim() || undefined }
      : kind.value === 'due_date'
        ? { kind: 'due_date' as const, dueDate: dueDate.value }
        : { kind: 'split' as const, parts: parts.value }
  await changePayment(change, tell.value)
}
</script>

<template>
  <dialog ref="dialog" class="change" aria-labelledby="change-heading" @close="changing = null">
    <form v-if="shown && m" class="change__form" @submit.prevent="submit">
      <header>
        <p class="change__eyebrow">{{ shown.project.client.name }}, {{ shown.project.title }}</p>
        <h2 id="change-heading" class="change__title">
          Change {{ m.name }}<template v-if="m.invoiceNumber">, invoice {{ m.invoiceNumber }}</template>
        </h2>
        <p class="change__now">
          <span class="money">{{ money(m.amount) }}</span>
          <template v-if="m.adjusted"> (was <span class="money">{{ money(m.adjusted.from) }}</span>)</template>
          <template v-if="isSent && m.dueDate">, due {{ longDate(m.dueDate) }}</template>
          <template v-else-if="m.status === 'planned'">, not billed yet</template>
          <template v-else-if="m.status === 'draft'">, drafted</template>
        </p>
      </header>

      <fieldset v-if="isSent" class="change__kinds">
        <legend class="visually-hidden">What to change</legend>
        <label class="change__kind"><input v-model="kind" type="radio" value="amount" /> Amount</label>
        <label class="change__kind"><input v-model="kind" type="radio" value="due_date" /> Due date</label>
        <label v-if="canSplit" class="change__kind"><input v-model="kind" type="radio" value="split" /> Split</label>
      </fieldset>

      <template v-if="kind === 'amount'">
        <div class="change__row">
          <label class="field">
            <span class="field__label">New amount ({{ shown.project.currency }})</span>
            <input v-model.number="amount" class="input money" type="number" min="1" step="0.01" inputmode="decimal" required />
          </label>
          <p class="change__diff money" aria-live="polite">{{ difference }}</p>
        </div>
        <label class="field">
          <span class="field__label">Why (optional, kept in your activity log)</span>
          <input v-model="note" class="input" maxlength="200" placeholder="e.g. $100 off, agreed with the client" />
        </label>
      </template>

      <label v-else-if="kind === 'due_date'" class="field">
        <span class="field__label">New due date</span>
        <input v-model="dueDate" class="input" type="date" :min="minDue" required />
      </label>

      <div v-else class="change__row">
        <label class="field">
          <span class="field__label">Payments</span>
          <select v-model.number="parts" class="input">
            <option v-for="n in [2, 3, 4, 5, 6]" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <p class="change__diff money">{{ splitPreview }}</p>
      </div>

      <label v-if="shown.project.portalToken" class="change__tell">
        <input v-model="tell" type="checkbox" /> Tell {{ client }} on their page
      </label>

      <p class="change__fine">{{ fine }}</p>

      <footer class="change__actions">
        <button type="button" class="btn btn--quiet" @click="changing = null">Not now</button>
        <button type="submit" class="btn" :disabled="!ready || busy === 'change'">{{ busy === 'change' ? 'Changing…' : 'Make the change' }}</button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.change {
  width: min(480px, calc(100vw - 32px));
  border: 0;
  padding: 0;
  border-radius: var(--radius-sheet);
  background: var(--paper-pure);
  color: var(--ink);
  box-shadow: 0 24px 64px -24px rgb(22 35 63 / 0.5);
}
/* Same enter and exit as the email review dialog. */
.change {
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity var(--dur-exit) var(--ease-out),
    transform var(--dur-exit) var(--ease-out),
    overlay var(--dur-exit) allow-discrete,
    display var(--dur-exit) allow-discrete;
}
.change[open] {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out),
    overlay var(--dur-enter) allow-discrete,
    display var(--dur-enter) allow-discrete;
}
@starting-style {
  .change[open] {
    opacity: 0;
    transform: scale(0.96);
  }
}
.change::backdrop {
  background: rgb(22 35 63 / 0);
  transition:
    background-color var(--dur-enter) var(--ease-out),
    overlay var(--dur-enter) allow-discrete,
    display var(--dur-enter) allow-discrete;
}
.change[open]::backdrop {
  background: rgb(22 35 63 / 0.4);
}
@starting-style {
  .change[open]::backdrop {
    background: rgb(22 35 63 / 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .change,
  .change[open] {
    transform: none;
  }
}
.change__form {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border-top: 4px solid var(--carbon);
}
.change__eyebrow {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.change__title {
  margin-top: 0.25rem;
  font-size: var(--t-lg);
}
.change__now {
  margin-top: 0.3rem;
  color: var(--ink-soft);
  font-size: var(--t-xs);
}
.change__kinds {
  display: flex;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.change__kind {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--rule);
  border-radius: 999px;
  font-size: var(--t-xs);
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color var(--dur-press) var(--ease-out),
    background-color var(--dur-press) var(--ease-out);
}
.change__kind:has(input:checked) {
  border-color: var(--carbon);
  background: var(--carbon-soft);
  color: var(--carbon);
}
.change__kind input {
  accent-color: var(--carbon);
  margin: 0;
}
.change__row {
  display: grid;
  grid-template-columns: minmax(0, 12rem) 1fr;
  align-items: end;
  gap: 0.75rem;
}
.change__diff {
  padding-bottom: 0.6rem;
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.change__tell {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.change__tell input {
  accent-color: var(--carbon);
  margin: 0;
}
.change__fine {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.change__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
