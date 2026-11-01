'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { OnboardingProgress } from '@/components/onboarding/onboarding-progress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { getUser, createClient } from '@/lib/supabase/client'

export default function OnboardingProfilePage() {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const LABELS = [t('stepWelcome'), t('stepProfile'), t('stepFirstApp')]
  const [userId, setUserId] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationality, setNationality] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getUser().then((res) => {
      const user = (res as { data: { user: { id: string } | null } }).data.user
      if (user) setUserId(user.id)
    })
  }, [])

  async function handleContinue() {
    if (!userId) return
    setLoading(true)
    setError(null)

    const fullName = `${firstName} ${lastName}`.trim()
    const { error: dbError } = await createClient()
      .from('users')
      .update({ full_name: fullName, nationality: nationality.trim() || null })
      .eq('id', userId)

    if (dbError) {
      setError(typeof dbError === 'object' && dbError !== null && 'message' in dbError
        ? String((dbError as { message: string }).message)
        : t('errSaveProfile'))
      setLoading(false)
      return
    }

    router.push('/welcome/application')
  }

  return (
    <div className="flex flex-col gap-8">
      <OnboardingProgress step={2} labels={LABELS} />

      <div className="text-center">
        <h1 className="font-serif text-[32px] leading-[1.1] tracking-[-1px] text-deep-black">
          {t('profileTitle')}
        </h1>
        <p className="mt-3 text-[14px] text-midtone-gray">
          {t('profileSubtitle')}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className="block text-[13px] font-medium text-rich-black mb-1.5">
              {t('firstName')}
            </label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              autoComplete="given-name"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-[13px] font-medium text-rich-black mb-1.5">
              {t('lastName')}
            </label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
              autoComplete="family-name"
            />
          </div>
        </div>

        <div>
          <label htmlFor="nationality" className="block text-[13px] font-medium text-rich-black mb-1.5">
            {t('nationality')} <span className="text-midtone-gray font-normal">{t('optional')}</span>
          </label>
          <Input
            id="nationality"
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            placeholder={t('nationalityPlaceholder')}
            autoComplete="country-name"
          />
        </div>

        {error && (
          <Alert variant="error">{error}</Alert>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <Button
            size="lg"
            block
            loading={loading}
            onClick={handleContinue}
          >
            {t('continue')}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            block
            onClick={() => router.push('/welcome/application')}
          >
            {t('skipStep')}
          </Button>
        </div>
      </div>
    </div>
  )
}
