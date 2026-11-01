'use client'
import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import type { AdminDashboard, DashboardRange } from '@visaai/types'
import { AdminDashboardCards, type AdminDashboardLabels } from './admin-dashboard-cards'
import { DashboardControls, type DashboardControlsLabels } from './dashboard-controls'

/** Toggleable metric widgets (the placeholder cards always render). */
const WIDGET_KEYS = [
  'users', 'consultants', 'inProgress', 'aiTokens', 'revenue', 'logins', 'lockouts',
] as const
const LS_KEY = 'admin-dashboard-widgets'

function allVisible(): Record<string, boolean> {
  return Object.fromEntries(WIDGET_KEYS.map((k) => [k, true]))
}

/**
 * Client shell for the admin dashboard: owns the date-range navigation (writes
 * `?range=` via the locale-aware router so the server re-fetches) and the
 * widget-visibility preference (persisted to localStorage). The data itself is
 * fetched server-side and passed in.
 */
export function DashboardShell({
  data, range, cardLabels, controlLabels,
}: {
  data: AdminDashboard
  range: DashboardRange
  cardLabels: AdminDashboardLabels
  controlLabels: DashboardControlsLabels
}) {
  const router = useRouter()
  const [widgets, setWidgets] = useState<Record<string, boolean>>(allVisible)

  // Hydrate saved preferences after mount (localStorage is client-only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) setWidgets((w) => ({ ...w, ...JSON.parse(raw) }))
    } catch {
      /* ignore malformed/absent storage */
    }
  }, [])

  const onToggleWidget = (key: string) =>
    setWidgets((w) => {
      const next = { ...w, [key]: !w[key] }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next))
      } catch {
        /* ignore quota/availability errors */
      }
      return next
    })

  const hidden = new Set(
    Object.entries(widgets).filter(([, v]) => !v).map(([k]) => k),
  )

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <DashboardControls
        range={range}
        onRangeChange={(r) => router.replace(`/admin?range=${r}`)}
        widgets={widgets}
        widgetLabels={{ ...cardLabels }}
        onToggleWidget={onToggleWidget}
        labels={controlLabels}
      />
      <AdminDashboardCards data={data} labels={cardLabels} hidden={hidden} />
    </div>
  )
}
