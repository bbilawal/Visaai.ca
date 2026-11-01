import { apiFetch } from './client'
import type {
  ConsultantAvailability,
  ConsultantProfile,
  ConsultantSkills,
} from '@visaai/types'

/**
 * Consultant self-serve marketplace profile (MKT-1/MKT-2). Client-safe.
 *
 * Deliberately reachable by a caller whose appRole is still 'user': a new
 * consultant creates their own profile BEFORE any assignment exists, so role is
 * not the gate. RLS owner-write (auth.uid() == user_id) is.
 *
 * The API refuses money/KYC/Stripe/rating columns outright — those are system
 * managed — and only accepts the self-serve status transitions 'draft' and
 * 'pending_review'. Going 'active' is admin-gated, so a submitted profile does
 * NOT appear in discovery until an admin approves it.
 */
export interface ProfileBundle {
  profile: ConsultantProfile
  skills: ConsultantSkills | null
  availability: ConsultantAvailability | null
}

export interface ProfileFields {
  headline?: string | null
  bio?: string | null
  specialization?: string[]
  years_experience?: number | null
  license_number?: string | null
  license_authority?: string | null
  license_country?: string | null
  hourly_rate_usd?: number | null
  active_status?: 'draft' | 'pending_review'
}

/** 404s when the caller has no profile yet — treat that as "not started". */
export const getMyConsultantProfile = (token: string) =>
  apiFetch<ProfileBundle>('/marketplace/profile', token)

export const createConsultantProfile = (token: string, body: ProfileFields) =>
  apiFetch<ConsultantProfile>('/marketplace/profile', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const updateConsultantProfile = (token: string, body: ProfileFields) =>
  apiFetch<ConsultantProfile>('/marketplace/profile', token, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

/**
 * visa_types + languages only. `countries_supported` is the denormalized mirror
 * of consultant_countries and is refreshed via sync-countries — never written
 * here, so the source of truth stays single.
 */
export const upsertConsultantSkills = (
  token: string,
  body: { visa_types?: string[]; languages?: string[] },
) =>
  apiFetch<ConsultantSkills>('/marketplace/profile/skills', token, {
    method: 'PUT',
    body: JSON.stringify(body),
  })

export const upsertConsultantAvailability = (
  token: string,
  body: { timezone?: string; max_cases?: number; accepting_new?: boolean },
) =>
  apiFetch<ConsultantAvailability>('/marketplace/profile/availability', token, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
