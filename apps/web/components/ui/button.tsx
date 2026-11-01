import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './spinner'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success'
type ButtonSize = 'default' | 'sm' | 'xs' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  loading?: boolean
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  danger: 'btn-danger',
  success: 'btn-success',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  default: '',
  sm: 'btn-sm',
  xs: 'btn-xs',
  lg: 'btn-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'default', block, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={loading || disabled}
        className={cn('btn', VARIANT_CLASS[variant], SIZE_CLASS[size], block && 'btn-block', className)}
        {...props}
      >
        {loading && <Spinner size="sm" className="me-2 align-[-2px]" />}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
