<script setup lang="ts">
/**
 * When you'll get paid: money per week, from what's already in to what's due, built with
 * AG Charts Community. One stacked column per week, coloured by state like the ledger stamps:
 *   paid     green, by the week PayPal reported it
 *   due      carbon blue, by due date (or the date the client promised to pay by)
 *   overdue  red, all in this week, because it's owed now
 * Stack order paid, due, overdue keeps green and red from ever touching; the palette was run
 * through the colour-blind validator, and overdue money is also spelled out in the caption.
 * The ledger below is this chart's table view: every amount here is a row there.
 * It updates live, so a split or an extension agreed on a client page visibly moves money.
 */
import {
  AgCharts,
  AllCommunityModule,
  ModuleRegistry,
  type AgCartesianChartOptions,
  type AgChartInstance,
  type AgTooltipRendererResult,
} from 'ag-charts-community'
import type { ReceivableRow } from '~/types'

ModuleRegistry.registerModules([AllCommunityModule])

const { data, status } = useDashboard()

const DAY = 86_400_000
const WEEK = 7 * DAY
const WEEKS_BACK = 4
const WEEKS_AHEAD_MIN = 6
const WEEKS_AHEAD_MAX = 12

// Same tokens as assets/css/main.css. Canvas can't read CSS variables, so they're repeated here.
const COLOR = { paid: '#18794e', due: '#2747c9', overdue: '#b4322a' } as const
const INK_SOFT = '#4a5672'
const INK_FAINT = '#7d879c'
const RULE_SOFT = '#e1e6ed'
const SURFACE = '#ffffff'
const FONT = 'Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif'

type Kind = keyof typeof COLOR
interface Item {
  label: string
  amount: number
}
interface Week {
  label: string
  range: string
  paid: number
  due: number
  overdue: number
  items: Record<Kind, Item[]>
}

const currency = computed(() => status.value?.freelancer.currency ?? 'USD')
const money = (n: number) => formatMoney(n, currency.value)

/** Monday 00:00 UTC of the week holding `ms`. Dates in Paylane are calendar days in UTC. */
function mondayOf(ms: number) {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
}
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const short = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Where each invoice's money lands, week by week. */
const model = computed(() => {
  const rows = (data.value?.rows ?? []).filter((r) => r.currency === currency.value)
  const thisWeek = mondayOf(Date.now())
  const first = thisWeek - WEEKS_BACK * WEEK

  const placed: Array<{ week: number; kind: Kind; item: Item }> = []
  let notInvoiced = 0
  const name = (r: ReceivableRow) => (r.invoiceNumber ? `${r.invoiceNumber}, ${r.client}` : r.client)
  for (const r of rows) {
    if (r.status === 'paid' && r.paidAt) {
      placed.push({ week: mondayOf(Date.parse(r.paidAt)), kind: 'paid', item: { label: name(r), amount: r.amount } })
    } else if (r.status === 'sent') {
      if (r.promiseDate) placed.push({ week: mondayOf(dayOf(r.promiseDate)), kind: 'due', item: { label: `${name(r)} (promised)`, amount: r.amount } })
      else if (r.daysOverdue > 0) placed.push({ week: thisWeek, kind: 'overdue', item: { label: `${name(r)}, ${r.daysOverdue}d late`, amount: r.amount } })
      else if (r.dueDate) placed.push({ week: mondayOf(dayOf(r.dueDate)), kind: 'due', item: { label: name(r), amount: r.amount } })
    } else if (r.status === 'planned' || r.status === 'draft') {
      notInvoiced += r.amount
    }
  }

  const furthest = Math.max(thisWeek + WEEKS_AHEAD_MIN * WEEK, ...placed.filter((p) => p.kind !== 'paid').map((p) => p.week))
  const last = Math.min(furthest, thisWeek + WEEKS_AHEAD_MAX * WEEK)
  const weeks = new Map<number, Week>()
  for (let w = first; w <= last; w += WEEK) {
    weeks.set(w, {
      label: w === thisWeek ? 'This week' : short(w),
      range: w === thisWeek ? `This week, from ${short(w)}` : `Week of ${short(w)}`,
      paid: 0,
      due: 0,
      overdue: 0,
      items: { paid: [], due: [], overdue: [] },
    })
  }
  let clamped = false
  for (const p of placed) {
    if (p.week < first) continue // older history
    const key = p.week > last ? last : p.week
    if (p.week > last) clamped = true
    const w = weeks.get(key)!
    w[p.kind] = Math.round((w[p.kind] + p.item.amount) * 100) / 100
    w.items[p.kind].push(p.item)
  }
  if (clamped) {
    const w = weeks.get(last)!
    w.label = 'Later'
    w.range = `From ${short(last)} on`
  }

  const list = [...weeks.values()]
  const sum = (k: Kind) => Math.round(list.reduce((s, w) => s + w[k], 0) * 100) / 100
  return {
    weeks: list,
    due: sum('due'),
    overdue: sum('overdue'),
    paid: sum('paid'),
    notInvoiced: Math.round(notInvoiced * 100) / 100,
    weeksAhead: Math.round((last - thisWeek) / WEEK),
    otherCurrencies: [...new Set((data.value?.rows ?? []).map((r) => r.currency).filter((c) => c !== currency.value))],
  }
})

