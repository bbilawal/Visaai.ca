import { ApiError } from '@/lib/api/client'

/**
 * Statuses nginx returns while the API process is down — a deploy swaps the
 * build in with one pm2 restart, and requests in that window get 502 (no
 * upstream), 503 or 504. None of them says anything about the request itself.
 */
const RESTART_STATUSES = new Set([502, 503, 504])

export function isRestartStatus(status: number): boolean {
  return RESTART_STATUSES.has(status)
}

/**
 * Thrown when the API could not be reached or answered with a gateway error:
 * the user should simply retry shortly, not read a generic failure.
 */
export class ApiUnavailableError extends Error {
  constructor() {
    super('API unavailable')
    this.name = 'ApiUnavailableError'
  }
}

/**
 * Whether `err` means "the API is briefly unavailable": a network failure
 * (fetch rejects with a TypeError — "Failed to fetch" / "Load failed"), an
 * ApiError carrying a gateway status, or an ApiUnavailableError.
 *
 * Only pass errors from a fetch/apiFetch call: a TypeError from a bug in our
 * own code would otherwise read as a restart.
 */
export function isApiUnavailable(err: unknown): boolean {
  if (err instanceof ApiUnavailableError) return true
  if (err instanceof ApiError) return isRestartStatus(err.status)
  return err instanceof TypeError
}
