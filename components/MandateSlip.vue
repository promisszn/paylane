<script setup lang="ts">
import type { Mandate } from '~/types'

/**
 * The agent's mandate as a signed slip: four clauses, a hard "never" line and your signature.
 * Unsigned, the agent asks before everything. Changing a clause needs signing again.
 */
const { data, status, busy, signMandate, revokeMandate } = useDashboard()

type Terms = Pick<Mandate, 'reminders' | 'extensionDays' | 'installments' | 'limit'>
const pick = (m: Mandate): Terms => ({ reminders: m.reminders, extensionDays: m.extensionDays, installments: m.installments, limit: m.limit })

const stored = computed(() => data.value?.mandate)
const terms = reactive<Terms>({ reminders: 'friendly', extensionDays: 7, installments: 2, limit: 1000 })

// Follow the stored mandate only when it actually changes, so a live refresh never wipes an edit in progress.
watch(
  () => JSON.stringify(stored.value ?? null),
  () => {
    if (stored.value) Object.assign(terms, pick(stored.value))
  },
  { immediate: true },
)

const signed = computed(() => Boolean(stored.value?.signedAt))
const changed = computed(() => {
  const m = stored.value
  return Boolean(m) && JSON.stringify(pick(m!)) !== JSON.stringify({ ...terms, limit: Number(terms.limit) || 0 })
})
const inForce = computed(() => signed.value && !changed.value)
const currency = computed(() => status.value?.freelancer.currency ?? 'USD')
const signer = computed(() => stored.value?.signedBy ?? status.value?.freelancer.name ?? '')
const signedOn = computed(() =>
  stored.value?.signedAt
    ? new Date(stored.value.signedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '',
)

// The signature is drawn once, right after you sign. Never on page load.
const fresh = ref(false)
async function sign() {
  const ok = await signMandate({ ...terms, limit: Math.max(0, Number(terms.limit) || 0) })
  if (ok) {
    fresh.value = true
    setTimeout(() => (fresh.value = false), 1200)
  }
}
</script>

<template>
  <section v-if="stored" class="mandate" :data-state="inForce ? 'signed' : signed ? 'changed' : 'unsigned'" aria-labelledby="mandate-heading">
    <header class="mandate__head">
      <div>
        <h2 id="mandate-heading" class="mandate__title">Agent mandate</h2>
        <p class="mandate__sub">What your agent may do on its own, here and on your clients' pages.</p>
      </div>
      <span class="mandate__state">{{ inForce ? `In force since ${signedOn}` : signed ? 'Changes not signed' : 'Not signed' }}</span>
    </header>

    <p v-if="!signed" class="mandate__hint">Until you sign, the agent asks you before everything. Pick what it may handle alone.</p>

    <ol class="mandate__clauses">
      <li class="clause">
        <span class="clause__n" aria-hidden="true">1</span>
        <label class="clause__text" for="clause-reminders">
          Send payment reminders
          <span class="clause__fine">Firm notices always come to you.</span>
        </label>
        <select id="clause-reminders" v-model="terms.reminders" class="clause__control">
          <option value="off">Never alone</option>
          <option value="friendly">Friendly ones</option>
          <option value="clear">Friendly and clear</option>
        </select>
      </li>
      <li class="clause">
        <span class="clause__n" aria-hidden="true">2</span>
        <label class="clause__text" for="clause-extension">
          Give a client more time to pay
          <span class="clause__fine">Once per invoice. PayPal sends the new due date.</span>
        </label>
        <select id="clause-extension" v-model.number="terms.extensionDays" class="clause__control">
          <option :value="0">Never alone</option>
          <option :value="3">Up to 3 days</option>
          <option :value="7">Up to 7 days</option>
          <option :value="14">Up to 14 days</option>
        </select>
      </li>
      <li class="clause">
        <span class="clause__n" aria-hidden="true">3</span>
        <label class="clause__text" for="clause-split">
          Split an unpaid invoice
          <span class="clause__fine">Two weeks apart. The total stays the same.</span>
        </label>
        <select id="clause-split" v-model.number="terms.installments" class="clause__control">
          <option :value="1">Never alone</option>
          <option :value="2">Into 2 payments</option>
          <option :value="3">Into up to 3</option>
        </select>
      </li>
      <li class="clause">
        <span class="clause__n" aria-hidden="true">4</span>
        <label class="clause__text" for="clause-limit">
          Only on invoices up to
          <span class="clause__fine">In {{ currency }}. Bigger ones, or other currencies, come to you.</span>
        </label>
        <span class="clause__money">
          <input id="clause-limit" v-model.number="terms.limit" type="number" min="0" step="50" class="clause__control money" />
          <span class="clause__currency">{{ currency }}</span>
        </span>
      </li>
    </ol>

    <p class="mandate__never">
      <strong>Never, whatever it's told:</strong> change a total, give a discount, cancel an invoice or agree to new work.
      The agent has no tool that can.
    </p>

    <footer class="mandate__foot">
      <div class="signature">
        <span v-if="inForce" class="signature__ink" :class="{ 'signature__ink--fresh': fresh }">{{ signer }}</span>
        <span class="signature__line" aria-hidden="true" />
        <span class="signature__label">{{ inForce ? `Signed, ${signedOn}` : 'Your signature' }}</span>
      </div>
      <div class="mandate__actions">
        <button v-if="inForce" type="button" class="btn btn--quiet btn--small" :disabled="busy === 'mandate'" @click="revokeMandate">Revoke</button>
        <button v-else type="button" class="btn btn--small" :disabled="busy === 'mandate'" @click="sign">
          {{ busy === 'mandate' ? 'Signing…' : signed ? 'Sign the changes' : 'Sign mandate' }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.mandate {
  position: relative;
  background: var(--paper-pure);
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-sheet);
  padding: 1.25rem 1.25rem 1.1rem 1.5rem;
  /* The carbon edge: blue while signed, amber while unsigned or edited. */
  border-left: 4px solid var(--draft);
  transition: border-color var(--dur-enter) var(--ease-out);
}
.mandate[data-state='signed'] {
  border-left-color: var(--carbon);
}
.mandate__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}
.mandate__title {
  font-size: var(--t-lg);
}
.mandate__sub {
  margin-top: 0.2rem;
  color: var(--ink-soft);
  font-size: var(--t-xs);
}
.mandate__state {
  flex-shrink: 0;
  font-size: var(--t-xs);
  font-weight: 600;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--draft-soft);
  color: var(--draft);
  white-space: nowrap;
}
.mandate[data-state='signed'] .mandate__state {
  background: var(--carbon-soft);
  color: var(--carbon);
}
.mandate__hint {
  margin-top: 0.75rem;
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.mandate__clauses {
  list-style: none;
  margin: 0.9rem 0 0;
  padding: 0;
}
.clause {
  display: grid;
  grid-template-columns: 1.4rem 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0;
  border-top: 1px dashed var(--rule);
}
.clause__n {
  font: 500 var(--t-xs) var(--font-money);
  color: var(--ink-faint);
}
.clause__text {
  font-weight: 500;
  line-height: 1.3;
}
.clause__fine {
  display: block;
  font-weight: 400;
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.clause__control {
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: var(--paper);
  font: var(--t-xs) var(--font-ui);
  color: var(--ink);
  padding: 0.3rem 0.4rem;
  transition: border-color var(--dur-press) var(--ease-out);
}
.clause__control:focus {
  outline: none;
  border-color: var(--carbon);
}
.clause__money {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}
.clause__money input {
  width: 5.5rem;
  text-align: right;
}
.clause__currency {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.mandate__never {
  margin-top: 0.4rem;
  padding: 0.65rem 0.75rem;
  background: var(--paper);
  border-radius: var(--radius-control);
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.mandate__never strong {
  color: var(--ink);
}
.mandate__foot {
  margin-top: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
}
.signature {
  position: relative;
  flex: 1;
  max-width: 17rem;
  min-height: 3.1rem;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.signature__ink {
  position: absolute;
  left: 0.2rem;
  bottom: 1.05rem;
  font: 2.1rem / 1 var(--font-sign);
  color: var(--carbon);
  white-space: nowrap;
  transform: rotate(-2deg);
  transform-origin: left bottom;
}
/* Drawn left to right like a pen stroke, once, in answer to the click. */
.signature__ink--fresh {
  animation: ink-in 700ms var(--ease-in-out) both;
}
@keyframes ink-in {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .signature__ink--fresh {
    animation: ink-fade 200ms linear both;
  }
  @keyframes ink-fade {
    from {
      opacity: 0;
    }
  }
}
.signature__line {
  display: block;
  border-bottom: 1px solid var(--ink-soft);
}
.signature__label {
  margin-top: 0.25rem;
  font-size: 0.72rem;
  color: var(--ink-faint);
}
.mandate__actions {
  flex-shrink: 0;
}
@media (max-width: 520px) {
  .clause {
    grid-template-columns: 1.2rem 1fr;
  }
  .clause__control,
  .clause__money {
    grid-column: 2;
    justify-self: start;
  }
  .mandate__head {
    flex-direction: column;
    gap: 0.5rem;
  }
}
</style>
