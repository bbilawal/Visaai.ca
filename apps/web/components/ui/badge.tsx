import { cn } from '@/lib/utils'

type BadgeVariant =
  | 'outline'
  | 'inverse'
  | 'accent'
  | 'neutral'
  | 'cyan'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'violet'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  outline: '',
  inverse: 'badge-inverse',
  accent: 'badge-accent',
  neutral: 'badge-neutral',
  cyan: 'badge-cyan',
  emerald: 'badge-emerald',
  amber: 'badge-amber',
  rose: 'badge-rose',
  violet: 'badge-violet',
}

export function Badge({ className, variant = 'outline', children, ...props }: BadgeProps) {
  return (
    <span className={cn('badge', VARIANT_CLASS[variant], className)} {...props}>
      {children}
    </span>
  )
}
