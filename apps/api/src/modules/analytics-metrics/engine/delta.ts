export function computeDelta(
  total: number,
  baseline: number,
): { baseline: number; pct: number } | null {
  if (baseline === 0) return null;
  return { baseline, pct: (total - baseline) / baseline };
}
