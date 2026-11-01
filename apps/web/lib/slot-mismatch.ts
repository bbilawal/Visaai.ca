/**
 * The "wrong document for this slot" verdict the document pipeline stores on
 * the identity verification row (`details_json.slot_mismatch`), e.g. a
 * passport bio page uploaded as evidence of previous travel. Null when the
 * upload fits its slot or was never checked.
 */
export interface SlotMismatch {
  expected: string
  detected: string
  message: string
}

export function slotMismatchOf(
  verifications: Array<{ verification_type: string; details_json?: Record<string, unknown> | null }>,
): SlotMismatch | null {
  for (const v of verifications) {
    if (v.verification_type !== 'identity') continue
    const m = v.details_json?.slot_mismatch as Partial<SlotMismatch> | undefined
    if (m && typeof m.message === 'string' && m.message.trim()) {
      return {
        expected: String(m.expected ?? ''),
        detected: String(m.detected ?? ''),
        message: m.message,
      }
    }
  }
  return null
}
