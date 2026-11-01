import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { StageProgress } from '@/components/layout/stage-progress'
import { AuthGateProvider } from '@/components/auth/auth-gate-provider'

/**
 * Public funnel layout — the guest-capable intake surface (/applications/new,
 * /intake/[id]). Unlike (dashboard), it NEVER redirects on a missing or
 * anonymous user: a brand-new visitor (no session) and a guest (anonymous
 * session) both render the full shell here. Permanent users pass through too
 * (e.g. starting a new application).
 *
 * No authorization happens in this layout. Data access is gated by RLS + the
 * backend JwtGuard; the gated nav/sections are blurred client-side (AuthGate).
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Only a permanent (non-anonymous) identity has a real email/name to show.
  const isPermanent = !!user && !user.is_anonymous
  const userEmail = isPermanent ? (user.email ?? undefined) : undefined
  const userFullName = isPermanent
    ? ((user.user_metadata?.full_name as string | undefined) ?? undefined)
    : undefined

  return (
    <AuthGateProvider>
      <div className="flex flex-col md:flex-row h-screen bg-canvas-white">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <Sidebar userEmail={userEmail} userFullName={userFullName} />
        <main id="main-content" className="flex-1 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto px-5 py-6 md:px-8 md:py-8">
            <StageProgress />
            {children}
          </div>
        </main>
      </div>
    </AuthGateProvider>
  )
}
