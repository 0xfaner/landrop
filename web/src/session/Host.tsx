import { useTranslation } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { ActionList, ActionMenu, Heading } from '@primer/react'
import { CheckIcon, ChevronDownIcon, CopyIcon } from '@primer/octicons-react'
import { errorMessage } from '../api/http'
import { IconButton } from '../components/IconButton'
import { qrURL, readAddresses } from './api'
import { Devices } from './Devices'
import styles from './session.module.css'
import ui from '../components/surfaces.module.css'
import menuStyles from '../components/menu.module.css'

export function Host() {
  const t = useTranslation()
  const [addresses, setAddresses] = useState<string[]>([])
  const [addressIndex, setAddressIndex] = useState(0)
  const addressInput = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const [addressError, setAddressError] = useState('')


  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    readAddresses(signal).then(setAddresses).catch((error) => {
      if (!signal.aborted) setAddressError(errorMessage(error))
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const address = addresses[addressIndex]
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address)
    } catch {
      addressInput.current?.focus()
      addressInput.current?.select()
      let result = false
      try { result = document.execCommand('copy') } catch {}
      if (!result) return
    }
    setCopied(true)
  }

  return <section className={`${ui.panel} ${styles.connect}`} aria-labelledby="connect-title">
    <div className={styles.connectGrid}>
      <div className={styles.connectInfo}>
        <Heading as="h2" id="connect-title">{t('Connect a device')}</Heading>
        <p className={ui.muted}>{t('Scan the QR code or open the address on your other device.')}</p>
      </div>
      {address && <>
        <img className={styles.qr} src={qrURL(addressIndex)} alt={t('Guest access QR code')} width="88" height="88" />
        <div className={styles.address}>
          <div className={styles.addressRow}>
            <input ref={addressInput} aria-label={t('Guest address')} title={address} readOnly value={address} size={address.length} />
            {addresses.length > 1 && <ActionMenu>
              <ActionMenu.Anchor>
                <button type="button" className={styles.addressPicker} aria-label={t('Choose network address')}>
                  <ChevronDownIcon size={12} />
                </button>
              </ActionMenu.Anchor>
              <ActionMenu.Overlay className={menuStyles.surface} align="end">
                <ActionList variant="full" selectionVariant="single">
                  {addresses.map((url, index) => <ActionList.Item key={url} selected={index === addressIndex} onSelect={() => {
                    setAddressIndex(index)
                    setCopied(false)
                  }}><span className={styles.addressOption}>{url}</span></ActionList.Item>)}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>}
            <div className={styles.addressCopy}>
              <IconButton icon={copied ? CheckIcon : CopyIcon} label={t('Copy guest address')} size="small" onClick={copyAddress} />
            </div>
          </div>
        </div>
      </>}
      {addressError && <p className={ui.error} role="alert">{t(addressError)}</p>}
    </div>
    <Devices />
  </section>
}
