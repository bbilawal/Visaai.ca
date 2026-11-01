'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import {
  bookConsultation,
  browserTimezone,
  listSlots,
  type SlotWindow,
} from '@/lib/api/consultations-client'

/**
 * Pick a time with a consultant and book it.
 *
 * This is the missing half of the marketplace. `HireButton` next to it buys a
 * service order through Stripe; nothing anywhere let an applicant book a TIME,
 * even though the consultations API — availability expansion, booking, cancel,
 * reschedule — has been complete and tested for months.
 *
 * TWO TIMEZONES, DELIBERATELY
 *
 * Slots come back with the CONSULTANT's zone attached, and are absolute
 * instants. They are rendered in the APPLICANT's zone, and that zone is what
 * gets stored on the booking, so a confirmation or reminder later reads back in
 * the timezone the person actually booked from. Showing a consultant's local
 * time to someone in another country is how people miss calls.
 */

const DAYS_AHEAD = 14
const SLOT_MINUTES = 30

export function BookConsultation({
  consultantId,
  applicationId,
}: {
  consultantId: string
  applicationId?: string
}) {
  const t = useTranslations('consultations')
  const router = useRouter()
  const { toast } = useToast()

  const [slots, setSlots] = useState<SlotWindow[] | null>(null)
  const [consultantZone, setConsultantZone] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const viewerZone = browserTimezone()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const {
          data: { session },
        } = await getSession()
        // Booking holds a real calendar slot, so it needs a real account. A
        // guest sees nothing here rather than a control that will 401.
        if (!session) {
          if (!cancelled) setSlots([])
          return
        }

        const from = new Date()
        const to = new Date(from.getTime() + DAYS_AHEAD * 86_400_000)
        const res = await listSlots(session.access_token, consultantId, {
          from: from.toISOString(),
          to: to.toISOString(),
          slotMinutes: SLOT_MINUTES,
        })
        if (cancelled) return
        setConsultantZone(res.timezone)
        setSlots(res.slots)
      } catch {
        // A consultant with no availability configured is the common case and
        // is not an error worth shouting about.
        if (!cancelled) setSlots([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [consultantId])

  const onBook = useCallback(async () => {
    const slot = slots?.find((s) => s.start === selected)
    if (!slot || booking) return

    setBooking(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error(t('sessionExpired'))

      await bookConsultation(session.access_token, {
        consultantId,
        scheduledStart: slot.start,
        scheduledEnd: slot.end,
        timezone: viewerZone,
        ...(applicationId ? { applicationId } : {}),
      })

      toast(t('booked'), 'success')
      router.push('/consultations')
    } catch (err) {
      // The most likely failure is a race: someone else took the slot between
      // the list and the click. Say so rather than showing a raw error.
      setError(err instanceof Error ? err.message : t('bookFailed'))
      setBooking(false)
    }
  }, [applicationId, booking, consultantId, router, selected, slots, t, toast, viewerZone])

  if (slots === null) return <p className="text-muted">{t('loadingSlots')}</p>
  if (slots.length === 0) return <p className="text-muted">{t('noSlots')}</p>

  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: viewerZone,
  })

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="text-muted">
        {t('timesShownIn', { zone: viewerZone })}
        {consultantZone && consultantZone !== viewerZone
          ? ` ${t('consultantIsIn', { zone: consultantZone })}`
          : ''}
      </p>

      <div
        role="radiogroup"
        aria-label={t('chooseTime')}
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        }}
      >
        {slots.map((s) => {
          const isSelected = s.start === selected
          return (
            <button
              key={s.start}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(s.start)}
              disabled={booking}
              className={`card${isSelected ? ' card-selected' : ''}`}
              style={{
                textAlign: 'left',
                cursor: booking ? 'default' : 'pointer',
                borderColor: isSelected ? 'var(--ink)' : undefined,
                background: isSelected ? 'var(--atmosphere-wash)' : undefined,
              }}
            >
              {fmt.format(new Date(s.start))}
            </button>
          )
        })}
      </div>

      {error ? <p style={{ color: 'var(--rose)' }}>{error}</p> : null}

      <div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selected || booking}
          onClick={() => void onBook()}
        >
          {booking ? t('booking') : t('confirmBooking')}
        </button>
      </div>
    </div>
  )
}

export default BookConsultation
