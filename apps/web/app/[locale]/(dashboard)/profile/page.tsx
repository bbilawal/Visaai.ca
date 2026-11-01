import { getTranslations, getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyLoginHistory, getMyProfile } from '@/lib/api/iam'
import { apiFetch } from '@/lib/api/client'
import type { Me } from '@/lib/api/me'
import type { LoginHistoryEntry, UserProfile } from '@visaai/types'
import { ProfileForm } from './profile-form'
import { ExtendedProfile } from './extended-profile'
import { MfaSection } from './mfa-section'
import { AppearanceSection } from './appearance-section'
import { PrivacySection } from './privacy-section'

export default async function ProfilePage() {
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect({ href: '/login', locale })

  // PROF-001: a failed read must NOT reach the form.
  //
  // supabase-js resolves a failed read as `{ data: null, error }` rather than
  // rejecting, and dropping `error` made a failure indistinguishable from an
  // empty profile: `row` was null, `initialFullName` fell back to '', the name
  // field rendered blank, and `handleSave` writes `full_name` unconditionally —
  // so a user who came to change only their nationality would silently erase
  // their own name. Throwing renders the error boundary instead of a form
  // pre-filled with fabricated data.
  //
  // PGRST116 is `.single()` finding no row, which is a legitimately empty
  // profile rather than a failure, and still renders the empty form.
  const { data: row, error: profileError } = await supabase
    .from('users')
    .select('full_name, nationality')
    .eq('id', user.id)
    .single()
  if (profileError && profileError.code !== 'PGRST116') {
    throw new Error(`Could not load your profile: ${profileError.message}`)
  }

  // AUTH-002: `role`, not `app_role` — the latter is never written, so this
  // displayed "user" to every admin and consultant.
  //
  // AUTH-002b: `app_metadata.role` is not written either. It is seeded for 1 of
  // 50 production users, so the fallback below still displayed "user" to every
  // admin and consultant — including accounts that resolve to 'admin' via the
  // ADMIN_EMAILS fallback or the consultant table. GET /me is the same
  // authoritative resolver the route-group RBAC gate uses (lib/auth/require-role),
  // so read the role from there and keep app_metadata only as an offline fallback.
  const { data: { session } } = await supabase.auth.getSession()
  let role = (user.app_metadata?.role as string | undefined) ?? 'user'
  if (session) {
    try {
      role = (await apiFetch<Me>('/me', session.access_token)).appRole
    } catch {
      // Fail-soft: keep the app_metadata value rather than blocking the page.
    }
  }
  const t = await getTranslations('profile')

  // Expanded profile + recent login history (IAM module). Fail-soft: a fresh
  // user has no profile row yet, and the API may be unreachable in dev.
  let profile: UserProfile | null = null
  let loginHistory: LoginHistoryEntry[] = []
  try {
    profile = await getMyProfile()
  } catch {
    profile = null
  }
  try {
    loginHistory = await getMyLoginHistory()
  } catch {
    loginHistory = []
  }

  return (
    <div className="max-w-[560px]">
      <h1 className="text-[28px] font-semibold tracking-[-0.5px] text-deep-black mb-1">{t('title')}</h1>
      <p className="text-[13px] text-midtone-gray mb-6">{t('subtitle')}</p>
      <ProfileForm
        userId={user.id}
        email={user.email ?? ''}
        role={role}
        initialFullName={row?.full_name ?? ''}
        initialNationality={row?.nationality ?? ''}
      />
      <div className="mt-6 flex flex-col gap-6">
        <ExtendedProfile initialProfile={profile} loginHistory={loginHistory} />
        <AppearanceSection />
        <MfaSection />
        <PrivacySection />
      </div>
    </div>
  )
}
