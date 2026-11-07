<script setup lang="ts">
/**
 * Every billable milestone across every job, in AG Grid.
 * Actions live in the last column and route through the same review dialogs
 * as the suggestions, so the human checkpoint is identical everywhere.
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
})

function statusLabel(r: ReceivableRow) {
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
        ? [['remind', 'Remind'], ['pay', 'Pay link'], ['overdue', 'Backdate']]
        : [['remind', 'Remind'], ['pay', 'Pay link']]
    default:
      return []
  }
}

const columnDefs: ColDef<ReceivableRow>[] = [
  // Client names are short, job names are the longest text, so Job gets the most room.
  // Fixed columns are sized to their content so the whole grid fits 1160px even in demo mode.
  { field: 'client', headerName: 'Client', minWidth: 80, flex: 0.8, tooltipField: 'client' },
  { field: 'project', headerName: 'Job', minWidth: 170, flex: 1.6, tooltipField: 'project' },
  { field: 'milestone', headerName: 'Milestone', minWidth: 128, flex: 1.2, tooltipField: 'milestone' },
  {
    field: 'amount',
    headerName: 'Amount',
    width: 115,
    type: 'rightAligned',
    cellClass: 'money',
    valueFormatter: (p) => (p.data ? formatMoney(p.value, p.data.currency) : ''),
  },
  {
    colId: 'status',
    headerName: 'Status',
    width: 140,
    // The label is the cell value, so the grid redraws when only daysOverdue changes (e.g. "2d" -> "10d overdue").
    valueGetter: (p) => (p.data ? statusLabel(p.data).text : ''),
    cellRenderer: (p: { data: ReceivableRow }) => {
      const s = statusLabel(p.data)
      return `<span class="stamp stamp--${s.cls}">${s.text}</span>`
    },
    comparator: (_a, _b, na, nb) => (na.data?.daysOverdue ?? 0) - (nb.data?.daysOverdue ?? 0),
  },
  { field: 'invoiceNumber', headerName: 'Invoice', width: 85, valueFormatter: (p) => p.value ?? '' },
  {
    field: 'dueDate',
    headerName: 'Due',
    width: 85,
    valueFormatter: (p) => (p.value ? new Date(`${p.value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''),
  },
  { field: 'reminders', headerName: 'Nudges', width: 85, type: 'rightAligned', valueFormatter: (p) => (p.value ? String(p.value) : '') },
  {
    colId: 'actions',
    headerName: '',
    // Room for the extra demo button. Status is loaded before this client-only grid mounts.
    width: demo.value ? 268 : 180,
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

function onCellClicked(e: CellClickedEvent<ReceivableRow>) {
  const action = (e.event?.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]')?.dataset.action
  const r = e.data
  if (!action || !r) return
  if (action === 'draft' || action === 'send') reviewInvoice(r.projectId, r.milestoneId)
  else if (action === 'done') reviewInvoice(r.projectId, r.milestoneId, true)
  else if (action === 'remind') reviewReminder(r.projectId, r.milestoneId)
  else if (action === 'cancel') cancelMilestone(r.projectId, r.milestoneId)
  else if (action === 'overdue') makeOverdue(r.projectId, r.milestoneId, r.daysOverdue)
  else if (action === 'pay' && r.payerUrl) window.open(r.payerUrl, '_blank', 'noopener')
}
</script>

<template>
  <AgGridVue
    class="grid"
    :theme="theme"
    :row-data="data?.rows ?? []"
    :column-defs="columnDefs"
    :default-col-def="{ sortable: true, resizable: true, suppressMovable: true }"
    :get-row-id="(p: { data: ReceivableRow }) => p.data.milestoneId"
    :dom-layout="'autoHeight'"
    :tooltip-show-mode="'whenTruncated'"
    :overlay-no-rows-template="'<span>Approved jobs show up here, one row per payment.</span>'"
    @cell-clicked="onCellClicked"
  />
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
</style>
