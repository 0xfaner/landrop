import { useTranslation } from '../i18n'
import { useState } from 'react'
import { Button, Heading } from '@primer/react'
import { errorMessage } from '../api/http'
import type { ResourceChanges } from '../api/events'
import { useLiveResource } from '../api/useLiveResource'
import { decideDevice, listDevices, type DeviceAction } from './api'
import styles from './session.module.css'
import ui from '../components/surfaces.module.css'

const deviceList = {
  load: listDevices,
  matches: (changes: ResourceChanges) => !!changes.devices,
  pollWhileConnected: 30000, // Pending requests expire without a server event.
}

export function Devices() {
  const t = useTranslation()
  const { data: devices = [], setData: setDevices, error: devicesError } = useLiveResource(deviceList)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  async function decide(code: string, action: DeviceAction) {
    setBusy(true)
    setActionError('')
    try {
      await decideDevice(code, action)
      setDevices((previous = []) => action === 'approve'
        ? previous.map((device) => device.code === code ? { ...device, status: 'approved' } : device)
        : previous.filter((device) => device.code !== code))
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const pending = devices.filter((device) => device.status === 'pending')
  const connected = devices.filter((device) => device.status === 'approved')

  return <div className={styles.devices} data-pending={pending.length > 0 || undefined}>
    <div className={styles.devicesHeading}>
      <Heading as="h3">{t('Devices')}</Heading>
      <span className={pending.length ? ui.notice : ui.muted} role="status">
        {pending.length ? t('{count} awaiting approval', { count: pending.length }) : t('{count} connected', { count: connected.length })}
      </span>
    </div>
    {pending.length > 0 && <p className={ui.muted}>{t('Match the code on the guest device before allowing access.')}</p>}
    {devices.length > 0 && <ul className={styles.deviceList}>
      {[...pending, ...connected].map((device) => <li key={device.code}>
        <div className={styles.deviceDetails}>
          <span className={ui.truncate} dir="auto" title={device.name}>{device.name}</span>
          <small>{device.address} · {t(device.status === 'pending' ? 'Pending approval' : 'Connected')}</small>
        </div>
        <div className={ui.actions}>
          {device.status === 'pending' ? <>
            <code className={styles.deviceCode} aria-label={t('Confirmation code')}>{device.code}</code>
            <Button aria-label={t('Decline {name}', { name: device.name })} size="small" variant="invisible" disabled={busy} onClick={() => decide(device.code, 'reject')}>{t('Decline')}</Button>
            <Button aria-label={t('Allow {name}', { name: device.name })} size="small" disabled={busy} onClick={() => decide(device.code, 'approve')}>{t('Allow')}</Button>
          </> : <Button aria-label={t('Remove {name}', { name: device.name })} size="small" variant="invisible" disabled={busy} onClick={() => decide(device.code, 'remove')}>{t('Remove')}</Button>}
        </div>
      </li>)}
    </ul>}
    {(actionError || devicesError) && <p className={ui.error} role="alert">{t(actionError || devicesError)}</p>}
  </div>
}
