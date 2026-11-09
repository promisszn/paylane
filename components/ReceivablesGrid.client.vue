<script setup lang="ts">
/**
 * Every billable milestone across every job, in AG Grid.
 * Actions live in the last column and route through the same review dialogs
 * as the suggestions, so the human checkpoint is identical everywhere.
 *
 * AG Grid does the ledger work too:
 *   - quick filter: one search box across client, job, invoice, amount, status and due date
 *   - pinned bottom rows: a totals row per currency that follows the search
 *   - CSV export of exactly the rows shown, with clean values for an accountant
 *   - live delta updates (getRowId): cells the agent or PayPal change flash briefly
 * Phones get a card list fed from the grid's own filtered, sorted rows, so both always agree.
 */
import { AgGridVue } from 'ag-grid-vue3'
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClickedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type ProcessCellForExportParams,
  type RowClassParams,
} from 'ag-grid-community'
import type { ReceivableRow } from '~/types'

ModuleRegistry.registerModules([AllCommunityModule])

const { data, status, reviewInvoice, reviewReminder, cancelMilestone, makeOverdue, openChange } = useDashboard()
const demo = computed(() => Boolean(status.value?.demoMode))

/** What the totals row adds up, per currency, over the rows the search leaves. */
interface Totals {
  count: number
  total: number
  paid: number
  owed: number
  overdue: number
}
/** A ledger row, or (pinned at the bottom) a totals row carrying `totals`. */
type LedgerRow = ReceivableRow & { totals?: Totals }

const theme = themeQuartz.withParams({
  fontFamily: 'Schibsted Grotesk, sans-serif',
  fontSize: 14,
  foregroundColor: '#16233f',
  backgroundColor: '#ffffff',
  headerBackgroundColor: '#f7f8fa',
  headerFontWeight: 600,
  headerTextColor: '#4a5672',
  borderColor: '#e1e6ed',
  rowHoverColor: '#f2f5fd',
  accentColor: '#2747c9',
  wrapperBorderRadius: 3,
  rowHeight: 52,
  headerHeight: 44,
  // The flash when a payment lands or the agent changes terms on a client page.
  valueChangeValueHighlightBackgroundColor: '#e0f1e8',
})

const dayMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const isTotal = (p: { node?: { rowPinned?: string | null } | null }) => Boolean(p.node?.rowPinned)

function statusLabel(r: ReceivableRow) {
  if (r.status === 'cancelled' && r.splitInto) return { text: `Split in ${r.splitInto}`, cls: 'split' }
  if (r.status === 'sent' && r.promiseDate) return { text: `Promised ${dayMonth(r.promiseDate)}`, cls: 'promised' }
  if (r.status === 'sent' && r.daysOverdue > 0) return { text: `${r.daysOverdue}d overdue`, cls: 'overdue' }
  const text: Record<ReceivableRow['status'], string> = {
    planned: r.trigger === 'upfront' ? 'Not drafted' : 'Bill when done',
    draft: 'Draft',
    sent: 'Sent',
    paid: 'Paid',
    cancelled: 'Cancelled',
  }
  return { text: text[r.status], cls: r.status }
}

function actionsFor(r: ReceivableRow): Array<[string, string]> {
  switch (r.status) {
    case 'planned':
      return r.trigger === 'upfront' ? [['draft', 'Draft'], ['change', 'Change']] : [['done', 'Mark done'], ['change', 'Change']]
    case 'draft':
      return [['send', 'Send'], ['change', 'Change'], ['cancel', 'Cancel']]
    case 'sent':
      return demo.value
        ? [['remind', 'Remind'], ['change', 'Change'], ['page', 'Client page'], ['overdue', 'Backdate']]
        : [['remind', 'Remind'], ['change', 'Change'], ['page', 'Client page']]
    case 'paid':
      return r.clientPage ? [['page', 'Client page']] : []
    default:
      return []
  }
}

// --- The totals row ---------------------------------------------------------------------------

