'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { OnboardingProgress } from '@/components/onboarding/onboarding-progress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CountryCombobox } from '@/components/ui/country-combobox'
import { Alert } from '@/components/ui/alert'
import { getUser, getSession } from '@/lib/supabase/client'
import { markOnboarded } from '@/lib/onboarding/complete'
import { useSupportedCountries } from '@/lib/use-supported-countries'

export default function OnboardingApplicationPage() {
  const t = useTranslations('onboarding')
  const ta = useTranslations('application')
  const router = useRouter()
  const LABELS = [t('stepWelcome'), t('stepProfile'), t('stepFirstApp')]
  const [userId, setUserId] = useState<string | null>(null)
  const [country, setCountry] = useState('')
  const [state, setState] = useState('')
  const [loading, setLoading] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {
    countries,
    loading: countriesLoading,
    error: countriesError,
  } = useSupportedCountries()

  useEffect(() => {
    getUser().then((res) => {
      const user = (res as { data: { user: { id: string } | null } }).data.user
      if (user) setUserId(user.id)
    })
  }, [])

  async function handleCreate() {
    if (!country || !userId) return
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await getSession()
      if (!session) { router.push('/login'); return }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/intake/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          country,
          state: state.trim() || undefined,
        }),
      })

      if (!res.ok) throw new Error(ta('errCreateFailed'))
      const { applicationId } = await res.json() as { applicationId: string }
      await markOnboarded(userId)
      router.push(`/intake/${applicationId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : ta('errUnknown'))
      setLoading(false)
    }
  }

  async function handleSkip() {
    if (!userId) return
    setSkipping(true)
    await markOnboarded(userId)
    router.push('/')
  }

  const selectedCountry = countries.find(c => c.code === country)

  return (
    <div className="flex flex-col gap-8">
      <OnboardingProgress step={3} labels={LABELS} />

      <div className="text-center">
        <h1 className="font-serif text-[32px] leading-[1.1] tracking-[-1px] text-deep-black">
          {t('appTitle')}
        </h1>
        <p className="mt-3 text-[14px] text-midtone-gray max-w-[400px] mx-auto">
          {t('appSubtitle')}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="country" className="block text-[13px] font-medium text-rich-black mb-2">
            {ta('destinationCountry')} <span className="text-callout-red">*</span>
          </label>
          <CountryCombobox
            id="country"
            name="country"
            value={country || null}
            onChange={code => setCountry(code ?? '')}
            countries={countries}
            loading={countriesLoading}
            error={countriesError ? ta('countriesLoadError') : null}
            placeholder={ta('searchCountries')}
          />
        </div>

        <div>
          <label htmlFor="state" className="block text-[13px] font-medium text-rich-black mb-2">
            {ta('stateProvince')} <span className="text-midtone-gray font-normal">{ta('optional')}</span>
          </label>
          <Input
            id="state"
            value={state}
            onChange={e => setState(e.target.value)}
            placeholder={selectedCountry ? ta('statePlaceholderCountry', { country: selectedCountry.name }) : ta('statePlaceholder')}
          />
          <p className="field-help">{ta('stateHelp')}</p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-col gap-3 pt-2">
          <Button
            size="lg"
            block
            loading={loading}
            disabled={!country}
            onClick={handleCreate}
          >
            {ta('startApplication')}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            block
            loading={skipping}
            onClick={handleSkip}
          >
            {t('skipForNow')}
          </Button>
        </div>
      </div>
    </div>
  )
}
