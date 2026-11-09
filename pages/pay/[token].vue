<script setup lang="ts">
import type { PortalView } from '~/types'

/**
 * The client page. Every invoice email links here. Your client sees this job's invoices,
 * pays through PayPal, and can talk to your agent, which may change payment terms within
 * your mandate. Updates are live: a payment or a change stamps in without a reload.
 */
const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))
const { data: view, error } = await useFetch<PortalView>(() => `/api/portal/${token.value}`, { key: `portal:${token.value}` })

const first = computed(() => view.value?.freelancer.name.trim().split(/\s+/)[0] ?? '')
useHead(() => ({
  title: view.value ? `${view.value.project}: invoices from ${view.value.freelancer.business}` : 'Invoices',
  meta: [{ name: 'robots', content: 'noindex' }],
}))

const money = (n: number) => formatMoney(n, view.value?.currency ?? 'USD')
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
/** Share of the job's total, for the meter. Drawn with scaleX so it animates on the compositor. */
const share = (n: number) => (view.value?.total ? Math.min(1, n / view.value.total) : 0)
const joined = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''))

const open = computed(() => view.value?.invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue') ?? [])
const nextDue = computed(() =>
  [...open.value].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0],
)
const balanceNote = computed(() => {
  const v = view.value
  if (!v) return ''
  if (!open.value.length) return v.paid ? 'Everything billed so far is paid. Thank you.' : 'Nothing to pay right now.'
  const late = open.value.filter((i) => i.status === 'overdue')
  if (late.length) return `${late.length === 1 ? 'One invoice is' : `${late.length} invoices are`} past due.`
  return nextDue.value?.dueDate ? `Next payment due ${day(nextDue.value.dueDate)}.` : ''
})

// --- Live updates --------------------------------------------------------------------------

const progress = ref<string | null>(null)
let progressTimer: ReturnType<typeof setTimeout> | undefined

async function reload() {
  const next = await $fetch<PortalView>(`/api/portal/${token.value}`).catch(() => null)
  if (next) view.value = next
}

useLive(() => `/api/portal/${token.value}/events`, {
  onChange: reload,
  onProgress: (text) => {
    progress.value = text
    clearTimeout(progressTimer)
    progressTimer = setTimeout(() => (progress.value = null), 8000)
  },
})

// The PAID stamp lands once, when the payment arrives. Never on page load. Clients pay in
// PayPal's own tab, so if this tab is in the background the stamp waits until they come back.
const fresh = ref(new Set<string>())
let waiting: string[] = []
function stamp(ids: string[]) {
  fresh.value = new Set(ids)
  setTimeout(() => (fresh.value = new Set()), 1400)
}
function onVisibility() {
  if (document.visibilityState === 'visible' && waiting.length) {
    stamp(waiting)
    waiting = []
  }
}
watch(
  () => view.value?.invoices.map((i) => `${i.id}:${i.status}`).join('|'),
  (now, before) => {
    if (!before || !now) return
    const was = new Map(before.split('|').map((x) => x.split(':') as [string, string]))
    const landed = view.value!.invoices.filter((i) => i.status === 'paid' && was.has(i.id) && was.get(i.id) !== 'paid').map((i) => i.id)
    if (!landed.length) return
    if (document.visibilityState === 'hidden') waiting = [...new Set([...waiting, ...landed])]
    else stamp(landed)
  },
)
onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility))

// --- Conversation --------------------------------------------------------------------------

const list = ref<HTMLDivElement | null>(null)
const message = ref('')
const sending = ref(false)
const pending = ref<string | null>(null)
const chatError = ref('')

const turns = computed(() => view.value?.conversation ?? [])
// Hide the optimistic copy once the real message has arrived over the live connection.
const showPending = computed(() => pending.value && turns.value.at(-1)?.text !== pending.value)

const suggestions = computed(() => {
  if (!view.value) return []
  const out: string[] = []
  if (open.value.length) out.push('Could I have a few more days?', 'Can I pay this in two parts?', "I've already paid")
  out.push(open.value.length ? 'What does this invoice cover?' : 'What will I be billed for?')
  return turns.value.length > 6 ? [] : out
})

const reduceMotion = import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches
function toBottom(smooth = false) {
  nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' }))
}
// Your own message jumps into view at once (it answers your keypress); replies glide in.
watch(
  () => turns.value.at(-1)?.id,
  (id, prev) => {
    if (id && id !== prev) toBottom(turns.value.at(-1)?.role !== 'client')
  },
)
watch(sending, (now) => {
  if (now) toBottom()
})
onMounted(() => toBottom())

