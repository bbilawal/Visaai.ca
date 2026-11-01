'use client'

import { useState } from 'react'
import { Input } from './input'
import { EyeIcon, EyeOffIcon } from './icons'
import { cn } from '@/lib/utils'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

export function PasswordInput({ className, ...props }: Props) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        className={cn('pe-11', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-pressed={show}
        aria-label={show ? 'Hide password' : 'Show password'}
        // WCAG 2.2 §2.5.8 Target Size (Minimum): 24×24 CSS px. The icon is
        // 16px, so the button needs its own minimum size — padding alone left
        // it at 22px and axe flagged it.
        className="absolute end-1 top-1/2 flex min-h-[24px] min-w-[24px] -translate-y-1/2 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-colors duration-150 hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      >
        {show ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
      </button>
    </div>
  )
}
