import { serverApi } from './server'
import type {
  ConsultantAvailability,
  ConsultantCard,
  ConsultantProfile,
  ConsultantReview,
  ConsultantSkills,
} from '@visaai/types'

/**
 * Marketplace discovery reads. The API allows anonymous browsing, but these go
 * through serverApi so an authenticated visitor is identified — the same RLS
 * applies either way and only active profiles surface.
 */

/**
 * Mirrors the API's ConsultantDetail exactly: the profile row, plus the name
 * and the two side tables. Note the shape differs from ConsultantCard —
 * visa_types / languages / countries_supported live under `skills` here, NOT on
 * the profile, so read them from there.
 */
export interface ConsultantDetail extends ConsultantProfile {
  full_name: string | null
  skills: ConsultantSkills | null
  availability: ConsultantAvailability | null
}

export type { ConsultantReview }

export interface DiscoveryFilters {
  visa_type?: string
  country?: string
  language?: string
}

function qs(filters: DiscoveryFilters): string {
  const p = new URLSearchParams()
  if (filters.visa_type) p.set('visa_type', filters.visa_type)
  if (filters.country) p.set('country', filters.country)
  if (filters.language) p.set('language', filters.language)
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Server-side: browsable consultant cards, optionally filtered. */
export const listConsultants = (filters: DiscoveryFilters = {}) =>
  serverApi<ConsultantCard[]>(`/marketplace/consultants${qs(filters)}`)

/** Server-side: one consultant's full profile. */
export const getConsultant = (id: string) =>
  serverApi<ConsultantDetail>(`/marketplace/consultants/${id}`)

/** Server-side: published reviews for a consultant. */
export const getConsultantReviews = (id: string) =>
  serverApi<ConsultantReview[]>(`/marketplace/consultants/${id}/reviews`)

/**
 * The four purchasable consultant services. Display only — `serviceType` is the
 * contract with the API, which resolves the real price from SERVICE_PRICES
 * server-side and splits it with the commission engine. A tampered price here
 * cannot affect what is charged.
 */
export const CONSULTANT_SERVICES = [
  {
    serviceType: 'priority_processing' as const,
    price: '$49',
    labelKey: 'svcPriority',
    descKey: 'svcPriorityDesc',
  },
  {
    serviceType: 'document_review' as const,
    price: '$79',
    labelKey: 'svcDocReview',
    descKey: 'svcDocReviewDesc',
  },
  {
    serviceType: 'consultation' as const,
    price: '$99',
    labelKey: 'svcConsultation',
    descKey: 'svcConsultationDesc',
  },
  {
    serviceType: 'premium_review' as const,
    price: '$149',
    labelKey: 'svcPremium',
    descKey: 'svcPremiumDesc',
  },
]

export type ConsultantServiceType =
  (typeof CONSULTANT_SERVICES)[number]['serviceType']
