import { resolveExtractionType } from '../ocr/extraction-schema';

/**
 * Type-aware document-expiry policy + deterministic evaluation (GAPS.md §B).
 *
 * The old inline check in store_verification measured a 6-month window from
 * now() despite the warning text saying "within 6 months of intended travel".
 * This module fixes that:
 *  - the window is measured against the application's intended-travel date when
 *    known (falling back to now() only when no travel date is on file), and
 *  - the rule is per document type, not field-presence driven.
 *
 * Policy semantics
 * ----------------
 *  requiresExpiry            — the type is EXPECTED to carry an expiry. When true
 *                              and no expiry was extracted, we emit an explicit
 *                              'unknown'/warn ("confirm manually") instead of
 *                              silently skipping.
 *  minValidityDaysPastTravel — the document must remain valid at least N days
 *                              PAST the intended travel date (e.g. the common
 *                              "passport valid 6 months past entry" rule = 180).
 *  warnWindowDays            — warn when the document expires within N days of
 *                              the reference date (travel date, else now()).
 *
 * These are sane, documented defaults — country/program-specific overrides belong
 * in the strategy layer and are out of scope for this module.
 */
export interface ExpiryPolicy {
  id: string;
  requiresExpiry: boolean;
  minValidityDaysPastTravel: number;
  warnWindowDays: number;
}

const DEFAULT_POLICY: ExpiryPolicy = {
  id: 'default',
  requiresExpiry: false,
  minValidityDaysPastTravel: 0,
  warnWindowDays: 180,
};

const POLICIES: Record<string, ExpiryPolicy> = {
  passport: {
    id: 'passport',
    requiresExpiry: true,
    minValidityDaysPastTravel: 180, // "valid 6 months past intended entry"
    warnWindowDays: 180,
  },
  national_id: {
    id: 'national_id',
    requiresExpiry: true,
    minValidityDaysPastTravel: 0,
    warnWindowDays: 180,
  },
  id_card: {
    id: 'national_id',
    requiresExpiry: true,
    minValidityDaysPastTravel: 0,
    warnWindowDays: 180,
  },
  police_certificate: {
    id: 'police_certificate',
    requiresExpiry: true,
    minValidityDaysPastTravel: 0,
    warnWindowDays: 90, // typically valid 6–12 months
  },
  // Alias: the intake checklist and COMMON_DOCS both name this type
  // `police_clearance`, so without this row every such upload fell through to
  // DEFAULT_POLICY and its expiry was never checked.
  police_clearance: {
    id: 'police_certificate',
    requiresExpiry: true,
    minValidityDaysPastTravel: 0,
    warnWindowDays: 90,
  },
  medical_exam: {
    id: 'medical_exam',
    requiresExpiry: true,
    minValidityDaysPastTravel: 0,
    warnWindowDays: 90,
  },
  medical: {
    id: 'medical_exam',
    requiresExpiry: true,
    minValidityDaysPastTravel: 0,
    warnWindowDays: 90,
  },
  medical_insurance: {
    id: 'medical_insurance',
    requiresExpiry: true,
    minValidityDaysPastTravel: 0, // coverage must extend through travel
    warnWindowDays: 60,
  },
};

/**
 * Other names the checklist uses for a type above. Insurance under any name is
 * the policy, never the exam (#33); a CNIC/NICOP is a national ID.
 */
const POLICY_ALIASES: Record<string, string> = {
  insurance: 'medical_insurance',
  health_insurance: 'medical_insurance',
  travel_insurance: 'medical_insurance',
  travel_health_insurance: 'medical_insurance',
  travel_medical_insurance: 'medical_insurance',
  cnic: 'national_id',
  nicop: 'national_id',
};

export function resolveExpiryPolicy(
  documentType: string | undefined,
): ExpiryPolicy {
  if (!documentType) return DEFAULT_POLICY;
  const t = documentType.toLowerCase().trim();
  // Registry slot names (`proof_of_medical_exam`, `passport_copy`) resolve
  // through the same vocabulary the extractor uses; without this the super
  // visa IME slot fell to the default policy.
  const viaSchema = resolveExtractionType(t);
  return (
    POLICIES[t] ??
    POLICIES[POLICY_ALIASES[t] ?? ''] ??
    (viaSchema ? POLICIES[viaSchema] : undefined) ??
    DEFAULT_POLICY
  );
}

/** IRCC immigration medical exam results are valid 12 months from the exam. */
const MEDICAL_EXAM_VALIDITY_MONTHS = 12;

/**
 * The expiry a document states in other words, when it has no expiry_date:
 * an insurance policy's coverage end, a medical exam's exam date + 12 months.
 * Prod app 61f16bb5: a policy with coverage_end_date 2028-03-01 was reported
 * "expiry date could not be read".
 */
