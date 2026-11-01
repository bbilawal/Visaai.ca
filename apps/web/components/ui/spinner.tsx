import { cn } from '@/lib/utils'

export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const px = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', px, className)}
    />
  )
}
