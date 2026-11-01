'use client'

import { scorePassword } from '@/lib/auth/password-strength'
import { CheckIcon } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

const RULES: Array<{ key: keyof ReturnType<typeof scorePassword>['checks']; label: string }> = [
  { key: 'len', label: 'At least 8 characters' },
  { key: 'upper', label: 'Uppercase letter' },
  { key: 'lower', label: 'Lowercase letter' },
  { key: 'number', label: 'Number' },
  { key: 'special', label: 'Special character' },
]

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score, checks } = scorePassword(password)
  if (!password) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map(i => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-200',
              i < score
                ? score <= 2
                  ? 'bg-callout-red'
                  : score <= 4
                    ? 'bg-amber'
                    : 'bg-success-green'
                : 'bg-subtle-ash',
            )}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-1" aria-label="Password requirements">
        {RULES.map(r => (
          <li
            key={r.key}
            className={cn(
              'flex items-center gap-1.5 text-[11px]',
              checks[r.key] ? 'text-success-green' : 'text-faint-text',
            )}
          >
            <CheckIcon
              aria-hidden={true}
              className={cn('h-3 w-3', checks[r.key] ? 'opacity-100' : 'opacity-30')}
            />
            {r.label}
            <span className="sr-only">{checks[r.key] ? '— met' : '— not yet met'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
