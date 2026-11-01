'use client'

import { useTranslations } from 'next-intl'
import { useFlag } from '@/components/providers/feature-flags-provider'

/**
 * Closed-beta notice.
 *
 * Task 15 §3 requires beta warnings, and the AI-safety review requires the
 * product never to present itself as a licensed professional or as a
 * substitute for one. Those two obligations land in the same banner: the copy
 * says both "this is a beta" and "do not rely on it for a real filing".
 *
 * `role="status"` rather than `role="alert"`: alert is assertive and would
 * interrupt a screen-reader user mid-sentence on every page load, which is
 * hostile for a message that never changes. It sits in the document before
 * main content so it is still encountered early in reading order.
 */
export function BetaBanner() {
  const enabled = useFlag('beta_banner_enabled')
  const t = useTranslations('beta')

  if (!enabled) return null

  return (
    <div
      role="status"
      className="w-full border-b border-hairline-2 bg-atmosphere-wash px-4 py-2 text-center text-sm text-ink"
    >
      <strong className="font-semibold">{t('bannerTitle')}</strong>{' '}
      <span>{t('bannerBody')}</span>
    </div>
  )
}
