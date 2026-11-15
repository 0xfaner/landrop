import { dateTime } from '../dateTime'
import { useTranslation } from '../i18n'
import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react'
import { Button, Heading } from '@primer/react'
import { CheckIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import { errorMessage } from '../api/http'
import { IconButton } from '../components/IconButton'
import { addEntry, clearHistory, deleteEntry, editText, imageURL, readParts, readText, type ClipboardEntry, type MixedEntry, type TextEntry } from './api'
import { canCopyImage, copyEntryText } from './browserClipboard'
import { ClipboardComposer } from './ClipboardComposer'
import { ClipboardCopyButton } from './ClipboardCopyButton'
import { ClipboardDialog, type Dialog } from './ClipboardDialog'
import { ClipboardTextarea } from './ClipboardTextarea'
import { exceedsTextLimit } from './limits'
import { ImageCopy, ImageDownload } from './ImageActions'
import styles from './clipboard.module.css'
import ui from '../components/surfaces.module.css'

interface ClipboardProps {
  entries?: ClipboardEntry[]
  loadError: string
  onEntryDeleted: (id: number) => void
}

export function Clipboard({ entries, loadError, onEntryDeleted }: ClipboardProps) {
  const t = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [deletion, setDeletion] = useState<{ entry: ClipboardEntry; index: number; confirmed: boolean } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const restoreEditFocus = useRef<number | null>(null)
  useEffect(() => {
    if (editing !== null && entries && !entries.some((entry) => entry.id === editing)) setEditing(null)
  }, [entries, editing])

  useEffect(() => {
    if (!deletion?.confirmed) return
    const timer = setTimeout(() => setDeletion(null), 700)
    return () => clearTimeout(timer)
  }, [deletion])

  async function change(action: () => Promise<void>, finish?: () => void, onError?: (message: string) => void) {
    if (pending) return
    setPending(true)
    if (!onError) setError('')
    try {
      await action()
      finish?.()
    } catch (error) {
      if (onError) onError(errorMessage(error))
      else if (dialog) setDialog({ ...dialog, error: errorMessage(error) })
      else setError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  function removeEntry(entry: ClipboardEntry, index: number) {
    void change(async () => {
      setDeletion({ entry, index, confirmed: false })
      try {
        await deleteEntry(entry.id)
      } catch (error) {
        setDeletion(null)
        throw error
      }
      onEntryDeleted(entry.id)
      setDeletion({ entry, index, confirmed: true })
    })
  }

  const visibleEntries = [...(entries ?? [])]
  if (deletion && !visibleEntries.some((entry) => entry.id === deletion.entry.id)) {
    visibleEntries.splice(deletion.index, 0, deletion.entry)
  }

  function closeEdit() {
    restoreEditFocus.current = editing
    setEditing(null)
  }

  async function openText(entry: TextEntry) {
    setError('')
    try {
      const text = await readText(entry)
      setDialog({ kind: 'text', text })
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  async function openMixed(entry: MixedEntry) {
    setError('')
    try {
      const parts = await readParts(entry)
      setDialog({ kind: 'mixed', entry, parts })
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  return <>
    <ClipboardComposer busy={pending} problem={error || loadError}
      onReset={() => setError('')} onAdd={(body, complete) => change(() => addEntry(body), complete)} />
    <section className={`${ui.panel} ${styles.clipHistory}`} aria-labelledby="clip-history-title">
      <div className={styles.clipHistoryHeading}>
        <Heading as="h2" id="clip-history-title">{t('History')}</Heading>
        <Button size="small" variant="danger" onClick={() => setDialog({ kind: 'clear' })} disabled={pending || !entries?.length}>{t('Clear all')}</Button>
      </div>
      {visibleEntries.length ? <ul>
        {visibleEntries.map((entry, index) => {
          const deleting = deletion?.entry.id === entry.id
          const deleted = deleting && deletion.confirmed
          const isText = entry.type === 'text/plain'
          const isMixed = entry.type === 'application/json'
          if (isText && editing === entry.id) return <li key={entry.id}>
            <ClipboardTextEdit entry={entry} pending={pending} onClose={closeEdit}
              onSave={(text, onError) => change(() => editText(entry.id, text), closeEdit, onError)} />
          </li>
          return <li className={styles.clipHistoryItem} key={entry.id} inert={deleting || undefined}>
            {isText
              ? <button className={styles.clipPreview} type="button" onClick={() => openText(entry)}>
                <span className={styles.clipTextPreview} dir="auto">{entry.preview}{entry.hasMore ? '…' : ''}</span>
              </button>
              : <button className={[styles.clipPreview, styles.clipThumbnail].join(' ')} type="button"
                onClick={() => isMixed ? openMixed(entry) : setDialog({ kind: 'image', entry })}
                aria-label={isMixed ? undefined : t('Preview {name}', { name: entry.name })}>
                <img src={imageURL(entry, false, isMixed ? entry.thumb : undefined)} alt="" loading="lazy" />
                <span className={styles.clipTextPreview} dir="auto">
                  {isMixed ? entry.preview || t('Clipboard images') : entry.name}{isMixed && entry.hasMore ? '…' : ''}
                </span>
              </button>}
            <ClipboardTime created={entry.created} />
            <div className={[ui.actions, styles.clipEntryActions].join(' ')}>
              {isText ? <>
                <ClipboardCopyButton onCopy={() => copyEntryText(entry)} />
                <IconButton icon={PencilIcon} label={t('Edit text')}
                  ref={(button) => {
                    if (button && restoreEditFocus.current === entry.id) {
                      restoreEditFocus.current = null
                      button.focus({ preventScroll: true })
                    }
                  }}
                  disabled={pending || editing !== null} onClick={() => setEditing(entry.id)} />
              </> : !isMixed && <>
                {canCopyImage && <ImageCopy entry={entry} />}
                <ImageDownload entry={entry} />
              </>}
              <IconButton icon={deleted ? CheckIcon : TrashIcon} label={t('Delete')}
                className={deleted ? styles.copyComplete : styles.deleteEntry}
                disabled={pending} onClick={() => removeEntry(entry, index)} />
            </div>
          </li>
        })}
      </ul> : <p className={`${ui.muted} ${styles.clipHistoryEmpty}`}>{t(entries ? 'No clipboard entries yet' : loadError ? 'History unavailable' : 'Loading history…')}</p>}
    </section>
    {dialog && <ClipboardDialog dialog={dialog} pending={pending} onClose={() => setDialog(null)}
      onClear={() => change(clearHistory, () => { setDialog(null); setEditing(null); setDeletion(null) })} />}
  </>
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const shortTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

function ClipboardTime({ created }: { created: string }) {
  const date = new Date(created)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  return <time dateTime={created} title={dateTime.format(date)}>{isToday ? shortTime.format(date) : shortDate.format(date)}</time>
}

function ClipboardTextEdit({ entry, pending, onSave, onClose }: {
  entry: TextEntry
  pending: boolean
  onSave: (text: string, onError: (message: string) => void) => void
  onClose: () => void
}) {
  const t = useTranslation()
  const [draft, setDraft] = useState(entry.hasMore ? null : entry.preview)
  const [error, setError] = useState('')
  const loading = draft === null
  const tooLong = !loading && exceedsTextLimit(draft)
  const canSave = !pending && !!draft?.trim() && !tooLong

  useEffect(() => {
    if (!loading) return
    const controller = new AbortController()
    const { signal } = controller
    readText(entry, signal).then((text) => {
      if (!signal.aborted) setDraft(text)
    }).catch((error) => {
      if (!signal.aborted) setError(errorMessage(error))
    })
    return () => controller.abort()
  }, [entry, loading])

  function submit(event: SubmitEvent<HTMLFormElement> | KeyboardEvent<HTMLFormElement>) {
    event.preventDefault()
    if (canSave && draft !== null) onSave(draft, setError)
  }

  return <form className={styles.clipInlineEdit} onSubmit={submit} onKeyDown={(event) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && !pending) {
      event.preventDefault()
      onClose()
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      submit(event)
    }
  }}>
    <ClipboardTextarea autoFocus rows={4} dir="auto" aria-label={t('Edit clipboard text')} value={draft ?? ''}
      placeholder={t(error ? 'Could not load text' : 'Loading text…')} readOnly={loading || pending}
      autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-invalid={tooLong || undefined}
      aria-describedby={error || tooLong ? 'clip-edit-error' : undefined}
      onChange={(event) => { setDraft(event.target.value); setError('') }} />
    {(error || tooLong) && <p id="clip-edit-error" className={ui.error} role="alert">{t(error || 'Text exceeds 256 KiB.')}</p>}
    <div className={styles.clipEntryFooter}>
      <ClipboardTime created={entry.created} />
      <div className={[ui.actions, styles.clipEntryActions].join(' ')}>
        <Button type="button" size="small" variant="invisible" disabled={pending} onClick={onClose}>{t('Cancel')}</Button>
        <Button type="submit" size="small" disabled={!canSave}>{t('Save')}</Button>
      </div>
    </div>
  </form>
}
