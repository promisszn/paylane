/**
 * Subscribe to a server-sent event stream (see server/utils/live.ts) while the component lives.
 * `onChange` is debounced, since one action usually writes several things at once.
 * EventSource reconnects on its own after a drop (a deploy, a sleeping host, a laptop lid).
 */
export function useLive(
  url: MaybeRefOrGetter<string>,
  handlers: { onChange: () => void; onProgress?: (text: string, projectId?: string) => void },
) {
  const connected = ref(false)
  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function open() {
    close()
    source = new EventSource(toValue(url))
    source.onopen = () => {
      connected.value = true
    }
    source.onerror = () => {
      connected.value = false
    }
    source.addEventListener('change', () => {
      clearTimeout(timer)
      timer = setTimeout(handlers.onChange, 120)
    })
    source.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { text?: string; projectId?: string }
        if (data.text) handlers.onProgress?.(data.text, data.projectId)
      } catch {
        // A malformed event is not worth breaking the page over.
      }
    })
  }

  function close() {
    source?.close()
    source = null
    connected.value = false
  }

  onMounted(open)
  onBeforeUnmount(() => {
    clearTimeout(timer)
    close()
  })
  return { connected }
}
