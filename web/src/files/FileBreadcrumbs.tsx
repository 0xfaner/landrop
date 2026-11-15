import { useTranslation } from '../i18n'
import { ArrowUpIcon, ChevronRightIcon, FileDirectoryIcon, HomeIcon, KebabHorizontalIcon } from '@primer/octicons-react'
import styles from './files.module.css'
import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { FileAction, FileActions } from './FileActions'
import { IconButton } from '../components/IconButton'
import { parentPath } from './paths'

import type { DropHandlers, DropSurface, MenuAnchor } from './types'

interface FileBreadcrumbsProps {
  folder: string
  navigate: (path: string) => void
  dropHandlers: (path: string, surface: DropSurface) => DropHandlers
  menu: MenuAnchor | null
  openMenu: (event: MouseEvent<HTMLButtonElement>) => void
  closeMenu: (restoreFocus?: boolean) => void
}

export function FileBreadcrumbs({ folder, navigate, dropHandlers, menu, openMenu, closeMenu }: FileBreadcrumbsProps) {
  const t = useTranslation()
  const crumbs = useRef<HTMLOListElement>(null)
  const measure = useRef<HTMLOListElement>(null)
  const [hiddenCount, setHiddenCount] = useState(0)
  const segments = folder ? folder.split('/') : []
  const paths = segments.map((_, index) => segments.slice(0, index + 1).join('/'))

  useLayoutEffect(() => {
    const list = crumbs.current
    const sample = measure.current
    if (!folder || !list || !sample) return

    const fit = () => {
      const [root, overflow, ...items] = Array.from(sample.children, (item) => item.getBoundingClientRect().width)
      const gap = parseFloat(getComputedStyle(sample).columnGap)
      const available = list.getBoundingClientRect().width
      const fullWidth = root + items.reduce((total, width) => total + width + gap, 0)
      if (fullWidth <= available || items.length < 2) {
        setHiddenCount(0)
        return
      }

      let used = root + overflow + items[items.length - 1] + 2 * gap
      let hidden = items.length - 1
      while (hidden > 1 && used + items[hidden - 1] + gap <= available) {
        used += items[hidden - 1] + gap
        hidden--
      }
      setHiddenCount(hidden)
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(list)
    observer.observe(sample)
    return () => observer.disconnect()
  }, [folder])

  function renderCrumbs(sample = false) {
    const visibleStart = sample || !folder ? 0 : hiddenCount
    return <>
      <li className={styles.rootCrumb}>
        <IconButton icon={HomeIcon} label={t('Root folder')} aria-current={!folder ? 'location' : undefined}
          onClick={() => { if (folder) navigate('') }} {...(sample ? {} : dropHandlers('', 'breadcrumb'))} />
      </li>
      {(sample || visibleStart > 0) && <li className={styles.overflowCrumb}>
        <ChevronRightIcon className={styles.fileChevron} />
        <IconButton icon={KebabHorizontalIcon} label={t('More folders')} aria-expanded={!!menu} onClick={openMenu} />
      </li>}
      {segments.slice(visibleStart).map((label, offset) => {
        const index = visibleStart + offset
        const path = paths[index]
        const current = index === segments.length - 1
        return <li key={path} className={current ? styles.currentCrumb : undefined}>
          <ChevronRightIcon className={styles.fileChevron} />
          {current ? <span aria-current="location" title={label}>{label}</span>
            : <button className={styles.crumbButton} type="button" title={label} onClick={() => navigate(path)}
              {...(sample ? {} : dropHandlers(path, 'breadcrumb'))}>{label}</button>}
        </li>
      })}
    </>
  }

  return <nav className={styles.filePath} aria-label={t('Current folder')} data-root={!folder || undefined}>
    <ol className={styles.fileCrumbs} ref={crumbs}>{renderCrumbs()}</ol>
    {/* Measure the full path at its natural width without adding interactive duplicates. */}
    <div className={styles.fileCrumbsMeasure} inert aria-hidden="true">
      <ol className={styles.fileCrumbs} ref={measure}>{renderCrumbs(true)}</ol>
    </div>
    {folder && <IconButton icon={ArrowUpIcon} label={t('Up one level')} onClick={() => navigate(parentPath(folder))} {...dropHandlers(parentPath(folder), 'parent')} />}
    {menu && hiddenCount > 0 && <FileActions trigger={menu.trigger} onClose={closeMenu}>
      {segments.slice(0, hiddenCount).map((label, index) => (
        <FileAction key={paths[index]} icon={<FileDirectoryIcon />} title={paths[index]} onClick={() => navigate(paths[index])}>{label}</FileAction>
      ))}
    </FileActions>}
  </nav>
}
