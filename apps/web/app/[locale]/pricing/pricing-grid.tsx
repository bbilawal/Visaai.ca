'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { CountryFlag } from '@/components/ui/country-flag'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { isCountryInSiteScope, SITE_DEFAULT_COUNTRY } from '@/lib/site-config'

export interface PublicQuote {
  visa_type: string
  country_code: string
  price: number
  currency: string
}

// Display order (simple → complex). The "most popular" card is visually anchored (09 §2.1).
const VISA_ORDER = [
  'visitor',
  'tourist',
  'digital_nomad',
  'open_work_permit',
  'student',
  'work_permit',
  'citizenship',
  'family_sponsorship',
  'permanent_residency',
  'express_entry',
]
const RECOMMENDED = 'work_permit'

/**
 * Country-aware price grid (PRICE-5). Reads the public, margin-stripped quotes
 * from GET /pricing/quotes and lets the visitor switch destination corridor.
 * Charm prices come straight from the API (…9). No cost/margin is present in the
 * payload, so none can leak here.
 */
export function PricingGrid({ quotes }: { quotes: PublicQuote[] }) {
  const t = useTranslations('pricing')
  const locale = useLocale()

  const regionNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      return null
    }
  }, [locale])
  const countryName = (code: string) => regionNames?.of(code) ?? code

  const countries = useMemo(
    () =>
      [...new Set(quotes.map((q) => q.country_code))]
        .filter((c) => isCountryInSiteScope(c))
        .sort(),
    [quotes],
  )
  const [country, setCountry] = useState(() =>
    countries.includes('CA') ? 'CA' : (countries[0] ?? ''),
  )

  const rows = useMemo(
    () =>
      quotes
        .filter((q) => q.country_code === country)
        .sort(
          (a, b) =>
            VISA_ORDER.indexOf(a.visa_type) - VISA_ORDER.indexOf(b.visa_type),
        ),
    [quotes, country],
  )

  return (
    <div>
      {/* Canada site: one destination, so no corridor switcher. */}
      {!SITE_DEFAULT_COUNTRY && (
        <>
          <p className="mb-3 text-center text-[13px] font-medium text-rich-black">
            {t('selectCountry')}
          </p>
          <div role="tablist" className="mb-8 flex flex-wrap justify-center gap-2">
            {countries.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={c === country}
                onClick={() => setCountry(c)}
                className={cn('btn btn-xs', c === country ? 'btn-primary' : 'btn-outline')}
              >
                <CountryFlag code={c} size="sm" decorative /> {countryName(c)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((q) => {
          const rec = q.visa_type === RECOMMENDED
          return (
            <Card
              key={q.visa_type}
              variant={rec ? 'glow' : 'default'}
              className="flex flex-col"
            >
              {rec && (
                <span className="badge badge-accent mb-2 self-start">
                  {t('recommended')}
                </span>
              )}
              <h2 className="type-h3 mb-1">{t(`visa.${q.visa_type}`)}</h2>
              <p className="mb-1">
                <span className="text-[28px] font-semibold tracking-[-0.5px] text-deep-black">
                  ${q.price}
                </span>
                <span className="text-[13px] text-midtone-gray"> {q.currency}</span>
              </p>
              <p className="mb-4 text-[12px] text-midtone-gray">{t('perApplication')}</p>
              <Link href="/applications/new" className="btn btn-primary btn-block mt-auto">
                {t('cta')}
              </Link>
            </Card>
          )
        })}
      </div>

      <p className="mt-6 text-center text-[12px] text-midtone-gray">{t('govFeeNote')}</p>
    </div>
  )
}