function totalsByCurrency(rows: ReceivableRow[]) {
  const by = new Map<string, Totals>()
  for (const r of rows) {
    // Cancelled and split-off invoices are kept for the record but owe nothing.
    if (r.status === 'cancelled') continue
    const t = by.get(r.currency) ?? { count: 0, total: 0, paid: 0, owed: 0, overdue: 0 }
    t.count++
    t.total += r.amount
    if (r.status === 'paid') t.paid += r.amount
    if (r.status === 'sent') {
      t.owed += r.amount
      if (r.daysOverdue > 0) t.overdue += r.amount
    }
    by.set(r.currency, t)
  }
  const cents = (n: number) => Math.round(n * 100) / 100
  return [...by].map(([currency, t]) => ({
    currency,
    totals: { count: t.count, total: cents(t.total), paid: cents(t.paid), owed: cents(t.owed), overdue: cents(t.overdue) },
  }))
}

function totalRows(rows: ReceivableRow[]): LedgerRow[] {
  const groups = totalsByCurrency(rows)
  return groups.map(({ currency, totals }) => ({
    projectId: '',
    // Keyed by its contents: the grid only redraws cells whose value changed, and the label and
    // breakdown cells keep the same value, so a changed total must arrive as a new row.
    milestoneId: `total:${currency}:${Object.values(totals).join('-')}`,
    client: groups.length > 1 ? `${currency} total` : 'Total',
    project: '',
    milestone: '',
    amount: totals.total,
    currency,
    status: 'planned',
    trigger: 'upfront',
    invoiceNumber: null,
    sentAt: null,
    paidAt: null,
    dueDate: null,
    daysOverdue: 0,
    reminders: 0,
    payerUrl: null,
    clientPage: null,
    extendedDays: 0,
    promiseDate: null,
    splitInto: 0,
    installment: null,
    wasAmount: null,
    totals,
  }))
}

/** Built with textContent: client and job names come from client messages, so never as HTML. */
function totalLabel(p: ICellRendererParams<LedgerRow>) {
  const wrap = document.createElement('span')
  wrap.className = 'ledger-total__label'
  const strong = document.createElement('strong')
  strong.textContent = p.data?.client ?? 'Total'
  const count = document.createElement('span')
  const n = p.data?.totals?.count ?? 0
  count.textContent = `${n} ${n === 1 ? 'payment' : 'payments'}`
  wrap.append(strong, count)
  return wrap
}

/** Paid, owed and overdue for the totals row: a swatch carries the colour, the text stays ink. */
function totalBreakdown(r: LedgerRow) {
  const wrap = document.createElement('span')
  wrap.className = 'ledger-total__parts'
  const parts: Array<[keyof Totals, string]> = [
    ['paid', 'paid'],
    ['owed', 'owed'],
    ['overdue', 'overdue'],
  ]
  for (const [key, label] of parts) {
    const value = r.totals?.[key] ?? 0
    if (!value) continue
    const part = document.createElement('span')
    part.className = `ledger-total__part ledger-total__part--${key}`
    part.textContent = `${formatMoney(value, r.currency)} ${label}`
    wrap.append(part)
  }
  if (!wrap.childElementCount) wrap.textContent = 'Nothing billed yet'
  return wrap
}

// --- Columns ----------------------------------------------------------------------------------

