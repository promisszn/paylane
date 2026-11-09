<script setup lang="ts">
import type { ProjectPlan } from '~/types'

/**
 * The agent's proposed payment plan, shown as a perforated receipt.
 * Every field is editable. Nothing is saved or sent until "Approve plan".
 */
const { plan, approvePlan, busy } = useDashboard()

type DraftMilestone = ProjectPlan['milestones'][number] & { _key: number }
type DraftPlan = Omit<ProjectPlan, 'milestones' | 'client'> & { client: { name: string; email: string }; milestones: DraftMilestone[] }

let keySeed = 0
const draft = ref<DraftPlan>(clone(plan.value!))

watch(plan, (p) => {
  if (p) draft.value = clone(p)
})

function clone(p: ProjectPlan): DraftPlan {
  const copy = JSON.parse(JSON.stringify(p)) as ProjectPlan
  return {
    ...copy,
    client: { name: copy.client.name, email: copy.client.email ?? '' },
    milestones: copy.milestones.map((m) => ({ ...m, _key: ++keySeed })),
  }
}

const total = computed(() => Math.round(draft.value.milestones.reduce((s, m) => s + (Number(m.amount) || 0), 0) * 100) / 100)
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.value.client.email))

function addMilestone() {
  draft.value.milestones.push({ name: 'New milestone', description: '', amount: 0, trigger: 'on_completion', dueDays: 7, _key: ++keySeed })
}

function removeMilestone(i: number) {
  if (draft.value.milestones.length > 1) draft.value.milestones.splice(i, 1)
}

function approve() {
  const { milestones, ...rest } = draft.value
  approvePlan({
    ...rest,
    total: total.value,
    milestones: milestones.map(({ _key, ...m }) => ({ ...m, amount: Number(m.amount) })),
  })
}
</script>

<template>
  <section class="receipt" aria-labelledby="receipt-heading">
    <header class="receipt__head">
      <p class="receipt__from">Proposed by the agent</p>
      <h2 id="receipt-heading" class="receipt__title">
        <input v-model="draft.title" class="receipt__title-input" aria-label="Project name" />
      </h2>
      <p class="receipt__summary">{{ plan?.summary }}</p>
    </header>

    <div class="receipt__client">
      <label class="field">
        <span class="field__label">Client</span>
        <input v-model="draft.client.name" class="input" />
      </label>
      <label class="field">
        <span class="field__label">Client email (invoices go here)</span>
        <input v-model="draft.client.email" class="input" type="email" placeholder="client@company.com" :aria-invalid="!emailValid" />
      </label>
    </div>

    <ul v-if="plan?.questions.length" class="receipt__questions" aria-label="Things to confirm">
      <li v-for="q in plan.questions" :key="q">{{ q }}</li>
    </ul>

    <TransitionGroup tag="ol" name="stub" class="receipt__stubs">
      <li v-for="(m, i) in draft.milestones" :key="m._key" class="stub">
        <div class="stub__main">
          <input v-model="m.name" class="stub__name" aria-label="Milestone name" />
          <input v-model="m.description" class="stub__desc" aria-label="What it covers" placeholder="What this payment covers" />
          <div class="stub__meta">
            <select v-model="m.trigger" class="stub__select" aria-label="When to bill">
              <option value="upfront">Bill now</option>
              <option value="on_completion">Bill when done</option>
            </select>
            <label class="stub__due">
              due in
              <input v-model.number="m.dueDays" type="number" min="0" max="90" class="stub__days" aria-label="Days to pay" />
              days
            </label>
            <button v-if="draft.milestones.length > 1" type="button" class="stub__remove" @click="removeMilestone(i)">Remove</button>
          </div>
        </div>
        <label class="stub__amount">
          <span class="visually-hidden">Amount</span>
          <input v-model.number="m.amount" type="number" min="0" step="0.01" class="money" />
          <span class="stub__currency">{{ draft.currency }}</span>
        </label>
      </li>
    </TransitionGroup>

    <button type="button" class="receipt__add" @click="addMilestone">Add a milestone</button>

    <footer class="receipt__foot">
      <div class="receipt__total">
        <span>Total</span>
        <strong class="money">{{ formatMoney(total, draft.currency) }}</strong>
      </div>
      <div class="receipt__actions">
        <button type="button" class="btn btn--quiet" @click="plan = null">Discard</button>
        <button type="button" class="btn" :disabled="!emailValid || busy === 'approve'" :data-loading="busy === 'approve'" :aria-busy="busy === 'approve'" @click="approve">
          Approve plan
        </button>
      </div>
      <p class="receipt__fine">
        Approving saves the job and drafts the first invoice in PayPal. Your client sees nothing until you press Send.
      </p>
    </footer>
  </section>
