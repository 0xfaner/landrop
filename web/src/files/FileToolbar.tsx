import { useTranslation } from '../i18n'
import { useRef, type ChangeEvent } from 'react'
import { ActionList, ActionMenu } from '@primer/react'
import {
  FileDirectorySymlinkIcon, FileDirectoryIcon, FileIcon, ListUnorderedIcon,
  PlusIcon, UploadIcon, WorkflowIcon,
} from '@primer/octicons-react'
import { IconButton } from '../components/IconButton'
import type { View } from './types'
import type { UploadFile } from './transfer'
import styles from './files.module.css'
import ui from '../components/surfaces.module.css'
import menuStyles from '../components/menu.module.css'

interface FileToolbarProps {
  folder: string
  view: View
  host: boolean
  busy: boolean
  openingFolder: boolean
  onViewChange: (view: View) => void
  onUpload: (files: UploadFile[], target: string) => void
  onOpenFolder: () => void
  onCreate: () => void
}

export function FileToolbar({
  folder, view, host, busy, openingFolder, onViewChange, onUpload, onOpenFolder, onCreate,
}: FileToolbarProps) {
  const t = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const pickerTarget = useRef('')
  const tree = view === 'tree'

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [], (file) => ({ file, name: file.webkitRelativePath || file.name }))
    event.target.value = ''
    if (selected.length) onUpload(selected, pickerTarget.current)
  }

  function chooseUpload(picker: HTMLInputElement | null) {
    pickerTarget.current = folder
    picker?.click()
  }

  return <>
    <input ref={input} type="file" multiple hidden onChange={pickFiles} />
    <input ref={(node) => {
      folderInput.current = node
      node?.setAttribute('webkitdirectory', '')
    }} type="file" multiple hidden onChange={pickFiles} />
    <div className={styles.fileControls}>
      <div className={styles.fileViews} role="group" aria-label={t('File view')}>
        <IconButton icon={ListUnorderedIcon} label={t('List view')} aria-pressed={!tree} onClick={() => onViewChange('list')} />
        <IconButton icon={WorkflowIcon} label={t('Tree view')} aria-pressed={tree} onClick={() => onViewChange('tree')} />
      </div>
      <div className={`${ui.actions} ${styles.fileToolbar}`}>
        {host && <IconButton variant="default" icon={FileDirectorySymlinkIcon} label={t('Open folder on host')} disabled={openingFolder} onClick={onOpenFolder} />}
        <IconButton variant="default" label={t('New folder')} disabled={busy} onClick={onCreate}
          icon={<span className={styles.newFolderIcon}><FileDirectoryIcon /><PlusIcon size={10} /></span>} />
        <ActionMenu>
          <ActionMenu.Button leadingVisual={UploadIcon} className={styles.fileUpload} disabled={busy}>{t('Upload')}</ActionMenu.Button>
          <ActionMenu.Overlay align="end" className={menuStyles.surface}>
            <ActionList variant="full">
              <ActionList.Item onSelect={() => chooseUpload(input.current)}>
                <ActionList.LeadingVisual><FileIcon /></ActionList.LeadingVisual>{t('Upload files')}
              </ActionList.Item>
              <ActionList.Item onSelect={() => chooseUpload(folderInput.current)}>
                <ActionList.LeadingVisual><FileDirectoryIcon /></ActionList.LeadingVisual>{t('Upload folder')}
              </ActionList.Item>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </div>
    </div>
  </>
}
