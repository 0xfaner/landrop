import { useTranslation } from './i18n'
import styles from './Workspace.module.css'
import { FileDirectoryIcon, PasteIcon } from '@primer/octicons-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { listClipboardHistory } from './clipboard/api'
import type { ResourceChanges } from './api/events'
import { useLiveResource } from './api/useLiveResource'
import { Files } from './files/Files'
import { Clipboard } from './clipboard/Clipboard'

import type { Session } from './session/api'

type Tab = 'files' | 'clipboard'

const clipboardHistory = {
  load: listClipboardHistory,
  matches: (changes: ResourceChanges) => !!changes.clipboard,
}

export function Workspace({ session }: { session: Session }) {
  const t = useTranslation()
  const [tab, setTab] = useState<Tab>('files')
  const [seenEntry, setSeenEntry] = useState(0)
  const { data: entries, setData: setEntries, error } = useLiveResource(clipboardHistory)
  const workspace = useRef<HTMLDivElement>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const latestEntry = entries?.[0]?.id ?? 0
  const hasNewEntry = tab === 'files' && latestEntry > seenEntry

  useEffect(() => {
    if (tab === 'clipboard') setSeenEntry((seen) => Math.max(seen, latestEntry))
  }, [tab, latestEntry])

  function isHeadingAboveViewport(heading: HTMLElement | null) {
    return !!heading && heading.getBoundingClientRect().top < (tabs.current?.offsetHeight ?? 0)
  }

  function revealTop() {
    workspace.current?.scrollIntoView({ block: 'start' })
  }

  function openTab(next: Tab) {
    if (next === tab) return
    if ((workspace.current?.getBoundingClientRect().top ?? 0) < 0) revealTop()
    setTab(next)
  }

  function moveTabFocus(event: KeyboardEvent<HTMLDivElement>) {
    let next: Tab
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tab === 'files' ? 'clipboard' : 'files'
    else if (event.key === 'Home') next = 'files'
    else if (event.key === 'End') next = 'clipboard'
    else return
    event.preventDefault()
    openTab(next)
    tabs.current?.querySelector<HTMLButtonElement>(`#${next}-tab`)?.focus({ preventScroll: true })
  }

  return <div className={styles.workspace} ref={workspace}>
    <div className={styles.tabs} ref={tabs} role="tablist" aria-label={t('Sharing')} onKeyDown={moveTabFocus}>
      <button id="files-tab" type="button" role="tab" aria-controls="files-panel" aria-selected={tab === 'files'}
        tabIndex={tab === 'files' ? 0 : -1} onClick={() => openTab('files')}><FileDirectoryIcon />{t('Files')}</button>
      <button id="clipboard-tab" type="button" role="tab" aria-controls="clipboard-panel" aria-selected={tab === 'clipboard'}
        tabIndex={tab === 'clipboard' ? 0 : -1} onClick={() => openTab('clipboard')}>
        <PasteIcon />{t('Clipboard')}{hasNewEntry && <span className={styles.unread} role="img" aria-label={t('New clipboard entries')} />}
      </button>
    </div>
    <div className={styles.tabPanel} id="files-panel" role="tabpanel" aria-labelledby="files-tab" hidden={tab !== 'files'}>
      <Files limit={session.maxFileBytes} host={session.host} visible={tab === 'files'}
        isHeadingAboveViewport={isHeadingAboveViewport} revealTop={revealTop} />
    </div>
    <div className={styles.tabPanel} id="clipboard-panel" role="tabpanel" aria-labelledby="clipboard-tab" hidden={tab !== 'clipboard'}>
      <Clipboard entries={entries} loadError={error}
        onEntryDeleted={(id) => setEntries((history) => history?.filter((entry) => entry.id !== id))} />
    </div>
  </div>
}
