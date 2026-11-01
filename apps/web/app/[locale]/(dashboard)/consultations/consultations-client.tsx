'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import {
  browserTimezone,
  cancelConsultation,
  listConsultations,
} from '@/lib/api/consultations-client'
import type { Consultation } from '@visaai/types'

/**
 * The applicant's booked consultations.
 *
 * Counterpart to the booking control on a consultant's page. Without a list
 * there is no way to see, join, or cancel what you booked — a calendar hold
 * with no visible record is worse than no booking at all, because the applicant
 * cannot tell whether it happened.
 *
 * Times render in the browser's zone, not the one stored on the booking. The
 * stored zone is what the person booked FROM; if they have since travelled,
 * what they need is the time where they are now. Both are shown when they
 * differ, so a booking made in one country and viewed in another is not
 * silently shifted.
 */

const ACTIVE: Consultation['status'][] = ['requested', 'confirmed']

export function ConsultationsClient() {
  const t = useTranslations('consultations')
  const { toast } = useToast()
  const [items, setItems] = useState<Consultation[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const viewerZone = browserTimezone()

  const load = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) {
        setItems([])
        return
      }
      setItems(await listConsultations(session.access_token))
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onCancel = useCallback(
    async (id: string) => {
      if (busyId) return
      setBusyId(id)
      try {
        const {
          data: { session },
        } = await getSession()
        if (!session) throw new Error(t('sessionExpired'))
        await cancelConsultation(session.access_token, id)
        toast(t('cancelled'), 'success')
        await load()
      } catch (err) {
        toast(err instanceof Error ? err.message : t('cancelFailed'), 'error')
      } finally {
        setBusyId(null)
      }
    },
    [busyId, load, t, toast],
  )

  if (items === null) return <p className="text-muted">{t('loading')}</p>
  if (items.length === 0) return <p className="text-muted">{t('none')}</p>

  const upcoming = items.filter((c) => ACTIVE.includes(c.status))
  const past = items.filter((c) => !ACTIVE.includes(c.status))

  const fmt = (iso: string, zone: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone,
    }).format(new Date(iso))

  const row = (c: Consultation, actionable: boolean) => (
    <li key={c.id} className="card" style={{ display: 'grid', gap: 6 }}>
      <strong>{fmt(c.scheduled_start, viewerZone)}</strong>

      {c.timezone && c.timezone !== viewerZone ? (
        <span className="text-muted">
          {t('bookedInZone', {
            zone: c.timezone,
            time: fmt(c.scheduled_start, c.timezone),
          })}
        </span>
      ) : null}

      <span className="text-muted">{t(`status_${c.status}`)}</span>

      {c.meeting_url ? (
        <a href={c.meeting_url} target="_blank" rel="noreferrer noopener">
          {t('joinMeeting')}
        </a>
      ) : (
        // Meeting links come from the consultant's calendar integration, so
        // there is a real window where a confirmed booking has no link yet.
        <span className="text-muted">{t('linkPending')}</span>
      )}

      {actionable ? (
        <div>
          <button
            type="button"
            className="btn"
            disabled={busyId === c.id}
            onClick={() => void onCancel(c.id)}
          >
            {busyId === c.id ? t('cancelling') : t('cancel')}
          </button>
        </div>
      ) : null}
    </li>
  )

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h2 className="type-h3" style={{ marginBottom: 12 }}>
          {t('upcomingHeading')}
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-muted">{t('noUpcoming')}</p>
        ) : (
          <ul style={{ display: 'grid', gap: 12, listStyle: 'none', padding: 0 }}>
            {upcoming.map((c) => row(c, true))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section>
          <h2 className="type-h3" style={{ marginBottom: 12 }}>
            {t('pastHeading')}
          </h2>
          <ul style={{ display: 'grid', gap: 12, listStyle: 'none', padding: 0 }}>
            {past.map((c) => row(c, false))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default ConsultationsClient
