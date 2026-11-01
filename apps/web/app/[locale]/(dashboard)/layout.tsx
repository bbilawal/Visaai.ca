import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/app-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect({ href: '/login', locale })

  // Guests (anonymous identities) never enter the authenticated dashboard. They
  // belong in the public intake funnel; bounce them to the landing rather than a
  // login wall. The backend (JwtGuard fail-closed) is the real gate — this is UX.
  if (user.is_anonymous) redirect({ href: '/applications/new', locale })

  // Onboarding gate: redirect new applicants (role 'user', no onboarded_at) to /welcome.
  // Fail OPEN: if the query errors (e.g. column not yet migrated), let the user through.
  // Role-gated to 'user' only — admins and consultants are never redirected.
  // AUTH-002: the signed claim is `role` — that is what the API writes
  // (admin.service: `app_metadata: { role }`) and what JwtGuard reads. This
  // read said `app_role`, a key nothing ever sets, so it always fell back to
  // 'user' and every admin and consultant was run through the applicant
  // onboarding gate below.
  const appRole = (user.app_metadata?.role as string | undefined) ?? 'user'
  if (appRole === 'user') {
    const { data: urow, error: urowError } = await supabase
      .from('users')
      .select('onboarded_at')
      .eq('id', user.id)
      .single()
    if (!urowError && urow && !urow.onboarded_at) {
      // Continuity for upgraded guests: a user who already has an application
      // (built during the public intake before signing up) skips /welcome —
      // bouncing them to onboarding would break the "return to your session"
      // promise and risk a duplicate first application. The welcome flow is only
      // for brand-new users with nothing yet.
      const { count } = await supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
      if (!count) {
        redirect({ href: '/welcome', locale })
      }
    }
  }

  const userEmail = user.email ?? undefined
  const userFullName = (user.user_metadata?.full_name as string | undefined) ?? undefined

  return (
    <AppShell userEmail={userEmail} userFullName={userFullName} showStageProgress>
      {children}
    </AppShell>
  )
}
