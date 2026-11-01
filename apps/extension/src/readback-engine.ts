/**
 * Readback Engine — Phase 7F. PURE compare + verification layer.
 *
 * Given a value that was already read back from the portal (the DOM read is the
 * executor's job, not this module's), it normalizes, hashes, and compares to the
 * expected value hash. It contains NO DOM access, NO write/mutation, and NO
 * orchestration loop — just one deterministic per-value verification.
 *
 * Normalization MUST mirror the server's value-hash (trim + NFC, sha256 hex) so
 * the spine holds: provenance → confirm → approve → preflight-lock → expected →
 * readback actual.
 */
export interface FieldVerifyResult {
  outcome: 'verified' | 'failed'
  reason?: 'value_mismatch'
  actualValueHash: string
}

/** Mirror of the server value-hash normalization. */
export function normalizeValue(value: string): string {
  return value.trim().normalize('NFC')
}

/** sha256 hex of the input (Web Crypto — available in content scripts + Node ≥20). */
export async function hashValue(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Verify a read-back value against the expected hash. Pure; no side effects. */
export async function verifyField(
  actualValue: string,
  expectedValueHash: string,
): Promise<FieldVerifyResult> {
  const actualValueHash = await hashValue(normalizeValue(actualValue))
  const match = actualValueHash === expectedValueHash
  return {
    outcome: match ? 'verified' : 'failed',
    reason: match ? undefined : 'value_mismatch',
    actualValueHash,
  }
}