const columnDefs: ColDef<LedgerRow>[] = [
  // Client names are short, job names are the longest text, so Job gets the most room.
  // Fixed columns are sized to their content so the whole grid fits 1160px even in demo mode
  // (flex minimums 70 + 110 + 110 plus fixed widths 851 = 1141), with every header readable.
  {
    field: 'client',
    headerName: 'Client',
    minWidth: 70,
    flex: 0.7,
    tooltipField: 'client',
    // On the totals row, the label spans Client, Job and Milestone.
    colSpan: (p) => (isTotal(p) ? 3 : 1),
    cellRendererSelector: (p) => (isTotal(p) ? { component: totalLabel } : undefined),
  },
  { field: 'project', headerName: 'Job', minWidth: 110, flex: 1.4, tooltipField: 'project' },
  { field: 'milestone', headerName: 'Milestone', minWidth: 110, flex: 1.5, tooltipField: 'milestone' },
  {
    field: 'amount',
    headerName: 'Amount',
    width: 105,
    type: 'rightAligned',
    cellClass: 'money',
    valueFormatter: (p) => (p.data ? formatMoney(p.value, p.data.currency) : ''),
    tooltipValueGetter: (p) => (p.data?.wasAmount ? `Was ${formatMoney(p.data.wasAmount, p.data.currency)} before you changed it` : undefined),
    // So "$800" and "800" both find it.
    getQuickFilterText: (p) => (p.data ? `${formatMoney(p.value, p.data.currency)} ${p.data.currency}` : ''),
  },
  {
    colId: 'status',
    headerName: 'Status',
    width: 128,
    // The label is the cell value, so the grid redraws when only daysOverdue changes (e.g. "2d" -> "10d overdue").
    valueGetter: (p) => (p.data && !isTotal(p) ? statusLabel(p.data).text : ''),
    enableCellChangeFlash: true,
    // On the totals row, the paid / owed / overdue breakdown spans Status through Nudges.
    colSpan: (p) => (isTotal(p) ? 4 : 1),
    cellRenderer: (p: ICellRendererParams<LedgerRow>) => {
      if (!p.data) return ''
      if (isTotal(p)) return totalBreakdown(p.data)
      const s = statusLabel(p.data)
      return `<span class="stamp stamp--${s.cls}">${s.text}</span>`
    },
    comparator: (_a, _b, na, nb) => (na.data?.daysOverdue ?? 0) - (nb.data?.daysOverdue ?? 0),
  },
  { field: 'invoiceNumber', headerName: 'Invoice', width: 84, valueFormatter: (p) => p.value ?? '' },
  {
    field: 'dueDate',
    headerName: 'Due',
    width: 100,
    enableCellChangeFlash: true,
    // "+6" marks extra days the client was given after the invoice went out.
    valueGetter: (p) => (p.data?.dueDate ? `${dayMonth(p.data.dueDate)}${p.data.extendedDays ? ` +${p.data.extendedDays}d` : ''}` : ''),
    tooltipValueGetter: (p) => (p.data?.extendedDays ? `${p.data.extendedDays} extra days given after it was sent` : undefined),
    comparator: (_a, _b, na, nb) => (na.data?.dueDate ?? '').localeCompare(nb.data?.dueDate ?? ''),
  },
  { field: 'reminders', headerName: 'Nudges', width: 84, type: 'rightAligned', valueFormatter: (p) => (p.value ? String(p.value) : '') },
  {
    colId: 'actions',
    headerName: '',
    // Room for the extra demo button. Status is loaded before this client-only grid mounts.
    width: demo.value ? 350 : 270,
    pinned: 'right',
    sortable: false,
    getQuickFilterText: () => '',
    cellRenderer: (p: ICellRendererParams<LedgerRow>) =>
      !p.data || isTotal(p)
        ? ''
        : actionsFor(p.data)
            .map(
              ([key, label]) =>
                `<button type="button" class="grid-action" data-action="${key}"${key === 'overdue' ? ' title="Demo mode: make this invoice more overdue"' : ''}>${label}</button>`,
            )
            .join(''),
  },
  // Not shown, but exported: what an accountant needs next to each amount.
  { field: 'currency', headerName: 'Currency', hide: true },
  { field: 'sentAt', headerName: 'Sent on', hide: true },
  { field: 'paidAt', headerName: 'Paid on', hide: true },
]

const EXPORT_COLUMNS = ['client', 'project', 'milestone', 'invoiceNumber', 'amount', 'currency', 'status', 'dueDate', 'sentAt', 'paidAt', 'reminders']

// --- Search, rows shown, totals and export ----------------------------------------------------

const search = ref('')
const api = shallowRef<GridApi<LedgerRow> | null>(null)
/** The rows the grid shows after the search and the current sort; the phone cards use the same list. */
const shown = shallowRef<ReceivableRow[] | null>(null)
const pinnedRows = shallowRef<LedgerRow[]>([])

const allRows = computed(() => data.value?.rows ?? [])
const visible = computed(() => shown.value ?? allRows.value)
const mobileTotals = computed(() => totalRows(visible.value))

