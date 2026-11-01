'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { signUp } from '@/lib/supabase/client'
import { AuthSplitLayout } from '@/components/auth/auth-split-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { PasswordStrengthMeter } from '@/components/auth/password-strength-meter'
import { Alert } from '@/components/ui/alert'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { OAuthButtons } from '@/components/auth/oauth-buttons'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password-strength'

export default function SignupPage() {
  const t = useTranslations('auth')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [accepted, setAccepted] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!accepted) {
      setError(t('errAcceptTerms'))
      return
    }
    if (password !== confirm) {
      setError(t('errPasswordMismatch'))
      return
    }
    setLoading(true)
    setError(null)

    const fullName = `${firstName} ${lastName}`.trim()
    const { error } = await signUp({ email, password, fullName })

    if (error) {
      setError(error instanceof Error ? error.message : t('errSignupFailed'))
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  return (
    <AuthSplitLayout>
      <Card variant="tight">
        <CardHeader>
          <CardTitle>{t('getStarted')}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* aria-live region always rendered so screen readers announce the
              success state when it becomes visible after form submission */}
          <div aria-live="polite" aria-atomic="true">
            {success && (
              <div className="text-center py-2" role="status">
                <p className="text-[32px] mb-3" aria-hidden="true">&#x2713;</p>
                <p className="text-[14px] text-rich-black mb-1 font-medium">Check your email</p>
                <p className="text-[13px] text-midtone-gray">
                  We sent a confirmation link to <strong>{email}</strong>.
                  Once confirmed,{' '}
                  <Link href="/login" className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm">
                    sign in
                  </Link>.
                </p>
              </div>
            )}
          </div>
          {!success && (
            <form onSubmit={handleSignup} className="flex flex-col gap-3">
              {error && (
                <Alert variant="error">{error}</Alert>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="signup-first-name" className="text-[12px] font-medium text-rich-black">
                    {t('firstName')}
                  </label>
                  <Input
                    id="signup-first-name"
                    type="text"
                    placeholder="Jane"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="signup-last-name" className="text-[12px] font-medium text-rich-black">
                    {t('lastName')}
                  </label>
                  <Input
                    id="signup-last-name"
                    type="text"
                    placeholder="Smith"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="signup-email" className="text-[12px] font-medium text-rich-black">
                  {t('email')}
                </label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="signup-password" className="text-[12px] font-medium text-rich-black">
                  {t('password')}
                </label>
                <PasswordInput
                  id="signup-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                />
                <PasswordStrengthMeter password={password} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="signup-confirm" className="text-[12px] font-medium text-rich-black">
                  {t('confirmPassword')}
                </label>
                <PasswordInput
                  id="signup-confirm"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <label className="flex items-start gap-2 mt-1 text-[12px] text-midtone-gray leading-relaxed">
                <input
                  type="checkbox"
                  className="checkbox mt-0.5"
                  checked={accepted}
                  onChange={e => setAccepted(e.target.checked)}
                />
                <span>
                  I understand VisaAI is a preparation tool, not legal advice, and does not
                  guarantee any visa outcome. I agree to the{' '}
                  <Link href="/terms" className="text-rich-black underline">Terms</Link> and{' '}
                  <Link href="/privacy" className="text-rich-black underline">Privacy Policy</Link>.
                </span>
              </label>
              <Button type="submit" loading={loading} disabled={!accepted} className="mt-2 w-full">
                {t('signUp')}
              </Button>
            </form>
          )}
          {!success && (
            <p className="mt-4 text-center text-[12px] text-midtone-gray">
              {t('haveAccount')}{' '}
              <Link href="/login" className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm">
                {t('signIn')}
              </Link>
            </p>
          )}
          {!success && <OAuthButtons />}
        </CardContent>
      </Card>
    </AuthSplitLayout>
  )
}