async function send(text?: string) {
  const body = (text ?? message.value).trim()
  if (!body || sending.value) return
  chatError.value = ''
  pending.value = body
  message.value = ''
  sending.value = true
  progress.value = null
  try {
    view.value = await $fetch<PortalView>(`/api/portal/${token.value}/chat`, { method: 'POST', body: { message: body } })
  } catch (err) {
    chatError.value = errorText(err)
    if (!text) message.value = body
  } finally {
    sending.value = false
    pending.value = null
    progress.value = null
  }
}

const roleLabel = (role: string) => (role === 'agent' ? 'Assistant' : role === 'freelancer' ? first.value : 'You')
const when = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

onBeforeUnmount(() => clearTimeout(progressTimer))
</script>

<template>
  <div class="pay">
    <div v-if="error || !view" class="pay__gone">
      <h1>This link isn't valid any more</h1>
      <p>Ask whoever sent it for a new one. Nothing has been charged.</p>
    </div>

    <template v-else>
      <header class="pay__top">
        <div class="pay__brand">
          <span class="pay__mark" aria-hidden="true" />
          <span class="pay__business">{{ view.freelancer.business }}</span>
        </div>
        <span class="pay__by">Payments by PayPal</span>
      </header>

      <main class="pay__main">
        <section class="sheet" aria-labelledby="sheet-title">
          <p class="sheet__eyebrow">Statement for {{ view.client }}</p>
          <h1 id="sheet-title" class="sheet__title">{{ view.project }}</h1>

          <div class="sheet__balance">
            <p class="sheet__label">{{ open.length ? 'To pay' : 'Balance' }}</p>
            <p class="sheet__due">{{ money(view.due) }}</p>
            <p class="sheet__note">{{ balanceNote }}</p>
          </div>

          <div class="meter" role="img" :aria-label="`${money(view.paid)} paid of ${money(view.total)}`">
            <span class="meter__fill meter__fill--due" :style="{ transform: `scaleX(${share(view.paid + view.due)})` }" />
            <span class="meter__fill meter__fill--paid" :style="{ transform: `scaleX(${share(view.paid)})` }" />
          </div>
          <p class="meter__legend">
            <span><span class="meter__key meter__key--paid" />{{ money(view.paid) }} paid</span>
            <span>of {{ money(view.total) }} in total</span>
          </p>

          <TransitionGroup tag="ol" name="stub" class="stubs">
            <li v-for="inv in view.invoices" :key="inv.id" class="stub" :data-status="inv.status">
              <div class="stub__main">
                <p class="stub__name">{{ inv.name }}</p>
                <p v-if="inv.description" class="stub__desc">{{ inv.description }}</p>
                <p class="stub__meta">
                  <span v-if="inv.number">Invoice {{ inv.number }}</span>
                  <span v-if="inv.status === 'overdue'" class="stub__late">{{ inv.daysOverdue }} {{ inv.daysOverdue === 1 ? 'day' : 'days' }} past due</span>
                  <span v-else-if="inv.dueDate">Due {{ day(inv.dueDate) }}</span>
                  <span v-if="inv.extendedDays && inv.status !== 'replaced'" class="stub__note">{{ inv.extendedDays }} extra {{ inv.extendedDays === 1 ? 'day' : 'days' }} given</span>
                  <span v-if="inv.promiseDate" class="stub__note">You'll pay by {{ day(inv.promiseDate) }}</span>
                  <span v-if="inv.status === 'replaced'">Replaced by invoices {{ joined(inv.replacedBy) }}</span>
                </p>
              </div>
              <div class="stub__side">
                <p class="stub__amount money">{{ money(inv.amount) }}</p>
                <a v-if="inv.payUrl" :href="inv.payUrl" target="_blank" rel="noopener" class="btn btn--small stub__pay">Pay with PayPal</a>
                <span v-else-if="inv.status === 'paid'" class="stamp stamp--paid" :class="{ 'stamp--fresh': fresh.has(inv.id) }">Paid</span>
                <span v-else-if="inv.status === 'replaced'" class="stamp stamp--split">Split</span>
              </div>
            </li>
          </TransitionGroup>

          <p v-if="!view.invoices.length" class="sheet__empty">No invoices yet. They'll appear here as soon as {{ first }} sends them.</p>

          <div v-if="view.upcoming.length" class="later">
            <p class="later__title">Coming later</p>
            <ul class="later__list">
              <li v-for="u in view.upcoming" :key="u.name">
                <span>{{ u.name }} <span class="later__when">{{ u.when }}</span></span>
                <span class="money">{{ money(u.amount) }}</span>
              </li>
            </ul>
          </div>

          <p class="sheet__fine">
            You pay on PayPal's own secure page, with a PayPal account or a card. {{ view.freelancer.business }} never sees your card details.
          </p>
        </section>

        <section class="talk" aria-labelledby="talk-title">
          <header class="talk__head">
            <h2 id="talk-title" class="talk__title">Questions? Ask {{ first }}'s assistant</h2>
            <p class="talk__sub">
              <template v-if="view.agentCanHelp">It can explain an invoice, give you a little more time or split a payment, within limits {{ first }} has set. Anything else goes straight to {{ first }}.</template>
              <template v-else>It can explain your invoices and pass anything you need straight to {{ first }}.</template>
            </p>
          </header>

          <div ref="list" class="chat">
          <TransitionGroup tag="ol" name="msg" class="chat__list" aria-live="polite">
            <li key="hello" class="msg" data-role="agent">
              <p class="msg__who">Assistant</p>
              <p class="msg__text">Hi {{ view.client }}, I'm {{ first }}'s billing assistant. Ask me anything about these invoices.</p>
            </li>
            <li v-for="t in turns" :key="t.id" class="msg" :data-role="t.role">
              <p class="msg__who">{{ roleLabel(t.role) }} <time :datetime="t.at">{{ when(t.at) }}</time></p>
              <p class="msg__text">{{ t.text }}</p>
              <ul v-if="t.actions?.length" class="msg__receipts">
                <li v-for="(a, i) in t.actions" :key="i" class="receipt-line" :data-kind="a.kind">{{ a.text }}</li>
              </ul>
            </li>
            <li v-if="showPending" key="pending" class="msg" data-role="client">
              <p class="msg__who">You</p>
              <p class="msg__text">{{ pending }}</p>
            </li>
            <li v-if="sending" key="working" class="msg msg--working" data-role="agent">
              <p class="msg__who">Assistant</p>
              <p class="msg__text">
                <span class="dots" aria-hidden="true"><span /><span /><span /></span>
                <Transition name="swap" mode="out-in">
                  <span :key="progress ?? 'thinking'">{{ progress ? `${progress}…` : 'Reading your message' }}</span>
                </Transition>
              </p>
            </li>
          </TransitionGroup>
          </div>

          <div v-if="suggestions.length" class="chips">
            <button v-for="s in suggestions" :key="s" type="button" class="chip" :disabled="sending" @click="send(s)">{{ s }}</button>
          </div>

          <form class="composer" @submit.prevent="send()">
            <label class="visually-hidden" for="talk-input">Message</label>
            <textarea
              id="talk-input"
              v-model="message"
              class="composer__input"
              rows="1"
              maxlength="800"
              placeholder="Write a message"
              @keydown.enter.exact.prevent="send()"
            />
            <button type="submit" class="btn" :disabled="!message.trim() || sending">Send</button>
          </form>
          <p v-if="chatError" class="composer__error" role="alert">{{ chatError }}</p>
        </section>
      </main>
    </template>
  </div>
