'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useTheme } from '@/components/providers/theme-provider'

/**
 * Appearance settings.
 *
 * The theme control lives here as well as in the desktop sidebar, because the
 * sidebar collapses to a top bar on a phone with no room for it. A preference
 * a user can only change on a large screen is not a preference.
 */
export function AppearanceSection() {
  const t = useTranslations('nav')
  const { preference, resolved } = useTheme()

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-1 text-[13px] font-semibold text-rich-black">
          {t('theme')}
        </h2>
        <p className="mb-4 text-[12px] text-midtone-gray">
          {preference === 'system'
            ? `Following your device setting (currently ${resolved}).`
            : `Always ${preference}.`}
        </p>
        <ThemeToggle />
      </CardContent>
    </Card>
  )
}
