import { cn } from '@/lib/utils'

type AlertVariant = 'error' | 'success' | 'info'

const VARIANT: Record<AlertVariant, string> = {
  error: 'alert-error',
  success: 'alert-success',
  info: 'alert-info',
}

export function Alert({
  variant = 'info',
  children,
  className,
}: {
  variant?: AlertVariant
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('alert', VARIANT[variant], className)}
    >
      {children}
    </div>
  )
}