</template>

<style scoped>
.pay {
  min-height: 100vh;
  min-height: 100dvh;
}
.pay__gone {
  max-width: 34rem;
  margin: 0 auto;
  padding: 18vh 1.25rem;
  text-align: center;
}
.pay__gone h1 {
  font-size: var(--t-xl);
}
.pay__gone p {
  margin-top: 0.5rem;
  color: var(--ink-soft);
}
.pay__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem clamp(1rem, 4vw, 2.5rem);
  border-bottom: 1px solid var(--rule);
}
.pay__brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.pay__mark {
  flex-shrink: 0;
  width: 1rem;
  height: 1.25rem;
  background: var(--ink);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 83% 88%, 66% 100%, 50% 88%, 33% 100%, 17% 88%, 0 100%);
}
.pay__business {
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pay__by {
  font-size: var(--t-xs);
  color: var(--ink-faint);
  white-space: nowrap;
}
.pay__main {
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(1.25rem, 4vw, 2.75rem) clamp(1rem, 4vw, 2.5rem) 3rem;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: clamp(1.25rem, 3vw, 2.25rem);
  align-items: start;
}

/* --- The statement: a perforated sheet, like the plan receipt on the dashboard --- */
.sheet {
  --edge: 10px;
  background: var(--paper-pure);
  padding: 1.9rem 1.5rem 1.6rem;
  box-shadow: var(--shadow-sheet);
  -webkit-mask:
    conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / var(--edge) 51% repeat-x,
    conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / var(--edge) 51% repeat-x;
  mask:
    conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / var(--edge) 51% repeat-x,
    conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / var(--edge) 51% repeat-x;
}
.sheet__eyebrow {
  font-size: var(--t-xs);
  color: var(--carbon);
  font-weight: 500;
}
.sheet__title {
  margin-top: 0.2rem;
  font-size: var(--t-xl);
  letter-spacing: -0.015em;
}
.sheet__balance {
  margin-top: 1.4rem;
}
.sheet__label {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.sheet__due {
  font-size: clamp(2.1rem, 6vw, 2.9rem);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.05;
}
.sheet__note {
  margin-top: 0.3rem;
  color: var(--ink-soft);
}
.meter {
  position: relative;
  margin-top: 1.1rem;
  height: 6px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--rule-soft);
}
/* Two layers from the left edge: due (paid + due) underneath, paid on top. */
.meter__fill {
  position: absolute;
  inset: 0;
  transform-origin: left center;
  transition: transform 400ms var(--ease-out);
}
.meter__fill--paid {
  background: var(--paid);
}
.meter__fill--due {
  background: var(--carbon);
  opacity: 0.55;
}
.meter__legend {
  margin-top: 0.45rem;
  display: flex;
  justify-content: space-between;
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.meter__key {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 0.35rem;
  border-radius: 50%;
}
.meter__key--paid {
  background: var(--paid);
}
.stubs {
  list-style: none;
  margin: 1.4rem 0 0;
  padding: 0;
}
.stub {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
  border-top: 2px dashed var(--rule);
}
.stub[data-status='replaced'] {
  opacity: 0.55;
}
.stub__main {
  min-width: 0;
}
.stub__name {
  font-weight: 600;
  font-size: var(--t-md);
}
.stub__desc {
  color: var(--ink-soft);
  font-size: var(--t-xs);
}
.stub__meta {
  margin-top: 0.35rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.stub__late {
  color: var(--overdue);
  font-weight: 600;
}
.stub__note {
  color: var(--carbon);
}
.stub__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
}
.stub__amount {
  font-size: var(--t-lg);
  font-weight: 500;
}
.stub__pay {
  text-decoration: none;
}
/* New installments slide in where the original was; the rest make room. */
.stub-move,
.stub-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
}
.stub-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
/* The PAID stamp, pressed onto the stub the moment PayPal confirms the payment. */
.stamp--fresh {
  animation: stamp-in 460ms var(--ease-out) both;
}
@keyframes stamp-in {
  0% {
    opacity: 0;
    transform: rotate(-14deg) scale(1.9);
  }
  55% {
    opacity: 1;
    transform: rotate(-2deg) scale(0.92);
  }
  100% {
    transform: rotate(-3deg) scale(1);
  }
}
.sheet__empty {
  margin-top: 1.25rem;
  color: var(--ink-soft);
}
.later {
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 2px dashed var(--rule);
}
.later__title {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.later__list {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}
.later__list li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  color: var(--ink-soft);
}
.later__when {
  display: block;
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.sheet__fine {
  margin-top: 1.4rem;
  padding-top: 1rem;
  border-top: 3px double var(--ink);
  font-size: var(--t-xs);
  color: var(--ink-faint);
}

/* --- The assistant --- */
.talk {
  position: sticky;
  top: 1.25rem;
  display: flex;
  flex-direction: column;
  /* Fits the screen from its first position under the header, so the message box is never below the fold. */
  max-height: calc(100dvh - 8rem);
  background: var(--paper);
  border-radius: var(--radius-sheet);
  border-top: 4px solid var(--carbon);
  box-shadow: var(--shadow-sheet);
}
.talk__head {
  padding: 1.1rem 1.25rem 0.9rem;
  border-bottom: 1px solid var(--rule-soft);
}
.talk__title {
  font-size: var(--t-lg);
}
.talk__sub {
  margin-top: 0.3rem;
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.chat {
  flex: 1 1 auto;
  min-height: 12rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.chat__list {
  list-style: none;
  margin: 0;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
/* Replies and the working bubble rise in; your own message appears at once (it's your keypress). */
.msg-enter-active:not([data-role='client']) {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    transform var(--dur-enter) var(--ease-out);
}
.msg-enter-from:not([data-role='client']) {
  opacity: 0;
  transform: translateY(6px);
}
.msg {
  max-width: 86%;
  padding: 0.6rem 0.8rem;
  border-radius: 12px;
  background: var(--paper-pure);
  border: 1px solid var(--rule-soft);
}
.msg[data-role='client'] {
  align-self: flex-end;
  background: var(--carbon);
  border-color: var(--carbon);
  color: var(--paper-pure);
}
.msg[data-role='freelancer'] {
  border-color: var(--ink-soft);
}
.msg__who {
  display: flex;
  gap: 0.45rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--ink-soft);
}
.msg__who time {
  font-weight: 400;
  color: var(--ink-faint);
}
.msg[data-role='client'] .msg__who,
.msg[data-role='client'] .msg__who time {
  color: rgb(255 255 255 / 0.75);
}
.msg__text {
  margin-top: 0.1rem;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.msg__receipts {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
.msg--working .msg__text {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--carbon);
  font-size: var(--t-xs);
  font-weight: 500;
}
.dots {
  display: inline-flex;
  gap: 3px;
}
.dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: dot 1s ease-in-out infinite;
}
.dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes dot {
  0%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
.swap-enter-active {
  transition:
    opacity var(--dur-enter) var(--ease-out),
    filter var(--dur-enter) var(--ease-out);
}
.swap-leave-active {
  transition:
    opacity var(--dur-exit) var(--ease-out),
    filter var(--dur-exit) var(--ease-out);
}
.swap-enter-from,
.swap-leave-to {
  opacity: 0;
  filter: blur(2px);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0 1.25rem 0.75rem;
}
.chip {
  border: 1px solid var(--rule);
  background: var(--paper-pure);
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
  font: var(--t-xs) var(--font-ui);
  color: var(--ink-soft);
  cursor: pointer;
  transition:
    transform var(--dur-press) var(--ease-out),
    border-color var(--dur-press) var(--ease-out),
    color var(--dur-press) var(--ease-out);
}
.chip:active:not(:disabled) {
  transform: scale(0.97);
}
.chip:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (hover: hover) and (pointer: fine) {
  .chip:hover:not(:disabled) {
    border-color: var(--carbon);
    color: var(--carbon);
  }
}
.composer {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem 1rem;
  border-top: 1px solid var(--rule-soft);
}
.composer__input {
  flex: 1;
  min-width: 0;
  resize: none;
  field-sizing: content;
  min-height: 2.5rem;
  max-height: 8rem;
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  background: var(--paper-pure);
  color: var(--ink);
  /* 16px so phones don't zoom into the field. */
  font: 1rem / 1.4 var(--font-ui);
  padding: 0.5rem 0.7rem;
  transition:
    border-color var(--dur-press) var(--ease-out),
    box-shadow var(--dur-press) var(--ease-out);
}
.composer__input:focus {
  outline: none;
  border-color: var(--carbon);
  box-shadow: 0 0 0 3px var(--carbon-soft);
}
.composer__error {
  padding: 0 1.25rem 1rem;
  font-size: var(--t-xs);
  color: var(--overdue);
}

@media (max-width: 880px) {
  .pay__main {
    grid-template-columns: 1fr;
  }
  .talk {
    position: static;
    max-height: none;
  }
  .chat {
    max-height: 60vh;
  }
}
@media (max-width: 480px) {
  .pay__by {
    display: none;
  }
  .stub {
    flex-direction: column;
  }
  .stub__side {
    flex-direction: row;
    align-items: center;
  }
}
@media (prefers-reduced-motion: reduce) {
  .msg-enter-from:not([data-role='client']) {
    transform: none;
  }
  .stamp--fresh {
    animation: stamp-fade 200ms linear both;
  }
  @keyframes stamp-fade {
    from {
      opacity: 0;
    }
  }
  .dots span {
    animation: none;
    opacity: 0.6;
  }
  .meter__fill {
    transition: none;
  }
}
</style>
