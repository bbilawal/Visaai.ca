import type {
  ExecutionRequestDecision,
  PreflightMappingInput,
} from '@visaai/types'
import { apiFetch } from './client'

/**
 * Client-safe execution request. Uses apiFetch ONLY (no server.ts /
 * next/headers) so it is importable from client components.
 *
 * POST /execution/request is the gate between a reviewed application and a
 * portal fill. It re-runs the full eligibility evaluation server-side and, only
 * if everything still holds, returns a signed readback token bound to the
 * current preflight lock. It starts nothing: the token is an authorization to
 * request a fill, not the fill itself.
 *
 * `mappings` must be exactly what GET /preflight/mappings returned — the token
 * is minted against a hash of them, and a client-built array would either fail
 * the lock check or authorize fields nobody reviewed.
 */
export interface ExecutionRequestBody {
  applicationId: string
  preflightReviewId: string
  mappings: PreflightMappingInput[]
  token: string
  sessionId: string
  /** The applicant's explicit confirmation. The API refuses the request without it. */
  userConfirmationFlag: boolean
}

export const requestExecution = (token: string, body: ExecutionRequestBody) =>
  apiFetch<ExecutionRequestDecision>('/execution/request', token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
