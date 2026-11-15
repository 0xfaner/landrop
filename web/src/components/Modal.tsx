import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import styles from './surfaces.module.css'

interface ModalProps {
  children: ReactNode
  labelledBy: string
  className?: string
  busy?: boolean
  initialFocus?: RefObject<HTMLElement | null>
  onClose: () => void
}

export function Modal({ children, labelledBy, className, busy, initialFocus, onClose }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    initialFocus?.current?.focus({ preventScroll: true })
    return () => dialog.close()
  }, [initialFocus])

  return <dialog ref={ref} aria-labelledby={labelledBy}
    className={className ? `${styles.dialog} ${className}` : styles.dialog}
    onCancel={(event) => {
      event.preventDefault()
      if (!busy) onClose()
    }}>
    {children}
  </dialog>
}
