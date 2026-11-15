import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { useTranslation } from '../i18n'
import styles from './clipboard.module.css'

interface Props {
  target: RefObject<HTMLElement | null>
  controls: string
  onResize: (height: number) => void
}

export function ClipboardResizeHandle({ target, controls, onResize }: Props) {
  const t = useTranslation()
  const drag = useRef<{ id: number; y: number; height: number } | null>(null)

  function startResize(event: PointerEvent<HTMLButtonElement>) {
    const field = target.current
    if (!field || event.button !== 0 || drag.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, y: event.clientY, height: field.getBoundingClientRect().height }
  }

  function resize(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current
    if (start?.id === event.pointerId) applyHeight(start.height + event.clientY - start.y)
  }

  function stopResize(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null
  }

  function applyHeight(height: number) {
    const field = target.current
    if (!field) return
    const { minHeight, maxHeight } = getComputedStyle(field)
    const min = parseFloat(minHeight) || 0
    const max = parseFloat(maxHeight) || Infinity
    onResize(Math.min(max, Math.max(min, height)))
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0
    const field = target.current
    if (!step || !field) return
    event.preventDefault()
    applyHeight(field.getBoundingClientRect().height + step)
  }

  return <button type="button" className={styles.resizeHandle} aria-controls={controls}
    aria-label={t('Adjust editor height')} aria-keyshortcuts="ArrowUp ArrowDown"
    onPointerDown={startResize} onPointerMove={resize} onPointerUp={stopResize}
    onPointerCancel={stopResize} onLostPointerCapture={stopResize} onKeyDown={resizeWithKeyboard} />
}
