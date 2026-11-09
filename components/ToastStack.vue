<script setup lang="ts">
/**
 * Sonner-style toast stack (after Emil Kowalski's Sonner):
 * - newest in front, older ones tucked behind and scaled down
 * - hover or focus fans the stack out so everything is readable
 * - swipe up (or press the toast) to dismiss
 */
const { toasts, dismiss } = useDashboard()
const expanded = ref(false)

/** Fan the stack out and stop the clocks while you're reading it. */
function hold(on: boolean) {
  expanded.value = on
  if (on) pauseToasts('hover')
  else resumeToasts('hover')
}

const GAP = 10
const PEEK = 12

// Swipe-to-dismiss state for the toast being dragged.
const drag = reactive({ id: 0, startY: 0, dy: 0 })

function onDown(e: PointerEvent, id: number) {
  drag.id = id
  drag.startY = e.clientY
  drag.dy = 0
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!drag.id) return
  // Only allow upward drags (toward the edge); resist downward ones.
  const dy = e.clientY - drag.startY
  drag.dy = dy < 0 ? dy : dy * 0.15
}
function onUp() {
  if (!drag.id) return
  const id = drag.id
  if (drag.dy < -45) dismiss(id)
  drag.id = 0
  drag.dy = 0
}

function style(index: number, id: number) {
  const dragging = drag.id === id
  const y = expanded.value ? index * (56 + GAP) : index * PEEK
  const scale = expanded.value ? 1 : 1 - index * 0.05
  return {
    zIndex: String(100 - index),
    transform: `translate3d(0, ${y + (dragging ? drag.dy : 0)}px, 0) scale(${scale})`,
    opacity: index > 2 ? '0' : dragging ? String(Math.max(0.4, 1 + drag.dy / 160)) : '1',
    transition: dragging ? 'none' : undefined,
  }
}
</script>

<template>
  <section
    class="toasts"
    aria-live="polite"
    aria-label="Notifications"
    @mouseenter="hold(true)"
    @mouseleave="hold(false)"
    @focusin="hold(true)"
    @focusout="hold(false)"
  >
    <TransitionGroup name="toast">
      <button
        v-for="(t, i) in toasts"
        :key="t.id"
        type="button"
        class="toast"
        :data-tone="t.tone"
        :style="style(i, t.id)"
        :aria-label="`${t.text}. Press to dismiss.`"
        @pointerdown="onDown($event, t.id)"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @keydown.enter.prevent="dismiss(t.id)"
      >
        <span class="toast__dot" aria-hidden="true" />
        <span class="toast__text">{{ t.text }}</span>
      </button>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  top: 1.5rem;
  width: min(420px, calc(100vw - 32px));
  transform: translateX(-50%);
  z-index: 30;
  /* Gives hover a target while the stack is collapsed. */
  min-height: 1px;
}
.toast {
  position: absolute;
  inset: 0 0 auto 0;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  width: 100%;
  min-height: 56px;
  padding: 0.85rem 1rem;
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--paper-pure);
  color: var(--ink);
  text-align: left;
  font: var(--t-sm) / 1.4 var(--font-ui);
  box-shadow: 0 10px 30px -12px rgb(22 35 63 / 0.35);
  transform-origin: top center;
  touch-action: none;
  cursor: grab;
  user-select: none;
  transition:
    transform 320ms var(--ease-out),
    opacity 320ms var(--ease-out);
}
.toast:active {
  cursor: grabbing;
}
.toast__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 0.45rem;
  border-radius: 50%;
  background: var(--paid);
}
.toast[data-tone='error'] .toast__dot {
  background: var(--overdue);
}
.toast[data-tone='error'] {
  border-color: var(--overdue-soft);
}
/* Something the agent did on its own, or a client asked for: carbon blue, like the agent's label. */
.toast[data-tone='agent'] .toast__dot {
  background: var(--carbon);
}
.toast[data-tone='agent'] {
  border-color: var(--carbon-soft);
}

/* Enter from above, exit by fading up. Exit is faster than enter. */
.toast-enter-from {
  opacity: 0;
  transform: translate3d(0, -24px, 0) scale(0.96) !important;
}
.toast-leave-active {
  transition:
    transform var(--dur-exit) var(--ease-out),
    opacity var(--dur-exit) var(--ease-out) !important;
}
.toast-leave-to {
  opacity: 0;
  transform: translate3d(0, -16px, 0) scale(0.96) !important;
}

@media (prefers-reduced-motion: reduce) {
  .toast {
    transition: opacity 200ms linear;
  }
  .toast-enter-from,
  .toast-leave-to {
    transform: none !important;
  }
}
</style>
