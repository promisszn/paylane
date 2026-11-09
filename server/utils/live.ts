/**
 * Live updates. Every store write publishes an event here; /api/events (dashboard) and
 * /api/portal/<token>/events (client page) stream them to the browser as server-sent events,
 * and the page re-fetches what changed.
 *
 * Paylane runs as one process, so an in-memory bus is enough. Several instances would
 * need Redis pub/sub instead.
 */
import { createEventStream, type H3Event } from 'h3'

export interface LiveEvent {
  /** change: data changed, re-fetch. progress: what the agent is doing right now. */
  type: 'change' | 'progress'
  projectId?: string
  /** For progress, e.g. "Creating installment 1 of 2 on PayPal". */
  text?: string
}

type Listener = (e: LiveEvent) => void
const listeners = new Set<Listener>()

export function publish(e: LiveEvent) {
  for (const fn of listeners) {
    try {
      fn(e)
    } catch {
      // One broken connection must not stop the others.
    }
  }
}

/** Tell the client page (and the dashboard) what the agent is doing, while it does it. */
export function progress(projectId: string, text: string) {
  publish({ type: 'progress', projectId, text })
}

export function subscribe(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Stream live events to the browser. `accept` filters what this connection may see. */
export function streamLive(event: H3Event, accept: (e: LiveEvent) => boolean = () => true) {
  const stream = createEventStream(event)
  const off = subscribe((e) => {
    if (accept(e)) void stream.push({ event: e.type, data: JSON.stringify(e) })
  })
  // Hosts close connections that stay silent; a small ping every 20s keeps this one open.
  const ping = setInterval(() => void stream.push({ event: 'ping', data: String(Date.now()) }), 20_000)
  stream.onClosed(() => {
    off()
    clearInterval(ping)
  })
  // Write something straight away: proxies (Nuxt's dev server included) hold the response
  // headers back until the first bytes, and the browser only counts the stream as open then.
  void stream.push({ event: 'ready', data: String(Date.now()) })
  return stream.send()
}
