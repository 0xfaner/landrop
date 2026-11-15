import { useEffect, useState } from 'react'
import { isEventStreamConnected, subscribeToUpdates, type ResourceChanges } from './events'
import { errorMessage, RequestError } from './http'

interface LiveResource<T> {
  load: (signal: AbortSignal) => Promise<T>
  matches: (changes: ResourceChanges) => boolean
  pollWhileConnected?: number
  debounce?: { delay: number; maxWait: number }
}

export function useLiveResource<T>(resource: LiveResource<T>) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')

  useEffect(() => {
    const { load, matches, pollWhileConnected, debounce } = resource
    const controller = new AbortController()
    const { signal } = controller
    let running = false
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    let firstChange: number | undefined

    function schedule(retry = false) {
      clearTimeout(timer)
      if (signal.aborted) return
      const delay = retry || !isEventStreamConnected() ? 2000 : pollWhileConnected
      if (delay !== undefined) timer = setTimeout(refresh, delay)
    }

    async function refresh() {
      if (signal.aborted) return
      clearTimeout(eventTimer)
      firstChange = undefined
      if (running) {
        pending = true
        return
      }
      clearTimeout(timer)
      running = true
      let retry = false
      try {
        const value = await load(signal)
        if (!signal.aborted) {
          setData(value)
          setError('')
        }
      } catch (error) {
        if (!signal.aborted) {
          setError(errorMessage(error))
          retry = !(error instanceof RequestError) || error.status >= 500
        }
      } finally {
        running = false
        if (pending) {
          pending = false
          refresh()
        } else {
          schedule(retry)
        }
      }
    }

    const unsubscribe = subscribeToUpdates((update) => {
      if (update.type === 'disconnected') {
        schedule()
      } else if (update.type === 'connected') {
        refresh()
      } else if (matches(update.changes)) {
        if (!debounce) {
          refresh()
          return
        }
        const now = performance.now()
        firstChange ??= now
        clearTimeout(eventTimer)
        const delay = Math.min(debounce.delay, Math.max(0, debounce.maxWait - (now - firstChange)))
        eventTimer = setTimeout(refresh, delay)
      }
    })

    refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
      clearTimeout(eventTimer)
      unsubscribe()
    }
  }, [resource])

  return { data, setData, error }
}
