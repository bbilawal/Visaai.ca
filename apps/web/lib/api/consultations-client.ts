import { apiFetch } from './client'
import type { Consultation } from '@visaai/types'

/**
 * Client for the consultation scheduling API.
 *
 * WHY THIS DID NOT EXIST
 *
 * `apps/api/src/modules/consultations` is complete and tested — availability
 * expansion, booking, cancel, reschedule, plus hardening tests for the
 * unbounded-window DoS. It had no caller anywhere in the web app. A consultant
 * page offered "Hire", which buys a service order through Stripe, and no way
 * whatsoever to book a time.
 *
 * So the scheduling half of the marketplace was reachable only by hitting the
 * API directly — the same shape of gap as `applications.visa_type_id`: a
 * finished backend with nothing on the other end of it.
 */

export interface SlotWindow {
  start: string
  end: string
}

export interface SlotsResponse {
  /** The CONSULTANT's IANA zone. Slots are absolute instants; this is for labelling. */
  timezone: string
  slots: SlotWindow[]
}

export type MeetingProvider = 'zoom' | 'google_meet' | 'ms_teams'

/**
 * Free slots for a consultant in a window.
 *
 * `from`/`to` are ISO instants and the API bounds the range — it expands a slot
 * grid server-side, so an unbounded window is a denial-of-service vector, not
 * merely a slow query.
 */
export const listSlots = (
  token: string,
  consultantId: string,
  params: { from: string; to: string; slotMinutes?: number },
) => {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    ...(params.slotMinutes ? { slotMinutes: String(params.slotMinutes) } : {}),
  })
  return apiFetch<SlotsResponse>(
    `/consultations/consultants/${consultantId}/slots?${qs.toString()}`,
    token,
  )
}

/**
 * Book a slot.
 *
 * `timezone` is the APPLICANT's zone, stored so the confirmation and reminders
 * can be rendered in the timezone they booked from rather than the
 * consultant's. The instants themselves are absolute.
 */
export const bookConsultation = (
  token: string,
  body: {
    consultantId: string
    scheduledStart: string
    scheduledEnd: string
    timezone: string
    applicationId?: string
    provider?: MeetingProvider
  },
) =>
  apiFetch<Consultation>('/consultations', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })

/** The caller's own consultations. Scoped server-side; no user id is sent. */
export const listConsultations = (token: string) =>
  apiFetch<Consultation[]>('/consultations', token)

export const cancelConsultation = (token: string, id: string) =>
  apiFetch<Consultation>(`/consultations/${id}/cancel`, token, {
    method: 'POST',
  })

export const rescheduleConsultation = (
  token: string,
  id: string,
  body: { scheduledStart: string; scheduledEnd: string; timezone: string },
) =>
  apiFetch<Consultation>(`/consultations/${id}/reschedule`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })

/** The browser's IANA zone, with a defensible fallback. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
