import { ApiError } from './client'

export const NOT_ASSIGNEE_MESSAGE =
  "You're not the assigned consultant for this application. Sign in with the assigned consultant account."

/**
 * What to tell the consultant when a decision action fails.
 *
 * Live 2026-10-19: "Yes, approve" got a 403 ("consultant … is not the active
 * assignee" — the browser had switched accounts) and the page looked unchanged.
 * `ApiError.message` is the terse `POST /path -> 403` line, so the server's own
 * reason (403 assignee, 409 lock gate, 503 gate not loaded) never reached the
 * consultant. Prefer the server's reason; translate not-assignee into what to
 * do about it.
 */
export function consultantActionError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403 && /not the active assignee/i.test(err.detail ?? '')) {
      return NOT_ASSIGNEE_MESSAGE
    }
    if (err.detail) return err.detail
    return `${fallback} (error ${err.status})`
  }
  return err instanceof Error && err.message ? err.message : fallback
}
