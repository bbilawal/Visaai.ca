'use client'

import { useEffect, useState } from 'react'
import { usePathname } from '@/i18n/navigation'
import { type AppProgress, type StageState, STAGE_ORDER } from '@visaai/types'
import { getSession, isGuestSession } from '@/lib/supabase/client'
import { StageNav } from './stage-nav'
import { NextActionCard } from '@/components/dashboard/next-action-card'
import { MilestoneToast } from '@/components/providers/milestone-toast'

const TOTAL_STAGES = STAGE_ORDER.length

/**
 * Client wrapper around StageNav that fetches real progress for the current
 * application and feeds it three retention surfaces:
 *  - StageNav real complete/locked states
 *  - NextActionCard (single primary CTA)
 *  - MilestoneToast when a stage newly completes (localStorage diff, no backend)
 *
 * On routes with no application in the path (e.g. dashboard root) it renders the
 * plain StageNav, which no-ops, preserving prior behavior.
 */
export function StageProgress() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const [stage, applicationId] = segments
  const onStageRoute = !!stage && !!applicationId && (STAGE_ORDER as readonly string[]).includes(stage)

  const [progress, setProgress] = useState<AppProgress | null>(null)
  const [milestone, setMilestone] = useState<{ message: string; fireKey: string } | null>(null)

  useEffect(() => {
    if (!onStageRoute) return
    let cancelled = false

    async function load() {
      const { data: sessionData } = await getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      // /progress is not @AllowAnonymous, so a guest gets a guaranteed 403 and
      // the stage bar renders from its own defaults either way (BUG-002).
      if (isGuestSession(sessionData.session)) return
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
      try {
        const res = await fetch(`${apiUrl}/progress/${applicationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as AppProgress
        setProgress(data)
        detectMilestone(data)
      } catch {
        // best-effort: progress UI degrades silently if the API is unreachable
      }
    }

    function detectMilestone(p: AppProgress) {
      if (typeof window === 'undefined') return
      const completed = p.stages.filter(s => s.state === 'complete').length
      const key = `vai_milestone_${p.applicationId}`
      const prevRaw = window.localStorage.getItem(key)
      window.localStorage.setItem(key, String(completed))
      // First observation for this app: seed the baseline, do not celebrate
      // progress the user made before this feature existed.
      if (prevRaw === null) return
      const prev = Number(prevRaw)
      if (Number.isFinite(prev) && completed > prev) {
        setMilestone({
          message: `Stage complete — ${completed} of ${TOTAL_STAGES} done`,
          fireKey: `${p.applicationId}-${completed}`,
        })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [onStageRoute, applicationId])

  // Off a stage route, ignore any stale progress so StageNav no-ops.
  const stagesMap: Partial<Record<string, StageState>> | undefined =
    onStageRoute && progress
      ? Object.fromEntries(progress.stages.map(s => [s.slug, s.state]))
      : undefined

  return (
    <>
      <StageNav stages={stagesMap} />
      {onStageRoute && progress && <NextActionCard progress={progress} />}
      {milestone && <MilestoneToast message={milestone.message} fireKey={milestone.fireKey} />}
    </>
  )
}
