'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { resetPasswordForEmail } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { AuthSplitLayout } from '@/components/auth/auth-split-layout'

export default function ForgotPasswordPage() {
  const t = useTranslations('auth')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await resetPasswordForEmail(email)
    setLoading(false)
    // Supabase does not error on unknown emails (anti-enumeration). Only surface
    // genuine transport failures; otherwise always show the generic confirmation.
    if (error) {
      setError(t('errResetSend'))
      return
    }
    setSent(true)
  }

  return (
    <AuthSplitLayout>
      <Card variant="tight">
        <CardHeader>
          <CardTitle as="h1">{t('forgotTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* aria-live region always rendered so screen readers announce the
              success state when it becomes visible after form submission */}
          <div aria-live="polite" aria-atomic="true">
            {sent && (
              <div className="text-center py-2" role="status">
                <p className="text-[32px] mb-3" aria-hidden="true">&#x2713;</p>
                <p className="text-[14px] text-rich-black mb-1 font-medium">{t('checkEmail')}</p>
                <p className="text-[13px] text-midtone-gray">
                  {t('resetLinkSent', { email })}
                </p>
                <p className="mt-4 text-[12px] text-midtone-gray">
                  <Link href="/login" className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm">
                    {t('backToSignIn')}
                  </Link>
                </p>
              </div>
            )}
          </div>
          {!sent && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="error">{error}</Alert>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="forgot-email" className="text-[12px] font-medium text-rich-black">
                  {t('email')}
                </label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <Button type="submit" loading={loading} className="mt-2 w-full">
                {loading ? t('sending') : t('sendResetLink')}
              </Button>
              <p className="text-center text-[12px] text-midtone-gray">
                <Link href="/login" className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm">
                  {t('backToSignIn')}
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthSplitLayout>
  )
}
