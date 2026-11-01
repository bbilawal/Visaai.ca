import { Sidebar } from '@/components/layout/sidebar'
import { StageProgress } from '@/components/layout/stage-progress'
import { MessagingStreamProvider } from '@/lib/messaging/messaging-stream'

/**
 * Shared authenticated app shell: the role-aware left sidebar + scrollable main
 * content + legal footer, wrapped in the single messaging SSE provider. Used by
 * EVERY authenticated route group (applicant dashboard, admin, consultant) so
 * all roles get the SAME consistent left-sidebar navigation — no more bespoke
 * top-nav (admin) or nav-less dead-ends (consultant).
 *
 * The sidebar resolves its own role-aware links client-side (navForRole via
 * useAuthUser); RBAC stays server-side in each layout's requireRole/auth gate.
 *
 * `showStageProgress` is applicant-only chrome (the per-application stage
 * stepper); admin/consultant pass it false.
 */
export function AppShell({
  children,
  userEmail,
  userFullName,
  showStageProgress = false,
}: {
  children: React.ReactNode
  userEmail?: string
  userFullName?: string
  showStageProgress?: boolean
}) {
  return (
    <MessagingStreamProvider>
      <div className="flex flex-col md:flex-row h-screen bg-canvas-white">
        <a href="#main-content" className="skip-link">Skip to content</a>
        <Sidebar userEmail={userEmail} userFullName={userFullName} />
        <main id="main-content" className="flex-1 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto px-5 py-6 md:px-8 md:py-8">
            {showStageProgress ? <StageProgress /> : null}
            {children}
          </div>
        </main>
      </div>
    </MessagingStreamProvider>
  )
}
