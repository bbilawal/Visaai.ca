import { cn } from '@/lib/utils'

export function OnboardingProgress({ step, labels }: { step: number; labels: string[] }) {
  return (
    <ol className="flex items-center justify-center gap-2" aria-label="Onboarding progress">
      {labels.map((label, i) => {
        const n = i + 1
        const active = n === step
        const done = n < step
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] border',
                done
                  ? 'bg-deep-black text-canvas-white border-deep-black'
                  : active
                    ? 'border-deep-black text-deep-black'
                    : 'border-subtle-ash text-faint-text',
              )}
            >
              {n}
            </span>
            <span className={cn('text-[12px]', active ? 'text-rich-black' : 'text-faint-text')}>{label}</span>
            {n < labels.length && <span aria-hidden="true" className="mx-1 h-px w-6 bg-subtle-ash" />}
          </li>
        )
      })}
    </ol>
  )
}
