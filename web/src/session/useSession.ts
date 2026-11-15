import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../api/http'
import { readSession, signInHost, type Session } from './api'
import { connectEventStream, type ConnectionPhase } from '../api/events'

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)
  const authorized = session?.authorized === true
  const revoke = useCallback(() => {
    setSession((previous) => previous && { ...previous, authorized: false })
  }, [])
  const [phase, setPhase] = useState<ConnectionPhase>('connecting')

  useEffect(() => {
    setPhase('connecting')
    if (authorized) return connectEventStream(setPhase, revoke)
  }, [authorized, revoke])

  const loadSession = useCallback(async (signal: AbortSignal) => {
    const value = await readSession(signal)
    if (!signal.aborted) {
      setSession(value)
      setOffline(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let retry: ReturnType<typeof setTimeout> | undefined
    async function check() {
      try {
        await loadSession(signal)
      } catch {
        if (!signal.aborted) {
          setOffline(true)
          retry = setTimeout(check, 2000)
        }
      }
    }
    async function start() {
      const token = new URLSearchParams(location.hash.slice(1)).get('host')
      if (token) {
        history.replaceState(null, '', location.pathname + location.search)
        try {
          const session = await signInHost(token, signal)
          if (!signal.aborted) setSession(session)
          return
        } catch (error) {
          if (!signal.aborted) setError(errorMessage(error))
        }
      }
      if (!signal.aborted) await check()
    }
    start()
    return () => {
      controller.abort()
      clearTimeout(retry)
    }
  }, [loadSession])

  useEffect(() => {
    if (!authorized || phase !== 'fallback') return
    const controller = new AbortController()
    const { signal } = controller
    async function check() {
      try {
        await loadSession(signal)
      } catch {
        if (!signal.aborted) setOffline(true)
      }
      if (!signal.aborted) timer = setTimeout(check, 2000)
    }
    let timer = setTimeout(check, 2000)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [authorized, phase, loadSession])

  return { session, setSession, authorized, phase, error, offline }
}
