import { requireRole } from '@/lib/auth/require-role'
import { AppShell } from '@/components/layout/app-shell'

/**
 * Admin route-group layout. Server-side RBAC gate, then the SAME shared app
 * shell (left sidebar) every authenticated role uses — replacing the old bespoke
 * horizontal top-nav so admin navigation is consistent with the rest of the app.
 * The role-aware sidebar (navForRole) surfaces the admin links.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireRole(['admin']) // backend remains authoritative
  return <AppShell userEmail={me.email}>{children}</AppShell>
}
