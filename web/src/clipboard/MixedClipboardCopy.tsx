import { useEffect, useState } from 'react'
import { ClipboardCopyButton } from './ClipboardCopyButton'
import { imageURL, type ClipboardPart, type MixedEntry } from './api'

function asDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function richHTML(entry: MixedEntry, parts: ClipboardPart[], signal?: AbortSignal) {
  const nodes = await Promise.all(parts.map(async (part, index) => {
    if ('text' in part) {
      const paragraph = document.createElement('p')
      paragraph.style.whiteSpace = 'pre-wrap'
      paragraph.textContent = part.text
      return paragraph
    }
    const response = await fetch(imageURL(entry, false, index), { signal })
    if (!response.ok) throw new Error('Could not load the image.')
    const image = document.createElement('img')
    image.src = await asDataURL(await response.blob())
    image.alt = part.image.name
    return image
  }))
  const content = document.createElement('div')
  content.append(...nodes)
  return content.innerHTML
}

export function MixedClipboardCopy({ entry, parts }: { entry: MixedEntry; parts: ClipboardPart[] }) {
  const canWrite = typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined' && (ClipboardItem.supports?.('text/html') ?? true)
  const [preparedHTML, setPreparedHTML] = useState<string | null | undefined>()

  useEffect(() => {
    if (canWrite) return
    const controller = new AbortController()
    // The LAN HTTP fallback must have the image data ready when the user clicks.
    richHTML(entry, parts, controller.signal).then(
      (html) => { if (!controller.signal.aborted) setPreparedHTML(html) },
      () => { if (!controller.signal.aborted) setPreparedHTML(null) },
    )
    return () => controller.abort()
  }, [canWrite, entry, parts])

  async function copy() {
    const text = parts.map((part) => 'text' in part ? part.text : part.image.name).join('\n')
    if (canWrite) {
      const html = richHTML(entry, parts).then((value) => new Blob([value], { type: 'text/html' }))
      const write = async () => navigator.clipboard.write([new ClipboardItem({
        'text/html': html,
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
      await Promise.all([html, write()])
      return true
    }
    if (!preparedHTML) return false
    let copied = false
    const write = (event: ClipboardEvent) => {
      if (!event.clipboardData) return
      event.clipboardData.setData('text/html', preparedHTML)
      event.clipboardData.setData('text/plain', text)
      event.preventDefault()
      copied = true
    }
    document.addEventListener('copy', write)
    try {
      return document.execCommand('copy') && copied
    } finally {
      document.removeEventListener('copy', write)
    }
  }

  return <ClipboardCopyButton onCopy={copy} disabled={!canWrite && preparedHTML === undefined} />
}
