import type { ComponentPropsWithRef } from 'react'
import { IconButton as PrimerIconButton, type IconButtonProps as PrimerIconButtonProps } from '@primer/react'
import styles from './controls.module.css'

type IconAction = Pick<PrimerIconButtonProps, 'icon' | 'size' | 'variant' | 'description' | 'tooltipDirection' | 'loading'> & {
  label: string
}

type ButtonProps = IconAction & Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'aria-labelledby' | 'children'>
type LinkProps = IconAction & Pick<ComponentPropsWithRef<'a'>, 'className' | 'ref' | 'download'> & { href: string }

export function IconButton({ label, className, type = 'button', variant = 'invisible', ...props }: ButtonProps) {
  return <PrimerIconButton as="button" type={type} variant={variant} aria-label={label}
    className={className ? `${styles.iconButton} ${className}` : styles.iconButton} {...props} />
}

export function IconLink({ label, className, variant = 'invisible', ...props }: LinkProps) {
  return <PrimerIconButton as="a" variant={variant} aria-label={label}
    className={className ? `${styles.iconButton} ${className}` : styles.iconButton} {...props} />
}
