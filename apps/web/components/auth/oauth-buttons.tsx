'use client'

import { useState } from 'react'
import { signInWithOAuth } from '@/lib/supabase/client'
import { Alert } from '@/components/ui/alert'
import { SocialLoginButton } from './social-login-button'

export function OAuthButtons() {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'google' | 'azure' | null>(null)

  async function handle(provider: 'google' | 'azure', label: string) {
    setPending(provider)
    setError(null)
    const { error } = await signInWithOAuth(provider)
    // On success the browser is redirected to the provider, so this line is only
    // reached on failure (e.g. provider not enabled in the Supabase dashboard).
    if (error) {
      setPending(null)
      setError(`Sign-in with ${label} is not available right now.`)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="my-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-subtle-ash" />
        <span className="text-[11px] text-midtone-gray">or</span>
        <span className="h-px flex-1 bg-subtle-ash" />
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      <SocialLoginButton
        provider="google"
        loading={pending === 'google'}
        onClick={() => handle('google', 'Google')}
      />
      <SocialLoginButton
        provider="azure"
        loading={pending === 'azure'}
        onClick={() => handle('azure', 'Microsoft')}
      />
    </div>
  )
}
