import { useEffect, useRef, useState, type KeyboardEvent, type SubmitEvent } from 'react'
import { Button, Heading } from '@primer/react'
import { useTranslation } from '../i18n'
import { ClipboardResizeHandle } from './ClipboardResizeHandle'
import { draftImageSelector, editorSelection, insertFragment, readDraft, readPastedParts, type DraftPart } from './clipboardDraft'
import { downloadLinkedImage, pendingImageSelector, readLinkedImage, type LinkedImage } from './linkedImage'
import { exceedsTextLimit, imageTypes, maxImageBytes, maxImages } from './limits'
import styles from './clipboard.module.css'
import ui from '../components/surfaces.module.css'

interface ComposerProps {
  busy: boolean
  problem: string
  onReset: () => void
  onAdd: (body: string | File | FormData, complete: () => void) => void
}

type ImageDownload = { controller: AbortController; bytes: number }
const maxConcurrentImageDownloads = 8

function cancelDownloads(downloads: Map<HTMLElement, ImageDownload>) {
  for (const download of downloads.values()) download.controller.abort()
  downloads.clear()
}

export function ClipboardComposer({ busy, problem, onReset, onAdd }: ComposerProps) {
  const t = useTranslation()
  const editor = useRef<HTMLDivElement>(null)
  const savedSelection = useRef<Range | null>(null)
  const imageFiles = useRef(new Map<string, File>())
  const downloads = useRef(new Map<HTMLElement, ImageDownload>()).current
  const draftImageBytes = useRef(0)
  const [parts, setParts] = useState<DraftPart[]>([])
  const [height, setHeight] = useState<number>()
  const [error, setError] = useState('')
  const shareParts = parts.filter((part) => typeof part === 'string' || part instanceof File)
  const text = shareParts.filter((part) => typeof part === 'string').join('')
  const images = shareParts.filter((part) => part instanceof File)
  const textTooLong = exceedsTextLimit(text)
  const canAdd = !busy && !textTooLong && shareParts.length === parts.length && (images.length > 0 || text.trim() !== '')
  const clipboardImages = imageFiles.current

  useEffect(() => () => {
    cancelDownloads(downloads)
    for (const url of clipboardImages.keys()) URL.revokeObjectURL(url)
    clipboardImages.clear()
  }, [clipboardImages, downloads])

  function syncDraft(field: HTMLElement) {
    const next = readDraft(field, clipboardImages)
    draftImageBytes.current = next.reduce((total, part) => total + (part instanceof File ? part.size : 0), 0)
    setParts(next)
  }

  function updateDraft() {
    const field = editor.current
    if (!field) return
    syncDraft(field)
    savedSelection.current = editorSelection(field)?.cloneRange() ?? savedSelection.current
    setError('')
    onReset()

    for (const [placeholder, download] of downloads) {
      if (field.contains(placeholder) && placeholder.matches(pendingImageSelector)) continue
      downloads.delete(placeholder)
      download.controller.abort()
    }
    fillImageDownloadSlots(field)
  }

  function fillImageDownloadSlots(field: HTMLElement) {
    for (const placeholder of field.querySelectorAll<HTMLElement>(pendingImageSelector)) {
      if (downloads.size >= maxConcurrentImageDownloads) break
      if (downloads.has(placeholder)) continue
      const part = readLinkedImage(placeholder.dataset.clipboardImage ?? '', placeholder.dataset.linkText)
      if (part) void loadImage(field, placeholder, part)
    }
  }

  function imageElement(file: File) {
    const url = URL.createObjectURL(file)
    clipboardImages.set(url, file)
    const image = document.createElement('img')
    image.src = url
    image.alt = file.name || t('Pasted image')
    image.draggable = false
    return image
  }

  function discardImage(image: HTMLImageElement) {
    URL.revokeObjectURL(image.src)
    clipboardImages.delete(image.src)
  }

  function totalImageBytes(nodes: Iterable<Element>) {
    let total = 0
    for (const node of nodes) total += clipboardImages.get(node.getAttribute('src') ?? '')?.size ?? 0
    return total
  }

  function insert(incoming: DraftPart[], range?: Range) {
    const field = editor.current
    if (busy || !field || !incoming.length) return false
    const files = incoming.filter((part) => part instanceof File)
    if (files.some((file) => file.type && !imageTypes.includes(file.type))) {
      setError('Choose a PNG, JPEG, WebP, or GIF image.')
      return false
    }
    const at = range ?? editorSelection(field) ?? savedSelection.current
    const remaining = [...field.querySelectorAll(draftImageSelector)]
      .filter((image) => !at || at.collapsed || !at.intersectsNode(image))
    if (remaining.length + incoming.filter((part) => typeof part !== 'string').length > maxImages) {
      setError('A clipboard entry can include up to 64 images.')
      return false
    }
    if (totalImageBytes(remaining) + files.reduce((total, file) => total + file.size, 0) > maxImageBytes) {
      setError('Images must total 256 MiB or less per entry.')
      return false
    }
    const fragment = document.createDocumentFragment()
    for (const part of incoming) {
      if (typeof part === 'string') {
        for (const [index, line] of part.replace(/\r\n?/g, '\n').split('\n').entries()) {
          if (index) fragment.append(document.createElement('br'))
          if (line) fragment.append(line)
        }
        continue
      }
      if (part instanceof File) {
        fragment.append(imageElement(part))
        continue
      }
      const placeholder = document.createElement('div')
      placeholder.dataset.clipboardImage = part.url.href
      if (part.text !== undefined) placeholder.dataset.linkText = part.text
      placeholder.dataset.pending = ''
      placeholder.className = styles.clipImagePlaceholder
      placeholder.setAttribute('aria-hidden', 'true')
      placeholder.contentEditable = 'false'
      fragment.append(placeholder)
    }
    insertFragment(field, fragment, at)
    updateDraft()
    return true
  }

  function add(event: SubmitEvent<HTMLFormElement> | KeyboardEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canAdd) return
    setError('')
    let body: string | File | FormData = text
    if (images.length === 1 && text === '') {
      body = images[0]
    } else if (images.length) {
      const data = new FormData()
      for (const part of shareParts) {
        if (typeof part === 'string') data.append('text', new Blob([part], { type: 'text/plain' }), 'text.txt')
        else data.append('image', part)
      }
      body = data
    }
    onAdd(body, () => {
      cancelDownloads(downloads)
      editor.current?.replaceChildren()
      savedSelection.current = null
      draftImageBytes.current = 0
      setParts([])
      for (const url of clipboardImages.keys()) URL.revokeObjectURL(url)
      clipboardImages.clear()
    })
  }

  async function loadImage(field: HTMLElement, placeholder: HTMLElement, part: LinkedImage) {
    const download = { controller: new AbortController(), bytes: 0 }
    downloads.set(placeholder, download)
    let image: HTMLImageElement | undefined
    try {
      const file = await downloadLinkedImage(part.url, download.controller.signal, (size) => {
        let total = draftImageBytes.current + size
        for (const other of downloads.values()) {
          if (other !== download) total += other.bytes
        }
        if (download.controller.signal.aborted || total > maxImageBytes) return false
        download.bytes = size
        return true
      })
      if (download.controller.signal.aborted) return
      image = imageElement(file)
      await image.decode()
    } catch {
      if (image) discardImage(image)
      image = undefined
    }
    const current = downloads.get(placeholder) === download
    if (current) downloads.delete(placeholder)
    if (!current || !field.contains(placeholder)) {
      if (image) discardImage(image)
      return
    }

    delete placeholder.dataset.pending
    placeholder.classList.remove(styles.clipImagePlaceholder)
    placeholder.removeAttribute('aria-hidden')
    if (image && draftImageBytes.current + download.bytes <= maxImageBytes) {
      delete placeholder.dataset.clipboardImage
      delete placeholder.dataset.linkText
      placeholder.replaceChildren(image)
    } else {
      if (image) discardImage(image)
      const link = document.createElement('a')
      link.href = part.url.href
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = part.text ?? part.url.href
      link.className = styles.clipLinkedImage
      placeholder.replaceChildren(link)
    }
    syncDraft(field)
    fillImageDownloadSlots(field)
  }

  return <form className={`${ui.panel} ${styles.clipCard}`} aria-label={t('Add to clipboard')} onSubmit={add}
    onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.nativeEvent.isComposing) add(event)
    }}>
    <div className={styles.clipHeading}>
      <Heading as="h2">{t('Clipboard')}</Heading>
      <div className={`${ui.actions} ${styles.clipActions}`}>
        <Button type="submit" size="small" disabled={!canAdd}>{t('Share')}</Button>
      </div>
    </div>
    <div className={styles.composer}>
      <div ref={editor} id="shared-text" className={styles.composerInput} contentEditable={!busy}
        style={{ height }} role="textbox" aria-multiline="true" aria-label={t('Clipboard text')}
        aria-readonly={busy} aria-invalid={textTooLong || undefined} aria-describedby="clip-status"
        data-placeholder={t('Paste text or an image')} data-empty={parts.length === 0 || undefined}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} dir="auto"
        onInput={updateDraft}
        onBlur={(event) => {
          savedSelection.current = editorSelection(event.currentTarget)?.cloneRange() ?? savedSelection.current
        }}
        onPaste={(event) => {
          event.preventDefault()
          if (!busy) insert(readPastedParts(event.clipboardData))
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          const range = document.caretRangeFromPoint?.(event.clientX, event.clientY) ?? undefined
          const files = Array.from(event.dataTransfer.files)
          const text = event.dataTransfer.getData('text/plain')
          insert(files.length ? files : text ? [text] : [], range)
        }} />
      <ClipboardResizeHandle target={editor} controls="shared-text" onResize={setHeight} />
    </div>
    <p id="clip-status" role="status" className={ui.error}>
      {t(error || (textTooLong ? 'Text exceeds 256 KiB.' : problem))}
    </p>
  </form>
}