export function expiryFromFields(
  policyId: string,
  fields: Record<string, unknown>,
): Date | null {
  const read = (k: string) =>
    typeof fields[k] === 'string' ? parseDate(fields[k]) : null;
  if (policyId === 'medical_insurance') return read('coverage_end_date');
  if (policyId === 'medical_exam') {
    const exam = read('exam_date');
    return exam ? addMonths(exam, MEDICAL_EXAM_VALIDITY_MONTHS) : null;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Parse a YYYY-MM-DD (or any Date-parseable) string; null when unparseable. */
export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ExpiryVerdict {
  status: 'pass' | 'warn' | 'fail';
  daysUntilExpiry: number;
  requiredValidUntil: string | null; // ISO date (when a travel date drives it)
  basis: string;
}

/**
 * Evaluate a KNOWN expiry date against the policy + (optional) travel date.
 * Callers handle the "no expiry extracted" branch (see evaluate-expiry node).
 */
export function evaluateExpiry(args: {
  expiry: Date;
  travelDate: Date | null;
  now: Date;
  policy: ExpiryPolicy;
  /**
   * A route's own minimum validity after entry, in months, when it is stricter
   * than the type default — super visa medical insurance must run at least 12
   * months from entry. Carried on the checklist slot from the registry.
   */
  minValidityMonths?: number | null;
}): ExpiryVerdict {
  const { expiry, travelDate, now, policy } = args;
  const months =
    typeof args.minValidityMonths === 'number' && args.minValidityMonths > 0
      ? args.minValidityMonths
      : null;
  const daysUntilExpiry = Math.floor(
    (expiry.getTime() - now.getTime()) / DAY_MS,
  );
  const refDate = travelDate ?? now;
  let requiredValidUntil = travelDate
    ? addDays(travelDate, policy.minValidityDaysPastTravel)
    : null;
  if (travelDate && months) {
    const byMonths = addMonths(travelDate, months);
    if (!requiredValidUntil || byMonths > requiredValidUntil) {
      requiredValidUntil = byMonths;
    }
  }

  // A policy is cover for a STAY, so measured against a known stay the
  // finding is "does not cover it", whether it lapsed already or lapses
  // early — "expired" alone told the super visa applicant nothing about what
  // to buy (prod app 61f16bb5).
  if (
    COVERAGE_POLICIES.has(policy.id) &&
    requiredValidUntil &&
    expiry < requiredValidUntil
  ) {
    const until = requiredValidUntil.toISOString().slice(0, 10);
    return {
      status: 'fail',
      daysUntilExpiry,
      requiredValidUntil: until,
      basis:
        `policy does not cover your planned stay: it must be valid until ${until}` +
        (months ? ` (${months} months from your planned entry)` : ''),
    };
  }

  if (expiry < now) {
    return {
      status: 'fail',
      daysUntilExpiry,
      requiredValidUntil:
        requiredValidUntil?.toISOString().slice(0, 10) ?? null,
      basis: 'expired',
    };
  }

  if (requiredValidUntil && expiry < requiredValidUntil) {
    return {
      status: 'fail',
      daysUntilExpiry,
      requiredValidUntil: requiredValidUntil.toISOString().slice(0, 10),
      basis:
        policy.minValidityDaysPastTravel > 0
          ? `must remain valid ${policy.minValidityDaysPastTravel} days past intended travel`
          : 'expires before intended travel',
    };
  }

  if (expiry < addDays(refDate, policy.warnWindowDays)) {
    return {
      status: 'warn',
      daysUntilExpiry,
      requiredValidUntil:
        requiredValidUntil?.toISOString().slice(0, 10) ?? null,
      basis: travelDate
        ? `expires within ${policy.warnWindowDays} days of intended travel`
        : `expires within ${policy.warnWindowDays} days`,
    };
  }

  return {
    status: 'pass',
    daysUntilExpiry,
    requiredValidUntil: requiredValidUntil?.toISOString().slice(0, 10) ?? null,
    basis: 'valid',
  };
}

/** Types that are cover for a stay, judged against the whole stay. */
const COVERAGE_POLICIES = new Set(['medical_insurance']);

function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

// Candidate profile_json keys that may hold the intended travel/entry date.
const TRAVEL_DATE_KEYS = [
  'intended_arrival_date',
  'intended_travel_date',
  'intended_entry_date',
  // The IRCC visitor intake writes this one (prod app 61f16bb5).
  'planned_entry_date',
  'arrival_date',
  'travel_date',
  'date_of_travel',
  'planned_arrival_date',
  'intended_departure_date',
  'departure_date',
];

/** Pull the earliest plausible intended-travel date from an intake profile. */
export function extractTravelDate(
  profile: Record<string, unknown> | null | undefined,
): Date | null {
  if (!profile || typeof profile !== 'object') return null;
  for (const key of TRAVEL_DATE_KEYS) {
    const raw = profile[key];
    if (typeof raw === 'string') {
      const d = parseDate(raw);
      if (d) return d;
    }
  }
  return null;
}