const empty = computed(() => !model.value.due && !model.value.overdue && !model.value.paid)

/** Plain sentence under the title: the numbers that matter, so nothing depends on colour or hover. */
const caption = computed(() => {
  const m = model.value
  const parts: string[] = []
  parts.push(m.due ? `${money(m.due)} is due over the next ${m.weeksAhead} weeks` : 'Nothing is due in the next few weeks')
  if (m.overdue) parts[0] += `, and ${money(m.overdue)} is overdue now`
  let text = `${parts[0]}.`
  if (m.notInvoiced) text += ` ${money(m.notInvoiced)} isn't invoiced yet, so it isn't on the chart.`
  if (m.otherCurrencies.length) text += ` Showing ${currency.value} only.`
  return text
})

// --- Axis and tooltip text ----------------------------------------------------------------------

/** Full figures under 10,000 ($500, $1,000), compact from there ($12K). */
function axisMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.value,
    maximumFractionDigits: 0,
    ...(value >= 10_000 ? { notation: 'compact' } : {}),
  }).format(value)
}

const KIND_WORD: Record<Kind, string> = { paid: 'paid', due: 'due', overdue: 'overdue' }

/** Value first, then what makes it up. AG Charts escapes this text, so client names are safe. */
function tooltipFor(week: Week, kind: Kind): AgTooltipRendererResult {
  const items = week.items[kind]
  const rows = items.slice(0, 5).map((i) => ({ label: i.label, value: money(i.amount) }))
  if (items.length > 5) rows.push({ label: `and ${items.length - 5} more`, value: '' })
  return { heading: week.range, title: `${money(week[kind])} ${KIND_WORD[kind]}`, data: rows }
}

// --- The chart ----------------------------------------------------------------------------------

const host = ref<HTMLDivElement | null>(null)
const barWidth = ref(20)
let chart: AgChartInstance | null = null
let resize: ResizeObserver | null = null

function series(kind: Kind, name: string): NonNullable<AgCartesianChartOptions['series']>[number] {
  return {
    type: 'bar',
    xKey: 'label',
    yKey: kind,
    yName: name,
    stacked: true,
    fill: COLOR[kind],
    // A 2px surface-coloured edge is the gap between stacked parts.
    stroke: SURFACE,
    strokeWidth: 2,
    cornerRadius: 4,
    width: barWidth.value,
    tooltip: { renderer: (p) => tooltipFor(p.datum as Week, kind) },
    // The hovered part stands out; the rest of its column stays readable.
    highlight: { unhighlightedItem: { opacity: 0.6 }, unhighlightedSeries: { opacity: 0.6 } },
  }
}

