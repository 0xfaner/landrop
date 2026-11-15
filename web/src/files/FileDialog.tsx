import { useTranslation } from '../i18n'
import { ArrowUpIcon, ChevronRightIcon } from '@primer/octicons-react'
import styles from './files.module.css'
import ui from '../components/surfaces.module.css'
import { Modal } from '../components/Modal'
import { useEffect, useState } from 'react'
import { Button, Heading, TextInput } from '@primer/react'
import { errorMessage } from '../api/http'
import { listFiles, type FileEntry } from './api'
import { containsPath, parentPath } from './paths'
import { IconButton } from '../components/IconButton'
import type { FileOperation } from './types'

function MoveDestination({ item, current, onNavigate }: { item: FileEntry; current: string; onNavigate: (path: string) => void }) {
  const t = useTranslation()
  const [listing, setListing] = useState<{ path: string; entries: FileEntry[] } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    listFiles(current, signal).then((entries) => {
      if (!signal.aborted) setListing({ path: current, entries })
    }).catch((error) => {
      if (!signal.aborted) setError(errorMessage(error))
    })
    return () => controller.abort()
  }, [current])
  const folders = listing?.path === current ? listing.entries.filter((entry) => (
    entry.directory && (!item.directory || !containsPath(item.path, entry.path))
  )) : null

  function navigate(path: string) {
    setError('')
    onNavigate(path)
  }

  return <>
    <div className={styles.destinationPath}>
      <strong>{current || t('Shared files')}</strong>
      {current && <IconButton icon={ArrowUpIcon} label={t('Up one level')} onClick={() => navigate(parentPath(current))} />}
    </div>
    {error ? <p className={ui.error} role="alert">{t(error)}</p> : folders ? (
      folders.length ? <ul className={styles.destinationList}>
        {folders.map((folder) => <li key={folder.id}>
          <Button type="button" variant="invisible" trailingVisual={<ChevronRightIcon />} onClick={() => navigate(folder.path)}>{folder.name}</Button>
        </li>)}
      </ul> : <p className={ui.muted}>{t('No subfolders')}</p>
    ) : <p className={ui.muted}>{t('Loading folders…')}</p>}
  </>
}

interface FileDialogProps {
  operation: FileOperation
  busy: boolean
  error: string
  onCancel: () => void
  onSubmit: (value: string) => void
}

export function FileDialog({ operation, busy, error, onCancel, onSubmit }: FileDialogProps) {
  const t = useTranslation()
  const { kind } = operation
  const [value, setValue] = useState(() => {
    if (kind === 'move') return parentPath(operation.item.path)
    if (kind === 'rename') return operation.item.name
    return ''
  })
  const titles = { move: 'Move to folder', create: 'New folder', delete: 'Delete entry', rename: 'Rename' }
  const actions = { move: 'Move here', create: 'Create folder', delete: 'Delete permanently', rename: 'Save' }
  return <Modal labelledBy="file-dialog-title" className={styles.fileDialog} onClose={onCancel} busy={busy}>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(value) }}>
      <Heading as="h2" id="file-dialog-title">{t(titles[kind])}</Heading>
      {kind === 'delete' && <p>
        {t(operation.item.directory ? 'Delete {name} and everything in it? This cannot be undone.' : 'Delete {name}? This cannot be undone.', { name: operation.item.name })}
      </p>}
      {kind === 'create' && <>
        <label htmlFor="new-folder-name">{t('Name in {folder}', { folder: operation.folder || t('Shared files') })}</label>
        <TextInput block id="new-folder-name" autoFocus required maxLength={240} value={value} onChange={(event) => setValue(event.target.value)} />
      </>}
      {kind === 'rename' && <>
        <label htmlFor="rename-file-name">{t('New name')}</label>
        <TextInput block id="rename-file-name" autoFocus required maxLength={240} readOnly={busy} value={value}
          onFocus={(event) => event.target.select()} onChange={(event) => setValue(event.target.value)} />
      </>}
      {kind === 'move' && <fieldset disabled={busy}>
        <legend>{t('Destination for {name}', { name: operation.item.name })}</legend>
        <MoveDestination item={operation.item} current={value} onNavigate={setValue} />
      </fieldset>}
      {error && <p className={ui.error} role="alert">{error}</p>}
      <div className={`${ui.actions} ${ui.dialogActions}`}>
        <Button type="button" size="small" autoFocus={kind === 'delete'} disabled={busy} onClick={onCancel}>{t('Cancel')}</Button>
        <Button type="submit" size="small" variant={kind === 'delete' ? 'danger' : 'default'} disabled={busy || (kind === 'move' && value === parentPath(operation.item.path))}>
          {t(actions[kind])}
        </Button>
      </div>
    </form>
  </Modal>
}
