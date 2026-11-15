import { useRef, useState } from 'react'
import { errorMessage, RequestError } from '../api/http'
import { openHostFolder } from './api'
import { uploadBatch, type UploadFailure, type UploadFile, type UploadProgress } from './transfer'

export function useFileCommands(limit: number, onEntryChanged: () => void) {
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | UploadFailure[]>('')
  const [progress, setProgress] = useState<(UploadProgress & { target: string }) | null>(null)
  const [openingFolder, setOpeningFolder] = useState(false)

  async function run(command: () => Promise<void>) {
    if (active.current) return
    active.current = true
    setBusy(true)
    setError('')
    try {
      await command()
    } catch (error) {
      if (error instanceof RequestError && error.status === 412) onEntryChanged()
      setError(errorMessage(error))
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  function upload(getFiles: () => UploadFile[] | Promise<UploadFile[]>, target: string, onUploaded: (target: string) => void) {
    return run(async () => {
      let files: UploadFile[]
      try {
        files = await getFiles()
      } catch {
        setError('Could not read the dropped files.')
        return
      }
      if (!files.length) return
      try {
        const { sent, failures } = await uploadBatch(files, target, limit, (update) => setProgress({ ...update, target }))
        setError(failures)
        if (sent) onUploaded(target)
      } finally {
        setProgress(null)
      }
    })
  }

  async function openSharedFolder() {
    setOpeningFolder(true)
    setError('')
    try {
      await openHostFolder()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setOpeningFolder(false)
    }
  }

  return { busy, error, clearError: () => setError(''), progress, openingFolder, run, upload, openSharedFolder }
}
