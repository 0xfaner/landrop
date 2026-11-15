import { useTranslation } from '../i18n'
import { useRef } from 'react'
import { Button, Heading, Textarea } from '@primer/react'
import { XIcon } from '@primer/octicons-react'
import { IconButton } from '../components/IconButton'
import { Modal } from '../components/Modal'
import { canCopyImage, copySelection } from './browserClipboard'
import { ClipboardCopyButton } from './ClipboardCopyButton'
import { ImageCopy } from './ImageActions'
import { MixedClipboardCopy } from './MixedClipboardCopy'
import { imageURL, type ClipboardPart, type ImageEntry, type MixedEntry } from './api'
import styles from './clipboard.module.css'
import ui from '../components/surfaces.module.css'

export type Dialog = (
  | { kind: 'clear' }
  | { kind: 'image'; entry: ImageEntry }
  | { kind: 'mixed'; entry: MixedEntry; parts: ClipboardPart[] }
  | { kind: 'text'; text: string }
) & { error?: string }

export function ClipboardDialog({ dialog, pending, onClose, onClear }: {
  dialog: Dialog
  pending: boolean
  onClose: () => void
  onClear: () => void
}) {
  const t = useTranslation()
  const textField = useRef<HTMLTextAreaElement>(null)
  const closePreview = useRef<HTMLButtonElement>(null)
  const { kind } = dialog

  const title = kind === 'image' ? dialog.entry.name
    : t(kind === 'mixed' ? 'Clipboard entry' : kind === 'text' ? 'Clipboard text' : 'Clear clipboard history?')
  const isPreview = kind !== 'clear'

  async function copyText() {
    if (dialog.kind !== 'text') return false
    try {
      await navigator.clipboard.writeText(dialog.text)
    } catch {
      return !!textField.current && copySelection(textField.current)
    }
    return true
  }

  const appearance = isPreview ? `${styles.clipDialog} ${styles.clipPreviewDialog}` : styles.clipDialog
  return <Modal labelledBy="clip-dialog-title" className={appearance} busy={pending} onClose={onClose}
    initialFocus={isPreview ? closePreview : undefined}>
    <div className={styles.clipHeading}>
      <Heading as="h2" id="clip-dialog-title" className={kind === 'image' ? ui.truncate : undefined}
        title={kind === 'image' ? title : undefined}>{title}</Heading>
      {isPreview && <div className={[ui.actions, styles.clipPreviewActions].join(' ')}>
        {kind === 'image' && canCopyImage && <ImageCopy entry={dialog.entry} />}
        {kind === 'text' && <ClipboardCopyButton onCopy={copyText} />}
        {kind === 'mixed' && <MixedClipboardCopy entry={dialog.entry} parts={dialog.parts} />}
        <IconButton ref={closePreview} icon={XIcon} label={t('Close preview')} disabled={pending} onClick={onClose} />
      </div>}
    </div>
    {kind === 'clear' && <>
      <p>{t('This removes all shared text and images for connected devices.')}</p>
      <div className={`${ui.actions} ${ui.dialogActions}`}>
        <Button type="button" size="small" autoFocus disabled={pending} onClick={onClose}>{t('Cancel')}</Button>
        <Button type="button" size="small" variant="danger" disabled={pending} onClick={onClear}>{t('Clear history')}</Button>
      </div>
    </>}
    {isPreview && <div className={styles.clipPreviewBody} tabIndex={kind === 'mixed' ? 0 : undefined}>
      {kind === 'image' && <>
        <img src={imageURL(dialog.entry)} alt={dialog.entry.name} />
        {!canCopyImage && <p className={ui.muted}>{t('Use your browser’s image menu to copy if available.')}</p>}
      </>}
      {kind === 'text' &&
        <Textarea block resize="none" ref={textField} rows={8} dir="auto" aria-label={t('Clipboard text')} value={dialog.text} readOnly />
      }
      {kind === 'mixed' && <div className={styles.clipParts}>
        {dialog.parts.map((part, index) => {
          if ('text' in part) return <p key={index} dir="auto">{part.text}</p>
          return <img key={index} src={imageURL(dialog.entry, false, index)} alt={part.image.name} loading="lazy" />
        })}
      </div>}
      {dialog.error && <p className={ui.error} role="alert">{t(dialog.error)}</p>}
    </div>}
    {kind === 'clear' && dialog.error && <p className={ui.error} role="alert">{t(dialog.error)}</p>}
  </Modal>
}

