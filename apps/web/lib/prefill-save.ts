/**
 * Save the applicant's whole form, based on the version they loaded.
 *
 * The API refuses (409) a save built from an older copy — typically because the
 * consultant corrected a value since — so a stale tab can no longer silently
 * revert what portal auto-fill will write. The caller reloads on 'conflict'.
 */
export interface SavableField {
  key: string
  label: string
  value: string
  group?: string
  note?: string
  needsReview?: boolean
}

export type SaveResult<P> =
  | { kind: 'saved'; payload: P; version: string | null }
  | { kind: 'conflict'; message: string }

export async function savePrefillFields<P = unknown>(
  apiUrl: string,
  token: string,
  applicationId: string,
  fields: SavableField[],
  baseVersion: string | null,
): Promise<SaveResult<P>> {
  const res = await fetch(`${apiUrl}/prefill/${applicationId}/fields`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(baseVersion ? { fields, baseVersion } : { fields }),
  })
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    return {
      kind: 'conflict',
      message: body.message ?? 'This form changed since you opened it. Reload to see the latest values.',
    }
  }
  if (!res.ok) throw new Error('Failed to save changes')
  const data = (await res.json()) as { payload: P; version?: string | null }
  return { kind: 'saved', payload: data.payload, version: data.version ?? null }
}
