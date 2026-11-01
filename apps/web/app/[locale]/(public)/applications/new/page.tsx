'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { ensureSession } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CountryCombobox } from '@/components/ui/country-combobox'
import { LanguageSelector } from '@/components/language-selector'
import { useSupportedCountries } from '@/lib/use-supported-countries'
import { SITE_CONFIG } from '@/lib/site-config'

export default function NewApplicationPage() {
  const t = useTranslations('application')
  const router = useRouter()
  const [country, setCountry] = useState('')
  const [state, setState] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedCanadaApplication = useRef(false)
  const {
    countries,
    loading: countriesLoading,
    error: countriesError,
  } = useSupportedCountries()

  async function handleCreate(countryOverride?: string) {
    const destinationCountry = countryOverride ?? country
    if (!destinationCountry) return
    setLoading(true)
    setError(null)

    try {
      // Public funnel: no login required. Reuse the visitor's session or start a
      // guest (anonymous) one so the application is created under a real uid and
      // the existing RLS/JwtGuard/WS pipeline works unchanged.
      const session = await ensureSession()
      if (!session) {
        setError(t('errSession'))
        setLoading(false)
        return
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/intake/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          country: destinationCountry,
          state: state.trim() || undefined,
        }),
      })

      if (!res.ok) throw new Error(t('errCreateFailed'))
      const { applicationId } = await res.json() as { applicationId: string }
      router.push(`/intake/${applicationId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errUnknown'))
      setLoading(false)
    }
  }

  useEffect(() => {
    if (SITE_CONFIG.mode !== 'canada' || startedCanadaApplication.current) return
    startedCanadaApplication.current = true
    void handleCreate('CA')
  }, [])

  const selectedCountry = countries.find(c => c.code === country)

  if (SITE_CONFIG.mode === 'canada') {
    return (
      <div className="mx-auto flex max-w-[520px] flex-col items-center gap-4 py-16 text-center">
        <span className="eyebrow">VisaAI Canada</span>
        <h1 className="type-h1">Starting your Canada intake</h1>
        <p className="lede">Your application will begin with Canada’s guided intake interview.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {loading && <p className="text-[13px] text-midtone-gray">Preparing your secure session…</p>}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* This is the first step of the public funnel and, for most people, the
          first page they land on. The only other language switcher lives at the
          bottom of the sidebar — off-screen on mobile, and easy to miss on
          desktop — so it is repeated here where the choice is actually made. */}
      <div className="flex justify-end mb-2">
        <LanguageSelector persistToAccount className="lang-selector" />
      </div>

      <header className="page-head">
        <div className="page-head__intro">
          <span className="eyebrow">{t('newApplication')}</span>
          <h1 className="type-h1" style={{ margin: '0 auto 44px' }}>{t('whereApplying')}</h1>
          <p className="lede">{t('newLede')}</p>
        </div>
      </header>

      <div className="flex flex-col gap-4 mb-6">
        <div>
          <label htmlFor="country" className="block text-[13px] font-medium text-rich-black mb-2">
            {t('destinationCountry')} <span className="text-callout-red">*</span>
          </label>
          <CountryCombobox
            id="country"
            name="country"
            value={country || null}
            onChange={code => setCountry(code ?? '')}
            countries={countries}
            loading={countriesLoading}
            error={countriesError ? t('countriesLoadError') : null}
            placeholder={t('searchCountries')}
          />
        </div>

        <div>
          <label htmlFor="state" className="block text-[13px] font-medium text-rich-black mb-2">
            {t('stateProvince')} <span className="text-midtone-gray font-normal">{t('optional')}</span>
          </label>
          <Input
            id="state"
            value={state}
            onChange={e => setState(e.target.value)}
            placeholder={selectedCountry ? t('statePlaceholderCountry', { country: selectedCountry.name }) : t('statePlaceholder')}
          />
          <p className="field-help">{t('stateHelp')}</p>
        </div>
      </div>

      {error && <div className="alert alert-error mb-4" role="alert">{error}</div>}

      <Button
        onClick={() => handleCreate()}
        disabled={!country || loading}
        block
        size="lg"
      >
        {loading ? t('creating') : t('startApplication')}
      </Button>
    </div>
  )
}
