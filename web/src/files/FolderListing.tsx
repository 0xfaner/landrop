import { useTranslation } from '../i18n'
import { useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import type { ResourceChanges } from '../api/events'
import { useLiveResource } from '../api/useLiveResource'
import { FileDirectoryIcon } from '@primer/octicons-react'
import { listFiles, type FileEntry } from './api'
import type { SortOrder } from './types'
import styles from './files.module.css'
import ui from '../components/surfaces.module.css'

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

interface FolderListingProps {
  path: string
  depth: number
  sort: SortOrder
  renderEntry: (item: FileEntry, depth: number) => ReactNode
  onLoad?: () => void
}

export function FolderListing({ path, depth, sort, renderEntry, onLoad }: FolderListingProps) {
  const t = useTranslation()
  const folder = useMemo(() => ({
    load: (signal: AbortSignal) => listFiles(path, signal),
    matches: (changes: ResourceChanges) => !!(changes.allFiles || changes.folders?.includes(path)),
    // Coalesce upload bursts while still refreshing during long batches.
    debounce: { delay: 250, maxWait: 1000 },
  }), [path])
  const { data, error } = useLiveResource(folder)
  const entries = useMemo(() => {
    const [field, direction] = sort.split('-')
    const order = direction === 'desc' ? -1 : 1
    return data?.slice().sort((a, b) => {
      if (a.directory !== b.directory) return a.directory ? -1 : 1
      const nameOrder = byName.compare(a.name, b.name)
      if (field === 'name') return order * nameOrder
      if (field === 'modified') return order * (Date.parse(a.modified) - Date.parse(b.modified)) || nameOrder
      return a.directory ? nameOrder : order * (a.size - b.size) || nameOrder
    })
  }, [data, sort])

  useLayoutEffect(() => {
    if (data || error) onLoad?.()
  }, [data, error, onLoad])

  if (error || !entries?.length) {
    return <li className={`${styles.treeStatus} ${error ? ui.error : ui.muted}`} data-nested={depth > 0 || undefined}
      style={{ '--depth': depth } as CSSProperties}>
      {data && !error && depth === 0 ? <div className={styles.emptyState}>
        <span className={styles.emptyIcon}><FileDirectoryIcon size={22} /></span>
        <strong>{t('This folder is empty')}</strong>
        <span>{t('Drop files here or use Upload.')}</span>
      </div> : t(error || (data ? 'This folder is empty' : 'Loading files…'))}
    </li>
  }
  return entries.map((item) => renderEntry(item, depth))
}
