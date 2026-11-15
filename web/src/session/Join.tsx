import { useTranslation } from '../i18n'
import { useEffect, useState, type SubmitEvent } from 'react'
import { Button, Heading, TextInput } from '@primer/react'
import { errorMessage } from '../api/http'
import { pairStatus, requestPair, type PairRequest, type Session } from './api'

import styles from './session.module.css'
import ui from '../components/surfaces.module.css'

const deviceNameKey = 'landrop.deviceName'
const pendingKey = 'landrop.pending'

function rememberPending(request: PairRequest | null) {
  try {
    if (request) sessionStorage.setItem(pendingKey, JSON.stringify(request))
    else sessionStorage.removeItem(pendingKey)
  } catch {
    // The current page can continue pairing without session storage.
  }
}

export function Join({ onJoin }: { onJoin: (session: Session) => void }) {
  const t = useTranslation()
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(deviceNameKey) ?? '' } catch { return '' }
  })
  const [pending, setPending] = useState<PairRequest | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null')
      return typeof saved?.code === 'string' && typeof saved?.token === 'string' ? saved : null
    } catch { return null }
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pending) return
    const { token } = pending
    const controller = new AbortController()
    const { signal } = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    async function check() {
      try {
        const result = await pairStatus(token, signal)
        if (signal.aborted) return
        if (result.status !== 'pending') {
          rememberPending(null)
          setPending(null)
          if (result.status === 'approved') onJoin(result.session)
          else if (result.status === 'rejected') setError('The host declined your request.')
          else setError('Your request expired. You can try again.')
          return
        }
        setError('')
      } catch {
        if (!signal.aborted) setError('Could not reach the host. Retrying…')
      }
      if (!signal.aborted) timer = setTimeout(check, 1000)
    }
    check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [onJoin, pending])

  async function join(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const deviceName = name.trim()
    try {
      const data = await requestPair(deviceName || t('Browser device'))
      try {
        if (deviceName) localStorage.setItem(deviceNameKey, deviceName)
        else localStorage.removeItem(deviceNameKey)
      } catch {
        // Pairing still works when the browser blocks persistent storage.
      }
      rememberPending(data)
      setPending(data)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${ui.panel} ${styles.join}`}>
      {pending ? <>
        <Heading as="h2">{t('Waiting for approval')}</Heading>
        <output className={styles.code} aria-label={t('Confirmation code')}>{pending.code}</output>
        <p className={ui.muted}>{t('Match this code on the host device.')}</p>
      </> : <>
        <Heading as="h2">{t('Join LanDrop')}</Heading>
        <p className={ui.muted}>{t('Connect to share files and clipboard entries.')}</p>
        <form onSubmit={join}>
          <label htmlFor="device-name">{t('Device name')}</label>
          <TextInput block id="device-name" maxLength={40} placeholder={t('Browser device')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="small" disabled={busy}>{t(busy ? 'Sending…' : 'Request access')}</Button>
        </form>
      </>}
      {error && <p className={ui.error} role="alert">{t(error)}</p>}
    </section>
  )
}
