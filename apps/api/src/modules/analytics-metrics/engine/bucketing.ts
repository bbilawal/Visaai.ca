import type { Grain } from '../contracts/metric.contract';

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bucketKey(dayIso: string, grain: Grain): string {
  const d = toUtcDate(dayIso);
  if (grain === 'day') return dayIso;
  if (grain === 'month') return `${dayIso.slice(0, 7)}-01`;
  // week: shift back to Monday (getUTCDay: 0=Sun..6=Sat)
  const dow = d.getUTCDay();
  const delta = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - delta);
  return fmt(d);
}

function stepBuckets(from: string, to: string, grain: Grain): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const end = toUtcDate(to);
  for (let d = toUtcDate(from); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = bucketKey(fmt(d), grain);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

export function bucketize(
  rows: { day: string; value: number }[],
  from: string,
  to: string,
  grain: Grain,
): { bucket: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const k of stepBuckets(from, to, grain)) sums.set(k, 0);
  for (const r of rows) {
    const k = bucketKey(r.day, grain);
    if (sums.has(k)) sums.set(k, (sums.get(k) ?? 0) + r.value);
  }
  return [...sums.entries()].map(([bucket, value]) => ({ bucket, value }));
}
