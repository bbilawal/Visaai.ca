/**
 * One verification row per type (the newest), newest first.
 *
 * The document pipeline used to append an identity row on every BullMQ retry,
 * so a failed document rendered "Identity ✗ Fail" three times (dry run
 * 2026-10-14). The API now replaces its rows per run; this keeps documents
 * processed before that fix from showing the duplicates.
 */
export function latestVerifications<
  T extends { verification_type: string; verified_at?: string | null },
>(rows: T[]): T[] {
  const ts = (r: T) => (r.verified_at ? Date.parse(r.verified_at) || 0 : 0)
  const byType = new Map<string, T>()
  const order: string[] = []
  for (const r of rows) {
    const cur = byType.get(r.verification_type)
    if (!cur) {
      order.push(r.verification_type)
      byType.set(r.verification_type, r)
    } else if (ts(r) >= ts(cur)) {
      byType.set(r.verification_type, r)
    }
  }
  return order
    .map(t => byType.get(t) as T)
    .sort((a, b) => ts(b) - ts(a))
}
