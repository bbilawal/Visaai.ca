/**
 * Distinct-user count with anon->user stitching. Keys on
 * coalesce(userId, identityMap[anonymousId], anonymousId) so a human active
 * anonymously and then post-login counts once. Append-only event stream is never mutated.
 */
export function resolveDistinct(
  events: { userId: string | null; anonymousId: string | null }[],
  identityMap: Map<string, string>,
): number {
  const keys = new Set<string>();
  for (const e of events) {
    const key =
      e.userId ??
      (e.anonymousId
        ? (identityMap.get(e.anonymousId) ?? e.anonymousId)
        : null);
    if (key) keys.add(key);
  }
  return keys.size;
}
