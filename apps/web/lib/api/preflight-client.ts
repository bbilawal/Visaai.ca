import type {
  PortalFillCoverage,
  PreflightCheckKey,
  PreflightLockValidation,
  PreflightMappingInput,
  PreflightReview,
} from '@visaai/types'
import { apiFetch } from './client'

/**
 * Client-safe preflight review actions. Uses apiFetch ONLY (no server.ts /
 * next/headers) so it is importable from client components. The backend
 * re-checks access server-side — JwtGuard + ApplicationAccessGuard on every
 * route — so what this module shows or hides is never the security boundary.
 *
 * Routes (all under /applications/:id/preflight):
 *   GET  mappings                        server-derived fields under review
 *   GET  active                          the open/completed review, if any
 *   GET  coverage                        per portal page: filled count + what is left
 *   POST start                  { mappings }
 *   POST reviews/:rid/checks    { check, value }
 *   POST reviews/:rid/complete  { mappings }   -> locks (locked_diff_hash)
 *   POST reviews/:rid/validate  { mappings }   -> is the lock still valid
 *
 * IMPORTANT: never construct `mappings` on the client. Always pass through what
 * getPreflightMappings returned. The lock is a hash over these; a client-built
 * array that differs by one field silently invalidates the lock, and a client
 * that could choose them could get a field written that no one reviewed.
 */

const base = (applicationId: string) =>
  `/applications/${applicationId}/preflight`

export const getPreflightMappings = (token: string, applicationId: string) =>
  apiFetch<PreflightMappingInput[]>(`${base(applicationId)}/mappings`, token)

/** Per portal page: how many values are entered and what is left for the applicant. Display only. */
export const getPortalFillCoverage = (token: string, applicationId: string) =>
  apiFetch<PortalFillCoverage | null>(`${base(applicationId)}/coverage`, token)

export const getActivePreflight = (token: string, applicationId: string) =>
  apiFetch<PreflightReview | null>(`${base(applicationId)}/active`, token)

/**
 * POST /start answers `{ reviewId, status, diff }`, not a review row, so it is
 * read back through /active. Typing the start response as a PreflightReview
 * gave callers `review.id === undefined`, and every check and the lock then
 * posted to /reviews/undefined/... — no review could ever be completed.
 */
export const startPreflight = async (
  token: string,
  applicationId: string,
  mappings: PreflightMappingInput[],
  submissionSessionId?: string,
): Promise<PreflightReview> => {
  const started = await apiFetch<{ reviewId: string; status: string }>(
    `${base(applicationId)}/start`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ mappings, submissionSessionId }),
    },
  )
  const review = await getActivePreflight(token, applicationId)
  if (!review || review.id !== started.reviewId) {
    throw new Error('The review was started but could not be loaded. Refresh and try again.')
  }
  return review
}

export const recordPreflightCheck = (
  token: string,
  applicationId: string,
  reviewId: string,
  check: PreflightCheckKey,
  value: boolean,
) =>
  apiFetch<PreflightReview>(
    `${base(applicationId)}/reviews/${reviewId}/checks`,
    token,
    { method: 'POST', body: JSON.stringify({ check, value }) },
  )

export const completePreflight = (
  token: string,
  applicationId: string,
  reviewId: string,
  mappings: PreflightMappingInput[],
) =>
  apiFetch<PreflightReview>(
    `${base(applicationId)}/reviews/${reviewId}/complete`,
    token,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  )

export const validatePreflightLock = (
  token: string,
  applicationId: string,
  reviewId: string,
  mappings: PreflightMappingInput[],
) =>
  apiFetch<PreflightLockValidation>(
    `${base(applicationId)}/reviews/${reviewId}/validate`,
    token,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  )

export interface PreflightFieldEditResult {
  mappings: PreflightMappingInput[]
  review: PreflightReview | null
  formUpdated: boolean
  /** No saved form: the correction went to the interview profile. */
  profileUpdated?: boolean
  provenanceUpdated: boolean
}

/**
 * Consultant correction of one field (PUT fields/:fieldKey). Persists to the
 * applicant's saved form and/or field provenance; the server re-derives and
 * returns the mappings and the review (with the covering check reset). Refused
 * with 409 while the review is locked — start a new review first.
 */
export const editPreflightField = (
  token: string,
  applicationId: string,
  fieldKey: string,
  value: string,
  reason?: string,
) =>
  apiFetch<PreflightFieldEditResult>(
    `${base(applicationId)}/fields/${encodeURIComponent(fieldKey)}`,
    token,
    { method: 'PUT', body: JSON.stringify(reason ? { value, reason } : { value }) },
  )
