'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { updateUserPassword } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { PasswordInput } from '@/components/ui/password-input'
import { AuthSplitLayout } from '@/components/auth/auth-split-layout'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password-strength'

export default function ResetPasswordPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError(t('errPasswordMismatch'))
      return
    }
    setLoading(true)
    setError(null)
    const { error } = await updateUserPassword(password)
    setLoading(false)
    if (error) {
      setError(t('errResetExpired'))
      return
    }
    setDone(true)
    setTimeout(() => router.push('/login'), 1500)
  }

  return (
    <AuthSplitLayout>
      <Card variant="tight">
        <CardHeader>
          <CardTitle as="h1">{t('resetTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* aria-live region is always present so screen readers pick up the
              dynamic insertion of the success message on password update */}
          <div aria-live="polite" aria-atomic="true">
            {done && (
              <div className="text-center py-2">
                <Alert variant="success">
                  <p className="font-medium">{t('passwordUpdated')}</p>
                  <p className="text-[12px] mt-0.5">{t('redirectingSignIn')}</p>
                </Alert>
              </div>
            )}
          </div>
          {!done && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="error">{error}</Alert>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-password" className="text-[12px] font-medium text-rich-black">
                  {t('newPassword')}
                </label>
                <PasswordInput
                  id="reset-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                />
                <p className="text-[11px] text-midtone-gray">{t('passwordMinHint')}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-confirm" className="text-[12px] font-medium text-rich-black">
                  {t('confirmNewPassword')}
                </label>
                <PasswordInput
                  id="reset-confirm"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                />
              </div>
              <Button type="submit" loading={loading} className="mt-2 w-full">
                {loading ? t('updating') : t('updatePassword')}
              </Button>
              <p className="text-center text-[12px] text-midtone-gray">
                <Link href="/forgot-password" className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm">
                  {t('requestNewLink')}
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthSplitLayout>
  )
}
