import { useTranslation } from '../i18n'
import { dateTime } from '../dateTime'
import {
  ChevronDownIcon, ChevronRightIcon, DownloadIcon, FileDirectoryIcon,
  FileIcon, FileMovedIcon, KebabHorizontalIcon, PencilIcon, TrashIcon,
} from '@primer/octicons-react'
import styles from './files.module.css'
import ui from '../components/surfaces.module.css'
import { useRef, type CSSProperties, type DragEventHandler, type Ref } from 'react'
import { Button, TextInput } from '@primer/react'
import { downloadURL, type FileEntry } from './api'
import { formatSize } from './transfer'
import { FileAction, FileActions } from './FileActions'
import { IconButton } from '../components/IconButton'

import type { DropHandlers, FileActionKind, MenuAnchor } from './types'

interface FileRowProps {
  item: FileEntry
  depth: number
  tree: boolean
  open: boolean
  selected: boolean
  busy: boolean
  dropHandlers?: DropHandlers
  labelRef: Ref<HTMLButtonElement>
  editing: boolean
  menu: MenuAnchor | null
  onNavigate: () => void
  onToggle: () => void
  onMenu: (trigger: HTMLButtonElement, point?: MenuAnchor['point'], contextMenu?: boolean) => void
  onCloseMenu: (restoreFocus?: boolean) => void
  onAction: (kind: FileActionKind) => void
  onRename: (name: string) => void
  onCancelRename: () => void
  onDragStart: DragEventHandler<HTMLButtonElement>
  onDragEnd: DragEventHandler<HTMLButtonElement>
}

export function FileRow({
  item, depth, tree, open, selected, busy, dropHandlers, labelRef,
  editing, menu, onNavigate, onToggle, onMenu, onCloseMenu, onAction,
  onRename, onCancelRename, onDragStart, onDragEnd,
}: FileRowProps) {
  const t = useTranslation()
  const EntryIcon = item.directory ? FileDirectoryIcon : FileIcon
  const download = downloadURL(item)
  const actions = useRef<HTMLButtonElement>(null)
  return (
    <li className={styles.treeEntry} data-selected={selected || undefined}
      style={{ '--depth': depth } as CSSProperties}
      {...dropHandlers}
      onContextMenu={(event) => {
        if (editing || !actions.current || (event.target instanceof Element && event.target.closest(`input, .${styles.fileActions}`))) return
        event.preventDefault()
        const point = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null
        onMenu(actions.current, point, true)
      }}
      onKeyDown={(event) => {
        if (event.key === 'F2' && !busy && !editing) {
          event.preventDefault()
          onAction('rename')
        }
      }}>
      <div className={styles.treeRow} data-editing={editing || undefined}>
        <div className={styles.fileName}>
          {tree && (item.directory
            ? <button type="button" className={styles.treeDisclosure} aria-label={t(open ? 'Collapse {name}' : 'Expand {name}', { name: item.name })}
                aria-expanded={open} onClick={onToggle}>
                {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
              </button>
            : <span className={styles.treeDisclosure} aria-hidden="true" />)}
          {editing ? <form className={styles.renameForm} onSubmit={(event) => {
            event.preventDefault()
            const field = event.currentTarget.elements.namedItem('name')
            if (field instanceof HTMLInputElement) onRename(field.value)
          }}>
            <TextInput className={styles.renameInput} size="small" name="name" aria-label={t('Rename {name}', { name: item.name })} autoFocus required maxLength={240} defaultValue={item.name} readOnly={busy}
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) onCancelRename()
              }} />
            <Button type="submit" size="small" disabled={busy}>{t('Save')}</Button>
            <Button type="button" size="small" variant="invisible" disabled={busy} onClick={onCancelRename}>{t('Cancel')}</Button>
          </form> : (
            <button type="button" className={styles.treeLabel} title={item.name} aria-current={tree && selected ? 'location' : undefined}
              ref={labelRef}
              draggable={!busy}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onClick={item.directory ? onNavigate : undefined}>
              <EntryIcon />
              <span className={ui.truncate}>{item.name}</span>
            </button>
          )}
        </div>
        {!editing && <>
          <small className={styles.fileSize}>{item.directory ? '—' : formatSize(item.size)}</small>
          <time className={styles.fileModified} dateTime={item.modified}>{dateTime.format(new Date(item.modified))}</time>
          <IconButton ref={actions} icon={KebabHorizontalIcon} className={styles.treeMore} label={t('Actions for {name}', { name: item.name })} description={t('More actions')}
            aria-expanded={!!menu} onClick={(event) => onMenu(event.currentTarget)} />
        </>}
      </div>
      {menu && <FileActions trigger={menu.trigger} point={menu.point} onClose={onCloseMenu}>
        {!item.directory && <FileAction icon={<DownloadIcon />} href={download} download={item.name} onClick={() => onCloseMenu(true)}>{t('Download')}</FileAction>}
        <FileAction icon={<PencilIcon />} disabled={busy} onClick={() => onAction('rename')}>{t('Rename')}</FileAction>
        <FileAction icon={<FileMovedIcon />} disabled={busy} onClick={() => onAction('move')}>{t('Move to…')}</FileAction>
        <FileAction icon={<TrashIcon />} danger disabled={busy} onClick={() => onAction('delete')}>{t('Delete')}</FileAction>
      </FileActions>}
    </li>
  )
}
