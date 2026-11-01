'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { OnboardingProgress } from '@/components/onboarding/onboarding-progress'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/client'
import { markOnboarded } from '@/lib/onboarding/complete'

export default function WelcomePage() {
  const t = useTranslations('onboarding')
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [skipping, setSkipping] = useState(false)

  const LABELS = [t('stepWelcome'), t('stepProfile'), t('stepFirstApp')]
  const BENEFITS = [
    { title: t('benefit1Title'), description: t('benefit1Desc') },
    { title: t('benefit2Title'), description: t('benefit2Desc') },
    { title: t('benefit3Title'), description: t('benefit3Desc') },
  ]

  useEffect(() => {
    getUser().then((res) => {
      const user = (res as { data: { user: { id: string } | null } }).data.user
      if (user) setUserId(user.id)
    })
  }, [])

  async function handleSkip() {
    if (!userId) return
    setSkipping(true)
    await markOnboarded(userId)
    router.push('/')
  }

  return (
    <div className="flex flex-col gap-8">
      <OnboardingProgress step={1} labels={LABELS} />

      <div className="text-center">
        <h1 className="font-serif text-[36px] leading-[1.1] tracking-[-1px] text-deep-black">
          {t('welcomeTitle')}
        </h1>
        <p className="mt-3 text-[14px] text-midtone-gray max-w-[400px] mx-auto">
          {t('welcomeSubtitle')}
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {BENEFITS.map((b) => (
          <li key={b.title} className="flex gap-3 items-start">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-deep-black text-canvas-white text-[10px]">
              ✓
            </span>
            <div>
              <p className="text-[14px] font-medium text-deep-black">{b.title}</p>
              <p className="text-[13px] text-midtone-gray">{b.description}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          block
          onClick={() => router.push('/welcome/profile')}
        >
          {t('getStarted')}
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
  )
}
