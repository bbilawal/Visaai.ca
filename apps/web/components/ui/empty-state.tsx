import { cn } from '@/lib/utils'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-16 px-6', className)}>
      {icon && <div className="mb-4 text-pale-stone">{icon}</div>}
      <h3 className="font-serif text-[20px] text-deep-black">{title}</h3>
      {description && (
        <p className="mt-1 max-w-[360px] text-[13px] text-midtone-gray">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
