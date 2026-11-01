import { cn } from '@/lib/utils'

type CardVariant = 'default' | 'tight' | 'snug' | 'feature' | 'glow'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  hover?: boolean
}

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: 'card',
  tight: 'card card-tight',
  snug: 'card card-snug',
  feature: 'card card-feature',
  glow: 'card card-glow',
}

export function Card({ className, variant = 'default', hover, children, ...props }: CardProps) {
  return (
    <div className={cn(VARIANT_CLASS[variant], hover && 'card-hover', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-2', className)} {...props} />
}

/**
 * Renders `<h2>` by default, which is right for a card sitting inside a page
 * that already has its own title.
 *
 * `as` exists because on the single-card pages — forgot-password,
 * reset-password — the card title IS the page title, and those pages therefore
 * had no `<h1>` at all (WEB-011). The level is a property of where the card
 * sits, so it belongs at the call site; hardcoding `h2` here made it
 * unexpressible.
 */
export function CardTitle({
  className,
  as: Tag = 'h2',
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' }) {
  return <Tag className={cn('h-2', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-muted', className)} {...props} />
}