function onGridReady(e: GridReadyEvent<LedgerRow>) {
  api.value = e.api
  readShown()
}

/** After every data, search or sort change: refresh the list and, only if they changed, the totals. */
function readShown() {
  if (!api.value) return
  const rows: ReceivableRow[] = []
  api.value.forEachNodeAfterFilterAndSort((node) => {
    if (node.data) rows.push(node.data)
  })
  shown.value = rows
  const next = totalRows(rows)
  if (JSON.stringify(next) !== JSON.stringify(pinnedRows.value)) pinnedRows.value = next
}

/**
 * Accountant-ready CSV of exactly the rows shown: plain amounts with a currency column,
 * ISO dates, no totals row. A cell that starts like a formula gets a leading apostrophe,
 * since client names come from client messages and a spreadsheet would otherwise run them.
 */
function processCell(p: ProcessCellForExportParams<LedgerRow>) {
  const r = p.node?.data
  const id = p.column.getColId()
  let out: string
  if (!r) out = String(p.value ?? '')
  else if (id === 'amount') out = r.amount.toFixed(2)
  else if (id === 'dueDate') out = r.dueDate ?? ''
  else if (id === 'sentAt') out = r.sentAt?.slice(0, 10) ?? ''
  else if (id === 'paidAt') out = r.paidAt?.slice(0, 10) ?? ''
  else if (id === 'reminders') out = String(r.reminders)
  else out = String(p.value ?? '')
  return /^[=+\-@\t\r]/.test(out) ? `'${out}` : out
}

function exportCsv() {
  api.value?.exportDataAsCsv({
    fileName: `paylane-receivables-${new Date().toISOString().slice(0, 10)}.csv`,
    columnKeys: EXPORT_COLUMNS,
    skipPinnedBottom: true,
    processCellCallback: processCell,
  })
}

const matching = computed(() => (search.value.trim() ? `${visible.value.length} of ${allRows.value.length} payments match` : ''))
// AG Grid's own empty states, reworded. Plain text, not HTML.
const overlayText = {
  noRows: { overlayText: 'Approved jobs show up here, one row per payment.' },
  noMatchingRows: { overlayText: 'Nothing in the ledger matches that search.' },
}

// --- Actions ----------------------------------------------------------------------------------

function runAction(action: string, r: ReceivableRow) {
  if (action === 'draft' || action === 'send') reviewInvoice(r.projectId, r.milestoneId)
  else if (action === 'done') reviewInvoice(r.projectId, r.milestoneId, true)
  else if (action === 'remind') reviewReminder(r.projectId, r.milestoneId)
  else if (action === 'cancel') cancelMilestone(r.projectId, r.milestoneId)
  else if (action === 'overdue') makeOverdue(r.projectId, r.milestoneId, r.daysOverdue)
  else if (action === 'change') openChange(r.projectId, r.milestoneId)
  else if (action === 'page' && r.clientPage) window.open(r.clientPage, '_blank', 'noopener')
}

function formatDueDate(iso: string | null) {
  return iso ? dayMonth(iso) : ''
}

const rowClassRules = {
  // Replaced invoices stay in the ledger for the record, quietly.
  'row--replaced': (p: RowClassParams<LedgerRow>) => Boolean(p.data?.splitInto),
  'row--total': (p: RowClassParams<LedgerRow>) => isTotal(p),
}

function onCellClicked(e: CellClickedEvent<LedgerRow>) {
  const action = (e.event?.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]')?.dataset.action
  const r = e.data
  if (!action || !r || isTotal(e)) return
  runAction(action, r)
}
</script>

