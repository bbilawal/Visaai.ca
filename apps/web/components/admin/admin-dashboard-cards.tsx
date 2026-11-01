import { useLocale } from 'next-intl'
import { Card } from '@/components/ui/card'
import type { AdminDashboard } from '@visaai/types'

export interface AdminDashboardLabels {
  users: string; consultants: string; inProgress: string; aiTokens: string
  revenue: string; logins: string; lockouts: string; notAvailable: string
}

function Stat({ label, value }: { label: string; value: string | number }) {
  // UI-002: the AI-token counter reached seven digits and rendered as the raw
  // "1815625" — unreadable at a glance, which is the entire job of a stat tile.
  // Grouped with the app's own locale so 1 815 625 / 1,815,625 follow the UI
  // language rather than the server's. Strings pass through untouched (the
  // placeholder cards render their own copy).
  const locale = useLocale()
  const display = typeof value === 'number' ? value.toLocaleString(locale) : value
  return (
    <Card>
      <div className="mono text-muted" style={{ fontSize: '0.72rem' }}>{label}</div>
      <div className="type-h2" style={{ marginTop: 4 }}>{display}</div>
    </Card>
  )
}

function Unavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <Card>
      <div className="mono text-muted" style={{ fontSize: '0.72rem' }}>{label}</div>
      <div className="text-muted" style={{ marginTop: 4, fontSize: '0.8rem' }}>{reason}</div>
    </Card>
  )
}

/**
 * Presentational admin dashboard grid — data + translated labels in. `hidden`
 * is an optional set of widget keys to omit (driven by the configurable-widget
 * toggles). Omitting it renders every card.
 */
export function AdminDashboardCards({
  data, labels, hidden,
}: { data: AdminDashboard; labels: AdminDashboardLabels; hidden?: Set<string> }) {
  const revenueTotal = Object.values(data.revenue.completedByTier).reduce((a, b) => a + b, 0)
  const show = (key: string) => !hidden?.has(key)
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
      {show('users') && <Stat label={labels.users} value={data.users.total} />}
      {show('consultants') && <Stat label={labels.consultants} value={data.consultants.total} />}
      {show('inProgress') && <Stat label={labels.inProgress} value={data.applications.inProgress} />}
      {show('aiTokens') && <Stat label={labels.aiTokens} value={data.ai.tokens} />}
      {show('revenue') && <Stat label={labels.revenue} value={revenueTotal} />}
      {show('logins') && <Stat label={labels.logins} value={data.security.logins} />}
      {show('lockouts') && <Stat label={labels.lockouts} value={data.security.lockouts} />}
      <Unavailable label="Subscriptions" reason={labels.notAvailable} />
      <Unavailable label="Support tickets" reason={labels.notAvailable} />
    </div>
  )
}
