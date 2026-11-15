import { useTranslation } from '../i18n'
import { Fragment, useEffect, useRef, useState, type MouseEvent } from 'react'
import { type SortOrder, type FileActionKind, type FileOperation, type MenuAnchor, type View } from './types'
import { FolderListing } from './FolderListing'
import { FileBreadcrumbs } from './FileBreadcrumbs'
import { FileDialog } from './FileDialog'
import { FileToolbar } from './FileToolbar'
import { FileSortHeader } from './FileSortHeader'
import { useFileDrop } from './useFileDrop'
import { FileRow } from './FileRow'
import { createFolder, deleteEntry, moveEntry, type FileEntry } from './api'
import { containsPath, joinPath, parentPath } from './paths'
import { droppedFiles, formatSize } from './transfer'
import { useFileCommands } from './useFileCommands'
import styles from './files.module.css'
import ui from '../components/surfaces.module.css'

const viewKey = 'landrop.fileView'
type Menu = (MenuAnchor & { kind: 'breadcrumbs' }) | (MenuAnchor & { kind: 'row'; item: FileEntry })

interface FilesProps {
  limit: number
  host: boolean
  visible: boolean
  isHeadingAboveViewport: (heading: HTMLElement | null) => boolean
  revealTop: () => void
}

export function Files({ limit, host, visible, isHeadingAboveViewport, revealTop }: FilesProps) {
  const t = useTranslation()
  const { busy, error, clearError, progress, openingFolder, run, upload, openSharedFolder } = useFileCommands(limit, closeStaleOperation)
  const errorText = typeof error === 'string' ? t(error)
    : error.map(({ name, message, values }) => `${name}: ${t(message, values)}`).join('\n')
  const [folder, setFolder] = useState('')
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(viewKey) === 'tree' ? 'tree' : 'list' } catch { return 'list' }
  })
  const [sort, setSort] = useState<SortOrder>('name-asc')
  const [expanded, setExpanded] = useState(() => new Set<string>())
  const [menu, setMenu] = useState<Menu | null>(null)
  const [rename, setRename] = useState<FileEntry | null>(null)
  const [operation, setOperation] = useState<FileOperation | null>(null)
  const heading = useRef<HTMLDivElement>(null)
  const listing = useRef<HTMLUListElement>(null)
  const revealOnLoad = useRef(false)
  const focusEntry = useRef<string | null>(null)
  const tree = view === 'tree'

  const { dropTarget, dropHandlers, startDrag, resetDrop } = useFileDrop({
    busy,
    upload: (data, path) => upload(() => droppedFiles(data), path, expandFolder),
    move: (item, path) => run(async () => {
      await move(item, joinPath(path, item.name))
      setRename(null)
    }),
  })

  useEffect(() => {
    if (!visible) {
      revealOnLoad.current = false
      resetDrop()
      setMenu(null)
    }
  }, [visible, resetDrop])

  function navigate(path: string) {
    if (path !== folder) {
      const headingAboveViewport = isHeadingAboveViewport(heading.current)
      revealOnLoad.current = !tree && headingAboveViewport
      if (tree && headingAboveViewport) revealTop()
    }
    setMenu(null)
    setRename(null)
    setFolder(path)
    expandFolder(path)
    if ((!tree || !path) && listing.current) {
      listing.current.focus({ preventScroll: true })
    }
  }

  function toggle(path: string) {
    setMenu(null)
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function switchView(next: View) {
    if (next === view) return
    revealOnLoad.current = isHeadingAboveViewport(heading.current)
    setMenu(null)
    setRename(null)
    resetDrop()
    setView(next)
    try { localStorage.setItem(viewKey, next) } catch {}
  }

  function onListingLoad() {
    if (!revealOnLoad.current) return
    revealOnLoad.current = false
    revealTop()
  }

  function expandFolder(path: string) {
    if (!path) return
    setExpanded((previous) => {
      const next = new Set(previous)
      for (let current = path; current; current = parentPath(current)) next.add(current)
      return next
    })
  }

  function cancelRename() {
    focusEntry.current = rename?.path ?? null
    setRename(null)
    clearError()
  }

  function openBreadcrumbMenu(event: MouseEvent<HTMLButtonElement>) {
    const trigger = event.currentTarget
    setMenu((previous) => previous?.trigger === trigger ? null : { trigger, kind: 'breadcrumbs' })
  }

  function closeMenu(restoreFocus = false) {
    if (restoreFocus) menu?.trigger.focus({ preventScroll: true })
    setMenu(null)
  }

  function closeStaleOperation() {
    setOperation(null)
    setRename(null)
  }

  function start(kind: FileActionKind, item: FileEntry) {
    closeMenu(true)
    clearError()
    if (kind === 'rename' && !matchMedia('(max-width: 560px), (pointer: coarse)').matches) {
      setRename(item)
    } else {
      setRename(null)
      setOperation({ kind, item })
    }
  }

  function startCreate() {
    closeMenu()
    clearError()
    setRename(null)
    setOperation({ kind: 'create', folder })
  }

  async function move(item: FileEntry, target: string) {
    await moveEntry(item, target)
    if (!item.directory || target === item.path) {
      expandFolder(parentPath(target))
      return
    }
    const rebase = (path: string) => containsPath(item.path, path) ? target + path.slice(item.path.length) : path
    setExpanded((previous) => new Set(Array.from(previous, rebase)))
    expandFolder(parentPath(target))
    setFolder(rebase)
  }

  async function renameEntry(item: FileEntry, name: string) {
    if (name.includes('/') || name.includes('\\')) throw Error('Enter a name without slashes.')
    const target = joinPath(parentPath(item.path), name)
    await move(item, target)
    focusEntry.current = target
    setRename(null)
  }

  function finishOperation(value: string) {
    if (!operation) return
    run(async () => {
      const { kind } = operation
      if (kind === 'create') {
        if (value.includes('/') || value.includes('\\')) throw Error('Enter a folder name without slashes.')
        await createFolder(joinPath(operation.folder, value))
        expandFolder(operation.folder)
      } else if (kind === 'rename') {
        await renameEntry(operation.item, value)
      } else if (kind === 'move') {
        await move(operation.item, joinPath(value, operation.item.name))
      } else {
        const { item } = operation
        await deleteEntry(item)
        if (item.directory) {
          setExpanded((previous) => new Set(Array.from(previous).filter((path) => !containsPath(item.path, path))))
          setFolder((previous) => containsPath(item.path, previous) ? parentPath(item.path) : previous)
        }
      }
      setOperation(null)
      setRename(null)
    })
  }

  function renderEntry(item: FileEntry, depth: number) {
    const open = tree && item.directory && expanded.has(item.path)
    const editing = rename?.id === item.id ? rename : null
    return <Fragment key={item.id}>
      <FileRow item={item} depth={depth} tree={tree} open={open} selected={folder === item.path} busy={busy}
        dropHandlers={item.directory ? dropHandlers(item.path, 'row') : undefined}
        labelRef={(node) => {
          if (node && focusEntry.current === item.path) {
            focusEntry.current = null
            node.focus()
          }
        }}
        editing={!!editing}
        menu={menu?.kind === 'row' && menu.item.id === item.id ? menu : null}
        onNavigate={() => navigate(item.path)} onToggle={() => toggle(item.path)}
        onMenu={(trigger, point, contextMenu = false) => {
          setMenu((previous) => !contextMenu && previous?.trigger === trigger ? null : { trigger, item, point, kind: 'row' })
        }}
        onCloseMenu={closeMenu} onAction={(kind) => start(kind, item)}
        onRename={(name) => run(() => renameEntry(editing ?? item, name))}
        onCancelRename={cancelRename}
        onDragStart={(event) => { startDrag(item, event.dataTransfer); setMenu(null) }}
        onDragEnd={resetDrop} />
      {open && <FolderListing path={item.path} depth={depth + 1} sort={sort} renderEntry={renderEntry} />}
    </Fragment>
  }

  return <>
    <section className={`${ui.panel} ${styles.explorer}`} aria-label={t('Shared files')}>
      <div className={styles.filesHeading} ref={heading}>
        <FileBreadcrumbs folder={folder} navigate={navigate} dropHandlers={dropHandlers}
          menu={menu?.kind === 'breadcrumbs' ? menu : null} openMenu={openBreadcrumbMenu} closeMenu={closeMenu} />
        <FileToolbar folder={folder} view={view} host={host} busy={busy}
          openingFolder={openingFolder} onViewChange={switchView}
          onUpload={(files, target) => upload(() => files, target, expandFolder)}
          onOpenFolder={openSharedFolder} onCreate={startCreate} />
      </div>
      {errorText && !operation && <p className={`${styles.fileError} ${ui.error}`} role="alert">{errorText}</p>}
      {progress && <div className={styles.fileFeedback}>
        <div className={styles.uploadProgress} role="status">
          <span>{progress.fileName ?? t('{finished} of {total} files finished', { finished: progress.finished, total: progress.total })}{progress.target && ` · ${progress.target}`}</span><span>{progress.value}%</span>
          <progress aria-label={t('Upload progress')} max="100" value={progress.value} />
        </div>
      </div>}
      <FileSortHeader sort={sort} onSortChange={setSort} />
      <ul className={styles.fileTree} data-view={view}
        ref={listing} tabIndex={-1} aria-label={tree ? t('File tree') : t('Files in {folder}', { folder: folder || t('the root folder') })}
        {...dropHandlers(folder, 'list')}>
        <FolderListing key={tree ? 'tree' : `list:${folder}`} path={tree ? '' : folder} depth={0} sort={sort}
          renderEntry={renderEntry} onLoad={onListingLoad} />
      </ul>
      {!progress && dropTarget !== null && <p className={`${styles.fileDropHint} ${ui.muted}`}>
        {t(dropTarget.internal ? 'Move to {folder}' : 'Upload to {folder}', { folder: dropTarget.path || t('the root folder') })}
        {!dropTarget.internal && limit > 0 && ' · ' + t('Limit per file: {limit}', { limit: formatSize(limit) })}
      </p>}
    </section>
    {operation && <FileDialog operation={operation} busy={busy} error={errorText} onSubmit={finishOperation}
      onCancel={() => { setOperation(null); clearError() }} />}
  </>
}