<template>
  <div class="receivables">
    <header class="ledger-bar">
      <div class="ledger-bar__heading">
        <h2 id="ledger-heading" class="ledger-bar__title">Receivables</h2>
        <p v-if="matching" class="ledger-bar__count" aria-live="polite">{{ matching }}</p>
      </div>
      <div class="ledger-bar__tools">
        <label class="visually-hidden" for="ledger-search">Search the ledger</label>
        <input
          id="ledger-search"
          v-model="search"
          type="search"
          class="input ledger-bar__search"
          placeholder="Search client, job, invoice or status"
          autocomplete="off"
          @keydown.esc="search = ''"
        />
        <button
          type="button"
          class="btn btn--quiet btn--small"
          :disabled="!visible.length"
          :title="search.trim() ? 'Exports the rows your search shows' : 'Exports every row, with plain amounts and dates'"
          @click="exportCsv"
        >
          Export CSV
        </button>
      </div>
    </header>

    <AgGridVue
      class="grid receivables__desktop"
      :theme="theme"
      :row-data="allRows"
      :column-defs="columnDefs"
      :default-col-def="{ sortable: true, resizable: true, suppressMovable: true }"
      :get-row-id="(p: { data: LedgerRow }) => p.data.milestoneId"
      :dom-layout="'autoHeight'"
      :tooltip-show-mode="'whenTruncated'"
      :row-class-rules="rowClassRules"
      :quick-filter-text="search"
      :animate-rows="false"
      :pinned-bottom-row-data="pinnedRows"
      :cell-flash-duration="900"
      :cell-fade-duration="1200"
      :overlay-component-params="overlayText"
      @grid-ready="onGridReady"
      @model-updated="readShown"
      @cell-clicked="onCellClicked"
    />

    <!-- Responsive mobile card list (< 768px) where the 9-column grid would horizontally overflow -->
    <div class="receivables__mobile">
      <p v-if="!visible.length" class="receivables__empty">
        {{ search.trim() ? 'Nothing in the ledger matches that search.' : 'Approved jobs show up here, one row per payment.' }}
      </p>
      <ul v-else class="receivables__cards">
        <li v-for="r in visible" :key="r.milestoneId" class="rcard" :class="{ 'rcard--replaced': r.splitInto }">
          <div class="rcard__top">
            <div>
              <p class="rcard__milestone">{{ r.milestone }}</p>
              <p class="rcard__job">{{ r.client }}, {{ r.project }}</p>
            </div>
            <strong class="money rcard__amount">{{ formatMoney(r.amount, r.currency) }}</strong>
          </div>

          <div class="rcard__meta">
            <span class="stamp" :class="`stamp--${statusLabel(r).cls}`">{{ statusLabel(r).text }}</span>
            <span v-if="r.invoiceNumber" class="rcard__tag">#{{ r.invoiceNumber }}</span>
            <span v-if="r.dueDate" class="rcard__tag">Due {{ formatDueDate(r.dueDate) }}<template v-if="r.extendedDays"> (+{{ r.extendedDays }}d)</template></span>
            <span v-if="r.reminders" class="rcard__tag">{{ r.reminders }} nudge{{ r.reminders === 1 ? '' : 's' }}</span>
          </div>

          <div v-if="actionsFor(r).length" class="rcard__actions">
            <button
              v-for="[key, label] in actionsFor(r)"
              :key="key"
              type="button"
              class="grid-action"
              :data-action="key"
              @click="runAction(key, r)"
            >
              {{ label }}
            </button>
          </div>
        </li>
        <li v-for="t in mobileTotals" :key="t.milestoneId" class="rcard rcard--total">
          <div class="rcard__top">
            <p class="rcard__milestone">{{ t.client }}, {{ t.totals?.count }} {{ t.totals?.count === 1 ? 'payment' : 'payments' }}</p>
            <strong class="money rcard__amount">{{ formatMoney(t.amount, t.currency) }}</strong>
          </div>
          <p class="ledger-total__parts">
            <span v-if="t.totals?.paid" class="ledger-total__part ledger-total__part--paid">{{ formatMoney(t.totals.paid, t.currency) }} paid</span>
            <span v-if="t.totals?.owed" class="ledger-total__part ledger-total__part--owed">{{ formatMoney(t.totals.owed, t.currency) }} owed</span>
            <span v-if="t.totals?.overdue" class="ledger-total__part ledger-total__part--overdue">{{ formatMoney(t.totals.overdue, t.currency) }} overdue</span>
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>