function options(): AgCartesianChartOptions {
  return {
    container: host.value!,
    data: model.value.weeks,
    background: { visible: false },
    padding: { top: 12, right: 4, bottom: 4, left: 0 },
    legend: { enabled: false },
    // Each column segment is its own hit target with its own tooltip; no "$0.00 paid" rows.
    tooltip: { mode: 'single' },
    series: [series('paid', 'Paid'), series('due', 'Due'), series('overdue', 'Overdue')],
    axes: {
      x: {
        type: 'category',
        position: 'bottom',
        label: { color: INK_FAINT, fontFamily: FONT, fontSize: 12 },
        line: { stroke: RULE_SOFT, strokeWidth: 1 },
        tick: { size: 0 },
      },
      y: {
        type: 'number',
        position: 'left',
        min: 0,
        label: { color: INK_FAINT, fontFamily: FONT, fontSize: 12, formatter: ({ value }) => axisMoney(Number(value)) },
        line: { enabled: false },
        tick: { size: 0 },
        gridLine: { style: [{ stroke: RULE_SOFT, lineDash: [] }], width: 1 },
      },
    },
  }
}

/** Columns stay thin: under half a week's slot, never wider than 24px. */
function measure() {
  const width = host.value?.clientWidth ?? 0
  const slots = Math.max(1, model.value.weeks.length)
  const next = Math.max(6, Math.min(24, Math.floor(((width - 48) / slots) * 0.45)))
  if (next !== barWidth.value) barWidth.value = next
}

onMounted(async () => {
  // Canvas text measures with whatever font is loaded, so wait for the app's.
  await document.fonts?.ready
  if (!host.value) return
  measure()
  chart = AgCharts.create(options())
  resize = new ResizeObserver(measure)
  resize.observe(host.value)
})

// Live: new data or a new column width redraws in place. (Animated transitions need
// AnimationModule, which is AG Charts Enterprise only, so updates redraw without motion.)
watch([model, barWidth], () => {
  if (chart && host.value) chart.update(options())
})

onBeforeUnmount(() => {
  resize?.disconnect()
  chart?.destroy()
  chart = null
})

const legend: Array<{ kind: Kind; label: string }> = [
  { kind: 'paid', label: 'Paid' },
  { kind: 'due', label: 'Due' },
  { kind: 'overdue', label: 'Overdue' },
]
</script>

<template>
  <figure class="flow" aria-labelledby="flow-title" aria-describedby="flow-caption">
    <header class="flow__head">
      <div>
        <h2 id="flow-title" class="flow__title">When you'll get paid</h2>
        <figcaption id="flow-caption" class="flow__caption">{{ caption }} Every invoice is in the ledger below.</figcaption>
      </div>
      <ul class="flow__legend" aria-label="Legend">
        <li v-for="l in legend" :key="l.kind" class="flow__key">
          <span class="flow__swatch" :style="{ background: COLOR[l.kind] }" aria-hidden="true" />{{ l.label }}
        </li>
      </ul>
    </header>
    <p v-if="empty" class="flow__empty">Send an invoice and its due date shows up here, week by week.</p>
    <div v-show="!empty" ref="host" class="flow__chart" />
  </figure>
</template>

<style scoped>
.flow {
  margin: 0;
  padding: 1.25rem 1.25rem 0.75rem;
  background: var(--paper-pure);
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-sheet);
}
.flow__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem 1.5rem;
}
.flow__title {
  font-size: var(--t-lg);
}
.flow__caption {
  margin-top: 0.3rem;
  max-width: 68ch;
  color: var(--ink-soft);
  font-size: var(--t-xs);
}
.flow__legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 1rem;
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.flow__key {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.flow__swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
/* Fixed height includes the x-axis band, so the card never scrolls inside. */
.flow__chart {
  height: 15rem;
  margin-top: 0.75rem;
}
.flow__empty {
  margin: 1rem 0 0.5rem;
  color: var(--ink-soft);
}
</style>

<style>
/* AG Charts' tooltip, in the app's type. */
.ag-charts-tooltip {
  font-family: var(--font-ui);
}
</style>
