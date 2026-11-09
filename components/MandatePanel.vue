<script setup lang="ts">
/**
 * The mandate lives in a panel, not on the page: you set it once and come back rarely.
 * It slides in from the right edge and leaves the same way. Opened from the top bar,
 * from the "sign a mandate" suggestion, or from a clause tag in the activity log.
 */
const { mandateOpen } = useDashboard()
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  mandateOpen,
  (open) => {
    if (open && !dialog.value?.open) dialog.value?.showModal()
    if (!open) dialog.value?.close()
  },
  { flush: 'post' },
)

/** The panel fills the dialog, so a click that lands on the dialog itself is on the backdrop. */
function onClick(e: MouseEvent) {
  if (e.target === dialog.value) mandateOpen.value = false
}
</script>

<template>
  <dialog ref="dialog" class="panel" aria-labelledby="mandate-heading" @close="mandateOpen = false" @click="onClick">
    <div class="panel__inner">
      <button type="button" class="panel__close" aria-label="Close" @click="mandateOpen = false">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
      <MandateSlip />
    </div>
  </dialog>
</template>

<style scoped>
.panel {
  /* A sheet on the right edge, full height. */
  margin: 0 0 0 auto;
  width: min(460px, 100vw);
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  border: 0;
  padding: 0;
  background: var(--paper-pure);
  color: var(--ink);
  box-shadow: var(--shadow-dialog);
  overflow-y: auto;
  overscroll-behavior: contain;
  /* In and out along the same path: from the right edge, back to it. */
  transform: translateX(100%);
  transition:
    transform var(--dur-exit) var(--ease-out),
    overlay var(--dur-exit) allow-discrete,
    display var(--dur-exit) allow-discrete;
}
.panel[open] {
  transform: translateX(0);
  transition:
    transform 320ms var(--ease-out),
    overlay 320ms allow-discrete,
    display 320ms allow-discrete;
}
@starting-style {
  .panel[open] {
    transform: translateX(100%);
  }
}
.panel::backdrop {
  background: rgb(0 0 0 / 0);
  transition:
    background-color var(--dur-enter) var(--ease-out),
    overlay var(--dur-enter) allow-discrete,
    display var(--dur-enter) allow-discrete;
}
.panel[open]::backdrop {
  background: rgb(0 0 0 / 0.24);
}
@starting-style {
  .panel[open]::backdrop {
    background: rgb(0 0 0 / 0);
  }
}
/* Reduced motion: a cross-fade instead of a slide. */
@media (prefers-reduced-motion: reduce) {
  .panel,
  .panel[open] {
    transform: none;
    opacity: 0;
    transition:
      opacity 200ms linear,
      overlay 200ms allow-discrete,
      display 200ms allow-discrete;
  }
  .panel[open] {
    opacity: 1;
  }
  @starting-style {
    .panel[open] {
      transform: none;
      opacity: 0;
    }
  }
}
.panel__inner {
  position: relative;
  padding: 1.5rem 1.5rem 2rem;
}
.panel__close {
  position: absolute;
  top: 1.1rem;
  right: 1.1rem;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 50%;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
  transition:
    transform var(--dur-press) var(--ease-out),
    background-color var(--dur-press) var(--ease-out);
}
.panel__close:active {
  transform: scale(0.94);
}
@media (hover: hover) and (pointer: fine) {
  .panel__close:hover {
    background: var(--rule-soft);
    color: var(--ink);
  }
}
</style>