</template>

<style scoped>
.receipt {
  position: relative;
  background: var(--paper-pure);
  border-radius: var(--radius-sheet);
  padding: 1.5rem;
  box-shadow: var(--shadow-sheet);
  /* Appears in answer to "Plan payments": a short, quiet reveal, not a show. */
  animation: receipt-in var(--dur-enter) var(--ease-out);
}
@keyframes receipt-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.99);
  }
}
@media (prefers-reduced-motion: reduce) {
  .receipt {
    animation-name: fade-in;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
}
.receipt__from {
  font-size: var(--t-xs);
  color: var(--ink-soft);
  font-weight: 500;
}
.receipt__title-input {
  width: 100%;
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  font: 600 var(--t-xl) / 1.2 var(--font-ui);
  color: var(--ink);
  padding: 0.15rem 0;
  letter-spacing: -0.015em;
}
.receipt__title-input:hover,
.receipt__title-input:focus {
  outline: none;
  border-bottom-color: var(--rule);
}
.receipt__summary {
  margin-top: 0.3rem;
  color: var(--ink-soft);
  max-width: 60ch;
}
.receipt__client {
  margin-top: 1.25rem;
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 0.75rem;
}
.input[aria-invalid='true'] {
  border-color: var(--draft);
}
.receipt__questions {
  margin: 1rem 0 0;
  padding: 0.75rem 1rem 0.75rem 2rem;
  background: var(--draft-soft);
  color: var(--draft);
  border-radius: var(--radius-control);
  font-size: var(--t-xs);
  display: grid;
  gap: 0.25rem;
}
.receipt__stubs {
  list-style: none;
  margin: 1.25rem 0 0;
  padding: 0;
}
.stub-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
}
.stub-leave-active {
  transition:
    opacity var(--dur-exit) var(--ease-out),
    transform var(--dur-exit) var(--ease-out);
}
.stub-enter-from,
.stub-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.stub {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
  border-top: 1px solid var(--rule-soft);
}
.stub__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.2rem;
}
.stub__name,
.stub__desc {
  border: 0;
  background: transparent;
  color: var(--ink);
  font: 600 var(--t-md) var(--font-ui);
  padding: 0.1rem 0;
  width: 100%;
}
.stub__desc {
  font-weight: 400;
  font-size: var(--t-sm);
  color: var(--ink-soft);
}
.stub__name:focus,
.stub__desc:focus {
  outline: none;
  box-shadow: inset 0 -1px 0 var(--carbon);
}
.stub__meta {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.stub__select,
.stub__days {
  border: 1px solid var(--rule);
  border-radius: 6px;
  background: var(--paper-pure);
  font: var(--t-xs) var(--font-ui);
  color: var(--ink);
  padding: 0.25rem 0.4rem;
}
.stub__days {
  width: 3.2rem;
}
.stub__remove {
  border: 0;
  background: none;
  color: var(--ink-faint);
  font: var(--t-xs) var(--font-ui);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .stub__remove:hover {
    color: var(--overdue);
  }
}
.stub__amount {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}
.stub__amount input {
  width: 7.5rem;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  text-align: right;
  font: 600 var(--t-lg) var(--font-ui);
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  padding: 0.1rem 0;
}
.stub__amount input:focus {
  outline: none;
  border-bottom-color: var(--carbon);
}
.stub__currency {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.receipt__add {
  border: 0;
  background: var(--paper);
  width: 100%;
  padding: 0.55rem;
  border-radius: var(--radius-control);
  font: var(--t-xs) var(--font-ui);
  color: var(--ink-soft);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .receipt__add:hover {
    background: var(--rule-soft);
    color: var(--ink);
  }
}
.receipt__add:active,
.stub__remove:active {
  transform: scale(0.97);
}
.receipt__add {
  transition:
    transform var(--dur-press) var(--ease-out),
    background-color var(--dur-press) var(--ease-out),
    color var(--dur-press) var(--ease-out);
}
.receipt__foot {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--rule);
}
.receipt__total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-weight: 600;
}
.receipt__total strong {
  font-size: var(--t-2xl);
  font-weight: 600;
  letter-spacing: -0.025em;
}
.receipt__actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.receipt__fine {
  margin-top: 0.75rem;
  font-size: var(--t-xs);
  color: var(--ink-faint);
  text-align: right;
}
@media (max-width: 640px) {
  .receipt__client {
    grid-template-columns: 1fr;
  }
  .stub {
    flex-direction: column;
  }
  .stub__amount input {
    text-align: left;
  }
}
</style>
