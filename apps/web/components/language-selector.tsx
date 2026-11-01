'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { LOCALES, LOCALE_LABELS } from '@/i18n/config'
import { usePathname, useRouter } from '@/i18n/navigation'
import { setLocale } from '@/app/actions/set-locale'

export interface LanguageSelectorProps {
  /**
   * When true, also persist the choice to the logged-in user's account
   * (cross-device) via PATCH /me/language. Pass true on authed surfaces.
   */
  persistToAccount?: boolean
  className?: string
}

/**
 * Language switcher. Sets the NEXT_LOCALE cookie (refresh/logout-persistent) and,
 * for logged-in users, best-effort persists to the account for cross-device.
 * Then refreshes so server components re-render in the new locale.
 */
export function LanguageSelector({
  persistToAccount = false,
  className,
}: LanguageSelectorProps) {
  const locale = useLocale()
  const t = useTranslations('language')
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  function handleChange(next: string) {
    startTransition(async () => {
      // Keep the cookie in sync (fallback + cross-request persistence)…
      await setLocale(next)
      if (persistToAccount) {
        try {
          const { getSession } = await import('@/lib/supabase/client')
          const {
            data: { session },
          } = await getSession()
          if (session) {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/me/language`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ language: next }),
            })
          }
        } catch {
          // Non-fatal: the cookie already holds the choice.
        }
      }
      // …then navigate to the locale-prefixed URL (the URL drives the locale in
      // sub-path routing). next-intl's router adds/strips the prefix as needed.
      router.replace(pathname, { locale: next })
    })
  }

  return (
    <label className={className}>
      <span className="sr-only">{t('select')}</span>
      <select
        aria-label={t('select')}
        value={locale}
        disabled={pending}
        onChange={(e) => handleChange(e.target.value)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l].native}
          </option>
        ))}
      </select>
    </label>
  )
}
