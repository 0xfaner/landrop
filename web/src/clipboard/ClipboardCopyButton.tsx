import { useEffect, useState } from 'react'
import { AlertIcon, CheckIcon, CopyIcon } from '@primer/octicons-react'
import { IconButton } from '../components/IconButton'
import { useTranslation } from '../i18n'
import styles from './clipboard.module.css'

export function ClipboardCopyButton({ onCopy, disabled }: { onCopy: () => Promise<boolean>; disabled?: boolean }) {
  const t = useTranslation()
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (status !== 'copied' && status !== 'failed') return
    const timer = setTimeout(() => setStatus('idle'), status === 'copied' ? 1500 : 2000)
    return () => clearTimeout(timer)
  }, [status])

  async function copy() {
    if (status === 'copying') return
    setStatus('copying')
    try {
      setStatus(await onCopy() ? 'copied' : 'failed')
    } catch {
      setStatus('failed')
    }
  }

  const copied = status === 'copied'
  const failed = status === 'failed'
  return <IconButton icon={copied ? CheckIcon : failed ? AlertIcon : CopyIcon} label={t('Copy')}
      className={copied ? styles.copyComplete : failed ? styles.copyFailed : undefined}
      disabled={disabled} aria-disabled={status === 'copying' || undefined} onClick={copy} />
}
