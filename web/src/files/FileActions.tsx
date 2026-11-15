import { useLayoutEffect, useRef, type ReactNode } from 'react'
import menuStyles from '../components/menu.module.css'
import styles from './files.module.css'
import type { MenuAnchor } from './types'

interface FileActionProps {
  children: ReactNode
  icon?: ReactNode
  href?: string
  download?: string
  title?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

export function FileAction({ children, icon, href, download, title, danger, disabled, onClick }: FileActionProps) {
  const content = <>
    {icon}
    <span className={menuStyles.itemLabel}>{children}</span>
  </>
  const props = { className: menuStyles.item, title, 'data-danger': danger || undefined, onClick }
  return href ? <a href={href} download={download} {...props}>{content}</a>
    : <button type="button" disabled={disabled} {...props}>{content}</button>
}

export function FileActions({ trigger, point, onClose, children }: MenuAnchor & { onClose: (restoreFocus?: boolean) => void; children: ReactNode }) {
  const popover = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const panel = popover.current
    if (!panel) return
    panel.showPopover()

    const anchor = trigger.getBoundingClientRect()
    const width = document.documentElement.clientWidth
    const height = document.documentElement.clientHeight
    const left = Math.max(8, Math.min(point?.x ?? anchor.right - panel.offsetWidth, width - panel.offsetWidth - 8))
    const below = point?.y ?? anchor.bottom + 4
    const above = (point?.y ?? anchor.top - 4) - panel.offsetHeight
    const top = below + panel.offsetHeight <= height - 8
      ? below : Math.max(8, above)
    panel.style.left = left + 'px'
    panel.style.top = top + 'px'
    const initial = panel.querySelector<HTMLElement>('a, button:not(:disabled)')
    initial?.focus({ preventScroll: true })
    if (initial) panel.scrollTop = Math.max(0, initial.offsetTop + initial.offsetHeight - panel.clientHeight)

    const dismiss = (event: Event) => {
      if (event.type !== 'scroll' || !(event.target instanceof Node && panel.contains(event.target))) panel.hidePopover()
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [trigger, point])

  return <div ref={popover} popover="auto" className={`${styles.fileActions} ${menuStyles.surface}`}
    onToggle={(event) => {
      if (event.newState === 'closed') {
        const focused = document.activeElement
        onClose(focused === document.body || event.currentTarget.contains(focused))
      }
    }}>
    {children}
  </div>
}
