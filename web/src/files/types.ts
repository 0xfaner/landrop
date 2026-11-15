import type { DragEventHandler } from 'react'
import type { FileEntry } from './api'

export const sortOptions = [
  ['name-asc', 'Name (A–Z)'],
  ['name-desc', 'Name (Z–A)'],
  ['modified-desc', 'Newest first'],
  ['modified-asc', 'Oldest first'],
  ['size-desc', 'Largest first'],
  ['size-asc', 'Smallest first'],
] as const

export type View = 'list' | 'tree'
export type SortOrder = typeof sortOptions[number][0]
export type FileActionKind = 'rename' | 'move' | 'delete'
export type FileOperation = { kind: 'create'; folder: string } | { kind: FileActionKind; item: FileEntry }

export interface MenuAnchor {
  trigger: HTMLButtonElement
  point?: { x: number; y: number } | null
}

export type DropSurface = 'list' | 'row' | 'breadcrumb' | 'parent'
export interface DropTarget {
  path: string
  surface: DropSurface
  internal: boolean
}

export interface DropHandlers {
  'data-drop-target'?: boolean
  onDragOver: DragEventHandler<HTMLElement>
  onDragLeave: DragEventHandler<HTMLElement>
  onDrop: DragEventHandler<HTMLElement>
}
