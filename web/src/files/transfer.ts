import { errorMessage } from '../api/http'
import { joinPath } from './paths'
import { uploadFile } from './api'

export interface UploadFile {
  file: File
  name: string
}

export interface UploadProgress {
  fileName?: string
  finished: number
  total: number
  value: number
}

export interface UploadFailure {
  name: string
  message: string
  values?: { size: string; limit: string }
}

export function formatSize(bytes: number) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log2(bytes || 1) / 10)))
  return `${(bytes / 1024 ** i).toLocaleString('en', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`
}

export async function uploadBatch(files: UploadFile[], target: string, limit: number, onProgress: (progress: UploadProgress) => void) {
  const totalBytes = files.reduce((sum, { file }) => sum + file.size, 0)
  const failures: UploadFailure[] = []
  let next = 0
  let finished = 0
  let sent = 0
  let uploadedBytes = 0
  let frame: number | null = null

  function report() {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      const fraction = totalBytes ? uploadedBytes / totalBytes : finished / files.length
      onProgress({ fileName: files.length === 1 ? files[0].name : undefined, finished, total: files.length, value: Math.min(100, Math.round(fraction * 100)) })
    })
  }

  async function worker() {
    while (next < files.length) {
      const index = next++
      const { file, name } = files[index]
      let uploaded = 0
      function update(bytes: number) {
        uploadedBytes += bytes - uploaded
        uploaded = bytes
        report()
      }

      try {
        if (limit > 0 && file.size > limit) {
          failures[index] = {
            name,
            message: 'This file is {size}. The host limits uploads to {limit} per file.',
            values: { size: formatSize(file.size), limit: formatSize(limit) },
          }
          continue
        }
        await uploadFile(file, joinPath(target, name), (bytes) => update(Math.min(bytes, file.size)))
        update(file.size)
        sent++
      } catch (error) {
        failures[index] = { name, message: errorMessage(error) }
      } finally {
        finished++
        report()
      }
    }
  }

  report()
  try {
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker))
    return { sent, failures: failures.filter(Boolean) }
  } finally {
    if (frame !== null) cancelAnimationFrame(frame)
  }
}

export async function droppedFiles(transfer: DataTransfer) {
  const items = Array.from(transfer.items).filter((item) => item.kind === 'file')
  const entries = items.map((item) => ({
    entry: item.webkitGetAsEntry?.(),
    file: item.getAsFile(),
  }))
  if (!entries.length) return Array.from(transfer.files).map((file) => ({ file, name: file.name }))

  const files: UploadFile[] = []
  async function walk(entry: FileSystemEntry, folder: string) {
    const name = joinPath(folder, entry.name)
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      files.push({ file, name })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        for (const child of batch) await walk(child, name)
      }
    }
  }

  for (const { entry, file } of entries) {
    if (entry) await walk(entry, '')
    else if (file) files.push({ file, name: file.name })
  }
  return files
}