<style>
.grid {
  width: 100%;
}
.grid .ag-cell {
  display: flex;
  align-items: center;
}
/* AG Grid keeps 150px free under auto-height rows for its empty message; one row is enough. */
.grid .ag-grid-scrolling-rows.ag-layout-auto-height {
  min-height: 52px;
}
.ledger-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-bottom: 0.9rem;
}
.ledger-bar__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.9rem;
}
.ledger-bar__title {
  font-size: var(--t-lg);
}
.ledger-bar__count {
  font-size: var(--t-xs);
  color: var(--ink-faint);
}
.ledger-bar__tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 1 26rem;
  min-width: 0;
}
.ledger-bar__search {
  flex: 1;
  min-width: 0;
  padding-top: 0.4rem;
  padding-bottom: 0.4rem;
}
/* The totals row: a double rule above it, like the total line on the plan receipt. */
.grid .ag-floating-bottom {
  border-top: 3px double var(--ink) !important;
}
.grid .row--total {
  background: var(--paper);
}
.grid .row--total .money {
  font-weight: 600;
}
.ledger-total__label {
  display: inline-flex;
  align-items: baseline;
  gap: 0.6rem;
}
.ledger-total__label span {
  color: var(--ink-faint);
  font-size: var(--t-xs);
}
.ledger-total__parts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0.9rem;
  font-size: var(--t-xs);
  line-height: 1.35;
  color: var(--ink-soft);
}
.ledger-total__part {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}
.ledger-total__part::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--carbon);
}
.ledger-total__part--paid::before {
  background: var(--paid);
}
.ledger-total__part--overdue::before {
  background: var(--overdue);
}
.grid-action {
  border: 1px solid var(--rule);
  background: var(--paper-pure);
  color: var(--ink);
  border-radius: 5px;
  padding: 0.2rem 0.6rem;
  margin-right: 0.35rem;
  font: 500 var(--t-xs) / 1.4 var(--font-ui);
  cursor: pointer;
}
.grid-action {
  transition:
    transform var(--dur-press) var(--ease-out),
    border-color var(--dur-press) var(--ease-out),
    color var(--dur-press) var(--ease-out);
}
.grid-action:active {
  transform: scale(0.97);
}
@media (hover: hover) and (pointer: fine) {
  .grid-action:hover {
    border-color: var(--carbon);
    color: var(--carbon);
  }
}
/* Demo-only control: dashed so it never reads as a real money action. */
.grid-action[data-action='overdue'] {
  border-style: dashed;
  color: var(--ink-soft);
}
.grid-action[data-action='cancel'] {
  color: var(--ink-faint);
}
.grid .row--replaced .ag-cell:not([col-id='actions']),
.rcard--replaced {
  opacity: 0.55;
}
.receivables__mobile {
  display: none;
}
.receivables__empty {
  padding: 1.5rem;
  background: var(--paper-pure);
  border: 1px solid var(--rule-soft);
  border-radius: var(--radius-sheet);
  color: var(--ink-soft);
}
.receivables__cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.rcard {
  background: var(--paper-pure);
  border: 1px solid var(--rule-soft);
  border-radius: var(--radius-sheet);
  padding: 1rem;
  display: grid;
  gap: 0.65rem;
}
.rcard--total {
  background: var(--paper);
  border-top: 3px double var(--ink);
}
.rcard__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}
.rcard__milestone {
  font-weight: 600;
  color: var(--ink);
}
.rcard__job {
  font-size: var(--t-xs);
  color: var(--ink-soft);
  margin-top: 0.1rem;
}
.rcard__amount {
  font-size: var(--t-md);
  white-space: nowrap;
}
.rcard__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--t-xs);
  color: var(--ink-soft);
}
.rcard__tag {
  padding: 0.1rem 0.45rem;
  background: var(--paper);
  border-radius: 4px;
}
.rcard__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding-top: 0.4rem;
  border-top: 1px dashed var(--rule-soft);
}
.rcard__actions .grid-action {
  margin-right: 0;
  padding: 0.35rem 0.75rem;
}
@media (max-width: 767px) {
  .receivables__desktop {
    display: none;
  }
  .receivables__mobile {
    display: block;
  }
  .ledger-bar__tools {
    flex-basis: 100%;
  }
}
</style>
