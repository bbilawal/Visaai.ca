import { requireRole } from '@/lib/auth/require-role'
import { AppShell } from '@/components/layout/app-shell'

/**
 * Consultant route-group layout. Server-side RBAC gate, then the SAME shared app
 * shell (left sidebar) every authenticated role uses — replacing the previous
 * nav-LESS layout that dead-ended consultants on their pages. The role-aware
 * sidebar (navForRole) surfaces Dashboard / Review Queue / Messages / Profile.
 */
export default async function ConsultantLayout({ children }: { children: React.ReactNode }) {
  const me = await requireRole(['consultant']) // admin also allowed; backend authoritative
  return <AppShell userEmail={me.email}>{children}</AppShell>
}
