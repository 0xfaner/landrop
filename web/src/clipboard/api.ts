import { api, requestJson, requestNoContent, requestText } from '../api/http'

type Entry = { id: number; created: string }
type ImageInfo = { type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; name: string }
export type TextEntry = Entry & { type: 'text/plain'; preview: string; hasMore?: boolean }
export type ImageEntry = Entry & ImageInfo
export type MixedEntry = Entry & { type: 'application/json'; thumb: number; preview?: string; hasMore?: boolean }
export type ClipboardEntry = TextEntry | ImageEntry | MixedEntry
export type ClipboardPart = { text: string } | { image: ImageInfo }

const historyPath = '/clipboard'
const entryPath = (id: number) => `${historyPath}/${id}`

export function listClipboardHistory(signal?: AbortSignal) {
  return requestJson<ClipboardEntry[]>(historyPath, { signal })
}

export function readText(entry: TextEntry, signal?: AbortSignal) {
  return entry.hasMore ? requestText(entryPath(entry.id), { signal }) : Promise.resolve(entry.preview)
}

export function readParts(entry: MixedEntry) {
  return requestJson<ClipboardPart[]>(entryPath(entry.id))
}

export function addEntry(body: string | File | FormData) {
  const path = body instanceof File ? `${historyPath}?name=${encodeURIComponent(body.name)}` : historyPath
  return requestNoContent(path, { method: 'POST', body })
}

export function editText(id: number, body: string) {
  return requestNoContent(entryPath(id), { method: 'PATCH', body })
}

export function deleteEntry(id: number) {
  return requestNoContent(entryPath(id), { method: 'DELETE' })
}

export function clearHistory() {
  return requestNoContent(historyPath, { method: 'DELETE' })
}

export function imageURL(entry: Pick<ImageEntry, 'id'>, download = false, part?: number) {
  const path = part === undefined ? entryPath(entry.id) : `${entryPath(entry.id)}/images/${part}`
  return api + path + (download ? '?download=1' : '')
}
