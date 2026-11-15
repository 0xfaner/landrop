import { readText, type TextEntry } from './api'
import styles from './clipboard.module.css'

export const canCopyImage = window.isSecureContext && typeof navigator.clipboard?.write === 'function' &&
  typeof ClipboardItem !== 'undefined' && (ClipboardItem.supports?.('image/png') ?? true)

export function copySelection(field: HTMLTextAreaElement | HTMLInputElement) {
  const previous = document.activeElement
  field.focus({ preventScroll: true })
  field.select()
  let copied = false
  try { copied = document.execCommand('copy') } catch {}
  if (copied && previous instanceof HTMLElement) previous.focus({ preventScroll: true })
  return copied
}

export async function imageForCopy(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load the image.')
  const blob = await response.blob()
  if (blob.type === 'image/png') return blob
  const objectURL = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = objectURL
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not open the image canvas.')
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => {
      if (png) resolve(png)
      else reject(new Error('Could not convert the image to PNG.'))
    }, 'image/png'))
  } finally {
    URL.revokeObjectURL(objectURL)
  }
}

export async function copyEntryText(entry: TextEntry) {
  try {
    if (entry.hasMore) {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
      const value = readText(entry).then((text) => new Blob([text], { type: 'text/plain' }))
      await Promise.all([value, navigator.clipboard.write([new ClipboardItem({ 'text/plain': value })])])
    } else {
      await navigator.clipboard.writeText(entry.preview)
    }
    return true
  } catch {
    if (entry.hasMore) return false
    const field = document.createElement('textarea')
    const previous = document.activeElement
    field.value = entry.preview
    field.readOnly = true
    field.className = styles.clipCopyBuffer
    document.body.append(field)
    const copied = copySelection(field)
    field.remove()
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
    return copied
  }
}
