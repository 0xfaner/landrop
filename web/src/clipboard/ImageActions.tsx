import { useTranslation } from '../i18n'
import { DownloadIcon } from '@primer/octicons-react'
import { IconLink } from '../components/IconButton'
import { ClipboardCopyButton } from './ClipboardCopyButton'
import { imageForCopy } from './browserClipboard'
import { imageURL, type ImageEntry } from './api'

type Props = { entry: ImageEntry }

export function ImageCopy({ entry }: Props) {
  async function copy() {
    const png = imageForCopy(imageURL(entry))
    // Keep the clipboard call inside the click, even when fetching the PNG takes longer.
    const write = async () => navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    await Promise.all([png, write()])
    return true
  }

  return <ClipboardCopyButton onCopy={copy} />
}

export function ImageDownload({ entry }: Props) {
  const t = useTranslation()
  return <IconLink icon={DownloadIcon} label={t('Download image')} href={imageURL(entry, true)} download={entry.name} />
}

