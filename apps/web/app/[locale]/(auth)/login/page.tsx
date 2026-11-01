'use client'

import { Suspense, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { signInWithPassword } from '@/lib/supabase/client'
import { track } from '@/lib/analytics'
import { AuthSplitLayout } from '@/components/auth/auth-split-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Alert } from '@/components/ui/alert'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { OAuthButtons } from '@/components/auth/oauth-buttons'
import { OAuthErrorAlert } from '@/components/auth/oauth-error-alert'

export default function LoginPage() {
  const t = useTranslations('auth')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    localStorage.setItem('va.remember', String(remember))

    const { error } = await signInWithPassword({ email, password })

    if (error) {
      setError(t('invalidCredentials'))
      setLoading(false)
      return
    }

    track('login_completed', { method: 'email' })
    router.push('/')
    router.refresh()
  }

  return (
    <AuthSplitLayout>
      <Card variant="tight">
        <CardHeader>
          <CardTitle>{t('signIn')}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* A failed provider sign-in redirects back here with the reason. */}
          <Suspense fallback={null}>
            <OAuthErrorAlert />
          </Suspense>
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            {error && (
              <Alert variant="error">{error}</Alert>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="login-email" className="text-[12px] font-medium text-rich-black">
                {t('email')}
              </label>
              <Input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="login-password" className="text-[12px] font-medium text-rich-black">
                {t('password')}
              </label>
              <PasswordInput
                id="login-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <label className="flex items-center gap-1.5 text-[12px] text-midtone-gray cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                />
                {t('rememberMe')}
              </label>
              <Link
                href="/forgot-password"
                className="text-[12px] text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm"
              >
                {t('forgotPassword')}
              </Link>
            </div>
            <Button type="submit" loading={loading} className="mt-2 w-full">
              {t('signIn')}
            </Button>
          </form>
          <p className="mt-4 text-center text-[12px] text-midtone-gray">
            {t('noAccount')}{' '}
            <Link href="/signup" className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm">
              {t('createOne')}
            </Link>
          </p>
          <OAuthButtons />
        </CardContent>
      </Card>
    </AuthSplitLayout>
  )
}
