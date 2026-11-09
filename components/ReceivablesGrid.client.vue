<script setup lang="ts">
/**
 * Every billable milestone across every job, in AG Grid.
 * Actions live in the last column and route through the same review dialogs
 * as the suggestions, so the human checkpoint is identical everywhere.
 * Rows update live (server-sent events); cells the agent or PayPal change flash briefly.
 */
import { AgGridVue } from 'ag-grid-vue3'
import { AllCommunityModule, ModuleRegistry, themeQuartz, type CellClickedEvent, type ColDef } from 'ag-grid-community'
import type { ReceivableRow } from '~/types'

ModuleRegistry.registerModules([AllCommunityModule])

const { data, status, reviewInvoice, reviewReminder, cancelMilestone, makeOverdue } = useDashboard()
const demo = computed(() => Boolean(status.value?.demoMode))

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
      return r.trigger === 'upfront' ? [['draft', 'Draft']] : [['done', 'Mark done']]
    case 'draft':
      return [['send', 'Send'], ['cancel', 'Cancel']]
    case 'sent':
      return demo.value
        ? [['remind', 'Remind'], ['page', 'Client page'], ['overdue', 'Backdate']]
        : [['remind', 'Remind'], ['page', 'Client page']]
    case 'paid':
      return r.clientPage ? [['page', 'Client page']] : []
    default:
      return []
  }
}

const columnDefs: ColDef<ReceivableRow>[] = [
  // Client names are short, job names are the longest text, so Job gets the most room.
  // Fixed columns are sized to their content so the whole grid fits 1160px even in demo mode
  // (flex minimums 70 + 140 + 140 plus fixed widths 761 = 1111).
  { field: 'client', headerName: 'Client', minWidth: 70, flex: 0.7, tooltipField: 'client' },
  { field: 'project', headerName: 'Job', minWidth: 140, flex: 1.4, tooltipField: 'project' },
  { field: 'milestone', headerName: 'Milestone', minWidth: 140, flex: 1.5, tooltipField: 'milestone' },
  {
    field: 'amount',
    headerName: 'Amount',
    width: 105,
    type: 'rightAligned',
    cellClass: 'money',
    valueFormatter: (p) => (p.data ? formatMoney(p.value, p.data.currency) : ''),
  },
  {
    colId: 'status',
    headerName: 'Status',
    width: 128,
    // The label is the cell value, so the grid redraws when only daysOverdue changes (e.g. "2d" -> "10d overdue").
    valueGetter: (p) => (p.data ? statusLabel(p.data).text : ''),
    enableCellChangeFlash: true,
    cellRenderer: (p: { data: ReceivableRow }) => {
      const s = statusLabel(p.data)
      return `<span class="stamp stamp--${s.cls}">${s.text}</span>`
    },
    comparator: (_a, _b, na, nb) => (na.data?.daysOverdue ?? 0) - (nb.data?.daysOverdue ?? 0),
  },
  { field: 'invoiceNumber', headerName: 'Invoice', width: 72, valueFormatter: (p) => p.value ?? '' },
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
  { field: 'reminders', headerName: 'Nudges', width: 76, type: 'rightAligned', valueFormatter: (p) => (p.value ? String(p.value) : '') },
  {
    colId: 'actions',
    headerName: '',
    // Room for the extra demo button. Status is loaded before this client-only grid mounts.
    width: demo.value ? 280 : 200,
    pinned: 'right',
    sortable: false,
    cellRenderer: (p: { data: ReceivableRow }) =>
      actionsFor(p.data)
        .map(
          ([key, label]) =>
            `<button type="button" class="grid-action" data-action="${key}"${key === 'overdue' ? ' title="Demo mode: make this invoice more overdue"' : ''}>${label}</button>`,
        )
        .join(''),
  },
]

function runAction(action: string, r: ReceivableRow) {
  if (action === 'draft' || action === 'send') reviewInvoice(r.projectId, r.milestoneId)
  else if (action === 'done') reviewInvoice(r.projectId, r.milestoneId, true)
  else if (action === 'remind') reviewReminder(r.projectId, r.milestoneId)
  else if (action === 'cancel') cancelMilestone(r.projectId, r.milestoneId)
  else if (action === 'overdue') makeOverdue(r.projectId, r.milestoneId, r.daysOverdue)
  else if (action === 'page' && r.clientPage) window.open(r.clientPage, '_blank', 'noopener')
}

function formatDueDate(iso: string | null) {
  return iso ? dayMonth(iso) : ''
}

// Replaced invoices stay in the ledger for the record, quietly.
const rowClassRules = { 'row--replaced': (p: { data?: ReceivableRow }) => Boolean(p.data?.splitInto) }

function onCellClicked(e: CellClickedEvent<ReceivableRow>) {
  const action = (e.event?.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]')?.dataset.action
  const r = e.data
  if (!action || !r) return
  runAction(action, r)
}
</script>

<template>
  <div class="receivables">
    <AgGridVue
      class="grid receivables__desktop"
      :theme="theme"
      :row-data="data?.rows ?? []"
      :column-defs="columnDefs"
      :default-col-def="{ sortable: true, resizable: true, suppressMovable: true }"
      :get-row-id="(p: { data: ReceivableRow }) => p.data.milestoneId"
      :dom-layout="'autoHeight'"
      :tooltip-show-mode="'whenTruncated'"
      :row-class-rules="rowClassRules"
      :cell-flash-duration="900"
      :cell-fade-duration="1200"
      :overlay-no-rows-template="'<span>Approved jobs show up here, one row per payment.</span>'"
      @cell-clicked="onCellClicked"
    />

    <!-- Responsive mobile card list (< 768px) where the 9-column grid would horizontally overflow -->
    <div class="receivables__mobile">
      <p v-if="!(data?.rows.length)" class="receivables__empty">
        Approved jobs show up here, one row per payment.
      </p>
      <ul v-else class="receivables__cards">
        <li v-for="r in data?.rows" :key="r.milestoneId" class="rcard" :class="{ 'rcard--replaced': r.splitInto }">
          <div class="rcard__top">
            <div>
              <p class="rcard__milestone">{{ r.milestone }}</p>
              <p class="rcard__job">{{ r.client }} · {{ r.project }}</p>
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
}
</style>
