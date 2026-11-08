<script setup lang="ts">
/** The headline: where your money stands, as one plain sentence. */
const { data } = useDashboard()
const s = computed(() => data.value?.stats)
const m = (n: number, cur?: string) => formatMoney(n, cur ?? s.value?.currency ?? 'USD')
const others = computed(() => s.value?.otherCurrencies ?? [])
const empty = computed(() => !s.value || (!s.value.outstanding && !s.value.paid && !s.value.pipeline && !others.value.length))
</script>

<template>
  <section class="status" aria-live="polite">
    <p v-if="empty" class="status__line">Nothing billed yet. Paste a client message to set up your first job.</p>
    <p v-else-if="s && s.outstanding && s.overdue" class="status__line">
      You're owed <span class="money status__figure">{{ m(s.outstanding) }}</span>, and
      <span class="money status__figure status__figure--late">{{ m(s.overdue) }}</span> of it is overdue.
    </p>
    <p v-else-if="s && s.outstanding" class="status__line">
      You're owed <span class="money status__figure">{{ m(s.outstanding) }}</span>, none of it overdue yet.
    </p>
    <p v-else class="status__line">Every invoice you've sent is paid.</p>

    <p v-if="s && (s.paid || s.pipeline)" class="status__sub">
      <template v-if="s.paid"><span class="money">{{ m(s.paid) }}</span> collected through PayPal. </template>
      <template v-if="s.pipeline"><span class="money">{{ m(s.pipeline) }}</span> still to bill on active jobs.</template>
    </p>

    <p v-for="o in others" :key="o.currency" class="status__sub status__sub--other">
      Also in {{ o.currency }}:
      <template v-if="o.outstanding"><span class="money">{{ m(o.outstanding, o.currency) }}</span> owed<template v-if="o.overdue"> (<span class="money">{{ m(o.overdue, o.currency) }}</span> overdue)</template>. </template>
      <template v-if="o.paid"><span class="money">{{ m(o.paid, o.currency) }}</span> paid. </template>
      <template v-if="o.pipeline"><span class="money">{{ m(o.pipeline, o.currency) }}</span> in pipeline.</template>
    </p>
  </section>
</template>

<style scoped>
.status__line {
  font-size: clamp(var(--t-xl), 3.4vw, var(--t-2xl));
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.02em;
  max-width: 30ch;
}
.status__figure {
  /* Same face as the sentence, tabular figures. Mono is too heavy at headline size. */
  font-family: var(--font-ui);
  font-variant-numeric: tabular-nums;
  color: var(--carbon);
  font-weight: 600;
}
.status__figure--late {
  color: var(--overdue);
}
.status__sub {
  margin-top: 0.6rem;
  color: var(--ink-soft);
  font-size: var(--t-md);
}
</style>
