/**
 * Medical insurance policies read from uploaded documents, and which one an
 * application relies on.
 *
 * An applicant can upload more than one policy — dry run 2026-10-16 (super
 * visa, app 61f16bb5): an expired 21st Century policy (Jun-01-2025 →
 * May-31-2026) and the covering one (2027-03-01 → 2028-03-01). The letters,
 * the form prefill and the readiness score each took the FIRST insurance
 * document they met and so all reported the expired one. They now share this
 * reader and the same choice: the policy that covers the planned stay; failing
 * that, one whose cover cannot be checked; failing that, the one ending last.
 *
 * Pure: no I/O.
 */

export interface InsurancePolicy {
  insurer: string | null;
  policyNumber: string | null;
  coverageAmount: number | null;
  holderName: string | null;
  /** YYYY-MM-DD */
  start: string | null;
  /** YYYY-MM-DD */
  end: string | null;
  /** null when the policy dates or the stay dates are unknown. */
  coversStay: boolean | null;
}

export interface StayDates {
  entryDate: string | null;
  departureDate: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A policy date as printed ("May-31-2026", "2026-05-31", "31/05/2026"). */
export function policyDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^([A-Za-z]{3})[a-z]*[-\s.]+(\d{1,2}),?[-\s.]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()])
    return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})[-\s.]+([A-Za-z]{3})[a-z]*[-\s.]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()])
    return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function amount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.]/g, ''));
    if (/\d/.test(v) && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** One policy document's extracted fields, weighed against the stay. */
export function readPolicy(
  f: Record<string, unknown>,
  stay: StayDates,
): InsurancePolicy {
  const start = policyDate(
    f.coverage_start_date ?? f.start_date ?? f.effective_date,
  );
  const end =
    policyDate(f.coverage_end_date) ??
    policyDate(f.expiry_date) ??
    policyDate(f.end_date);
  let coversStay: boolean | null = null;
  if (stay.entryDate && stay.departureDate && (start || end)) {
    coversStay =
      (!start || start <= stay.entryDate) && !!end && end >= stay.departureDate;
  }
  return {
    insurer: str(f.insurer_name ?? f.insurer ?? f.insurance_company),
    policyNumber: str(f.policy_number),
    coverageAmount: amount(f.coverage_amount),
    holderName: str(f.full_name ?? f.holder_name ?? f.insured_name),
    start,
    end,
    coversStay,
  };
}

const RANK = (p: InsurancePolicy) =>
  p.coversStay === true ? 2 : p.coversStay === null ? 1 : 0;

/**
 * The policy the application relies on: one that covers the stay, else one
 * that cannot be checked, else the one ending last. null when there is none.
 */
export function choosePolicy(
  policies: readonly InsurancePolicy[],
): InsurancePolicy | null {
  let best: InsurancePolicy | null = null;
  for (const p of policies) {
    if (!best) {
      best = p;
      continue;
    }
    const d = RANK(p) - RANK(best);
    if (d > 0 || (d === 0 && (p.end ?? '') > (best.end ?? ''))) best = p;
  }
  return best;
}
