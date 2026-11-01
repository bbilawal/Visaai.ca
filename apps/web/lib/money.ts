/** Format an integer minor-unit (cents) amount as a currency string. */
export function centsToUsd(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format((cents ?? 0) / 100);
}

/** Parse a user-entered dollar string to integer cents (null when blank/invalid). */
export function usdToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
