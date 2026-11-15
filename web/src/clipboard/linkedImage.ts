import { maxImageBytes } from './limits'

export type LinkedImage = { url: URL; text?: string }

export const linkedImageSelector = '[data-clipboard-image]'
export const pendingImageSelector = `${linkedImageSelector}[data-pending]`

export function readLinkedImage(value: string, text?: string): LinkedImage | undefined {
  if (value.length > 8192) return
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return
  const host = url.hostname.replace(/\.$/, '')
  if (!host.includes('.') || /^\d+(\.\d+)+$/.test(host) || /\.(localhost|local|internal|home\.arpa)$/.test(host)) return
  url.hash = ''
  return { url, text }
}

export function readImageLink(text: string) {
  const image = readLinkedImage(text.trim(), text)
  return image && /\.(png|jpe?g|webp|gif)$/i.test(image.url.pathname) ? image : undefined
}

export async function downloadLinkedImage(url: URL, signal: AbortSignal, reserve: (size: number) => boolean) {
  const response = await fetch(url, {
    mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxImageBytes) {
    await response.body?.cancel()
    throw new Error('Image response unavailable or too large')
  }

  const chunks: Uint8Array<ArrayBuffer>[] = []
  const reader = response.body.getReader()
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxImageBytes || !reserve(size)) {
        await reader.cancel()
        throw new Error('Image response too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const blob = new Blob(chunks)
  const type = imageType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
  if (!type) throw new Error('Unsupported image format')
  const name = url.pathname.split('/').at(-1)
  return new File([blob], name || `clipboard.${type.split('/')[1]}`, { type })
}

function imageType(bytes: Uint8Array) {
  const signature = String.fromCharCode(...bytes)
  if (signature.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
  if (signature.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif'
  if (signature.startsWith('RIFF') && signature.slice(8, 14) === 'WEBPVP') return 'image/webp'
}
