/**
 * The "this document seems to name someone else" note the document pipeline
 * stores on the identity verification row (`details_json.holder_mismatch`):
 * a personal document (passport, ID, birth / police / marriage certificate)
 * in one of the applicant's own slots whose printed holder is neither the
 * applicant nor anyone else on the profile. Non-blocking — the document still
 * counts; the applicant is only told. Null when there is no such note.
 *
 * `held`: a passport whose name shares nothing with the name the applicant
 * gave, with no date of birth to say whose it is (`needs_confirmation`). The
 * API fills no form from it and does not attach it to a portal until a
 * consultant approves it or the applicant confirms it ("This is my passport",
 * confirmHolder).
 *
 * `clearlyOther`: clearly someone else's (`clearly_other`) — never used, and
 * not confirmable.
 */
export interface HolderMismatch {
  holder: string
  applicant: string
  message: string
  held: boolean
  clearlyOther: boolean
}

type VerificationLike = { verification_type: string; details_json?: Record<string, unknown> | null }

export function holderMismatchOf(verifications: VerificationLike[]): HolderMismatch | null {
  for (const v of verifications) {
    if (v.verification_type !== 'identity') continue
    const m = v.details_json?.holder_mismatch as
      | (Partial<Omit<HolderMismatch, 'held' | 'clearlyOther'>> & {
          needs_confirmation?: unknown
          clearly_other?: unknown
        })
      | undefined
    if (
      m &&
      typeof m.holder === 'string' &&
      m.holder.trim() &&
      typeof m.applicant === 'string' &&
      m.applicant.trim()
    ) {
      return {
        holder: m.holder.trim(),
        applicant: m.applicant.trim(),
        message: typeof m.message === 'string' ? m.message : '',
        held: m.needs_confirmation === true,
        clearlyOther: m.clearly_other === true,
      }
    }
  }
  return null
}

/**
 * What the Identity line shows. The pipeline writes the identity row's
 * `result` (store_verification) before sync_profile decides whose document it
 * is, so a held or someone-else's passport still says "pass" there. The note
 * on the row overrides it: `needs_confirmation` for a held passport,
 * `not_yours` for one that is clearly someone else's. Other rows: as stored.
 */
export type IdentityResult = 'pass' | 'warn' | 'fail' | 'needs_confirmation' | 'not_yours' | string

export function identityResultOf(v: VerificationLike & { result: string }): IdentityResult {
  if (v.verification_type === 'identity') {
    const m = v.details_json?.holder_mismatch as { needs_confirmation?: unknown; clearly_other?: unknown } | undefined
    if (m?.clearly_other === true) return 'not_yours'
    if (m?.needs_confirmation === true) return 'needs_confirmation'
  }
  return v.result
}

/** The applicant's own "this passport is mine", as stored on the identity row. */
export interface HolderConfirmation {
  confirmedAt: string | null
  holder: string | null
  statedName: string | null
}

export function holderConfirmationOf(verifications: VerificationLike[]): HolderConfirmation | null {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  for (const v of verifications) {
    if (v.verification_type !== 'identity') continue
    const c = v.details_json?.holder_confirmation
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      const r = c as Record<string, unknown>
      return { confirmedAt: text(r.confirmed_at), holder: text(r.holder), statedName: text(r.stated_name) }
    }
  }
  return null
}

/**
 * POST /documents/item/:id/confirm-holder. Throws 'rate_limited',
 * 'not_confirmable' (409: not held, or clearly someone else's),
 * 'unavailable' (503: could not be recorded right now — retry later) or
 * 'failed'.
 */
export async function confirmHolder(
  apiUrl: string | undefined,
  token: string,
  documentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${apiUrl}/documents/item/${documentId}/confirm-holder`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 429) throw new Error('rate_limited')
  if (res.status === 409) throw new Error('not_confirmable')
  if (res.status === 503) throw new Error('unavailable')
  if (!res.ok) throw new Error('failed')
}
