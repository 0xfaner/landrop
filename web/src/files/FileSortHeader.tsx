import { useTranslation } from '../i18n'
import { ActionList, ActionMenu } from '@primer/react'
import { ArrowDownIcon, ArrowUpIcon } from '@primer/octicons-react'
import { sortOptions, type SortOrder } from './types'
import styles from './files.module.css'
import menuStyles from '../components/menu.module.css'

const columns = [
  { label: 'Name', ascending: 'name-asc', descending: 'name-desc', initial: 'name-asc' },
  { label: 'Size', ascending: 'size-asc', descending: 'size-desc', initial: 'size-desc', className: styles.fileSize },
  { label: 'Modified', ascending: 'modified-asc', descending: 'modified-desc', initial: 'modified-desc', className: styles.fileModified },
] as const

export function FileSortHeader({ sort, onSortChange }: { sort: SortOrder; onSortChange: (sort: SortOrder) => void }) {
  const t = useTranslation()
  const sortLabel = sortOptions.find(([value]) => value === sort)?.[1]

  return <div className={styles.fileListHead} role="group" aria-label={t('File sorting')}>
    {columns.map(({ label, ascending, descending, initial, ...column }) => {
      const active = sort === ascending || sort === descending
      const next = active ? (sort === ascending ? descending : ascending) : initial
      const button = <button key={label} type="button" className={styles.sortColumn + ('className' in column ? ' ' + column.className : '')}
        aria-description={active ? t(sort === ascending ? 'Sorted ascending' : 'Sorted descending') : undefined}
        data-sorted={active || undefined} onClick={() => onSortChange(next)}>
        {t(label)}
        {active && (sort === ascending ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />)}
      </button>
      if (label !== 'Name') return button

      return <div key={label} className={styles.nameHeader}>
        {button}
        <div className={styles.narrowSort}>
          <ActionMenu>
            <ActionMenu.Button size="small" variant="invisible" aria-description={sortLabel && t(sortLabel)}>{t('Sort by')}</ActionMenu.Button>
            <ActionMenu.Overlay className={menuStyles.surface} align="end">
              <ActionList variant="full" selectionVariant="single">
                {sortOptions.map(([value, option]) => (
                  <ActionList.Item key={value} selected={sort === value} onSelect={() => onSortChange(value)}>{t(option)}</ActionList.Item>
                ))}
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </div>
      </div>
    })}
  </div>
}
