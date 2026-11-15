import { api, requestJson, requestNoContent } from '../api/http'

export interface FileEntry {
  id: string
  version: string
  path: string
  name: string
  directory: boolean
  size: number
  modified: string
}

export function listFiles(path: string, signal?: AbortSignal) {
  return requestJson<FileEntry[]>('/files?dir=' + encodeURIComponent(path), { signal })
}

export function openHostFolder() {
  return requestNoContent('/admin/open-folder', { method: 'POST' })
}

export function downloadURL(item: FileEntry) {
  return api + '/files/' + item.id
}

export function createFolder(path: string) {
  return requestNoContent('/folders?path=' + encodeURIComponent(path), { method: 'POST' })
}

export function moveEntry(item: FileEntry, target: string) {
  return requestNoContent(`/files/${item.id}?path=${encodeURIComponent(target)}`, {
    method: 'PATCH', headers: { 'If-Match': `"${item.version}"` },
  })
}

export function deleteEntry(item: FileEntry) {
  return requestNoContent(`/files/${item.id}${item.directory ? '?recursive=1' : ''}`, {
    method: 'DELETE', headers: { 'If-Match': `"${item.version}"` },
  })
}

export function uploadFile(file: File, path: string, onProgress: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${api}/files?name=${encodeURIComponent(path)}`)
    xhr.setRequestHeader('X-LanDrop', '1')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded)
    }
    xhr.onload = () => {
      if (xhr.status === 201) {
        resolve()
      } else {
        let message = `Upload failed (HTTP ${xhr.status})`
        try { message = JSON.parse(xhr.responseText).error || message } catch {}
        reject(new Error(message))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed because the connection was lost.'))
    xhr.send(file)
  })
}
