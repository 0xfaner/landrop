import { api } from './http'

export type ConnectionPhase = 'connecting' | 'live' | 'fallback'

export interface ResourceChanges {
  clipboard?: boolean
  devices?: boolean
  allFiles?: boolean
  folders?: string[]
}

type Update =
  | { type: 'change'; changes: ResourceChanges }
  | { type: 'connected' }
  | { type: 'disconnected' }

const subscribers = new Set<(update: Update) => void>()
let connected = false

export function isEventStreamConnected() {
  return connected
}

export function subscribeToUpdates(listener: (update: Update) => void) {
  subscribers.add(listener)
  return () => { subscribers.delete(listener) }
}

function publish(update: Update) {
  for (const listener of subscribers) listener(update)
}

export function connectEventStream(onPhaseChange: (phase: ConnectionPhase) => void, onRevoked: () => void) {
  let phase: ConnectionPhase = 'connecting'
  let source: EventSource | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  function transition(next: ConnectionPhase) {
    if (phase === next) return
    phase = next
    connected = next === 'live'
    onPhaseChange(next)
    publish({ type: connected ? 'connected' : 'disconnected' })
  }

  const fallback = setTimeout(() => transition('fallback'), 2000)

  function stop() {
    clearTimeout(fallback)
    clearTimeout(retry)
    source?.close()
    connected = false
  }

  function connect() {
    const stream = new EventSource(api + '/events')
    source = stream
    stream.onopen = () => {
      clearTimeout(fallback)
      transition('live')
    }
    stream.onmessage = (event: MessageEvent<string>) => {
      const changes: ResourceChanges = JSON.parse(event.data)
      publish({ type: 'change', changes })
    }
    stream.addEventListener('revoked', () => {
      stop()
      onRevoked()
    })
    stream.onerror = () => {
      clearTimeout(fallback)
      transition('fallback')
      // EventSource retries transient errors. A closed stream needs a new instance.
      if (stream.readyState === EventSource.CLOSED) retry = setTimeout(connect, 2000)
    }
  }

  if (typeof EventSource === 'undefined') {
    clearTimeout(fallback)
    transition('fallback')
  } else {
    connect()
  }

  return stop
}
