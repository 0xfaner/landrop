import { useCallback, useRef, useState } from 'react'
import type { FileEntry } from './api'
import { containsPath, parentPath } from './paths'
import type { DropHandlers, DropSurface, DropTarget } from './types'

const entryDragType = 'application/x-landrop-entry'

interface FileDropOptions {
  busy: boolean
  upload: (data: DataTransfer, path: string) => void
  move: (item: FileEntry, folder: string) => void
}

function canMoveTo(item: FileEntry, target: string) {
  return parentPath(item.path) !== target && (!item.directory || !containsPath(item.path, target))
}

export function useFileDrop({ busy, upload, move }: FileDropOptions) {
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const draggingEntry = useRef<FileEntry | null>(null)

  const resetDrop = useCallback(() => {
    draggingEntry.current = null
    setDropTarget(null)
  }, [])

  function startDrag(item: FileEntry, data: DataTransfer) {
    draggingEntry.current = item
    data.effectAllowed = 'move'
    data.setData(entryDragType, item.id)
    setDropTarget(null)
  }

  function dropHandlers(path: string, surface: DropSurface): DropHandlers {
    const acceptsMove = surface !== 'list'
    return {
      'data-drop-target': (dropTarget?.surface === surface && dropTarget.path === path) || undefined,
      onDragOver(event) {
        const { dataTransfer } = event
        const internal = dataTransfer.types.includes(entryDragType)
        if (!internal && !dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        const item = draggingEntry.current
        const allowed = !busy && (!internal || (acceptsMove && item && canMoveTo(item, path)))
        dataTransfer.dropEffect = allowed ? (internal ? 'move' : 'copy') : 'none'
        setDropTarget((previous) => {
          if (!allowed) return null
          if (previous?.surface === surface && previous.path === path && previous.internal === internal) return previous
          return { path, surface, internal }
        })
      },
      onDragLeave(event) {
        event.stopPropagation()
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          setDropTarget((previous) => previous?.surface === surface && previous.path === path ? null : previous)
        }
      },
      onDrop(event) {
        const { dataTransfer } = event
        const internal = dataTransfer.types.includes(entryDragType)
        if (!internal && !dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        const item = draggingEntry.current
        resetDrop()
        if (busy) return
        if (!internal) {
          upload(dataTransfer, path)
        } else if (acceptsMove && item && dataTransfer.getData(entryDragType) === item.id && canMoveTo(item, path)) {
          move(item, path)
        }
      },
    }
  }

  return { dropTarget, dropHandlers, startDrag, resetDrop }
}
