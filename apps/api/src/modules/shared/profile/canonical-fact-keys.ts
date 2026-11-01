/**
 * One key per fact, deterministically, whatever the extractor called it.
 *
 * Prod 2026-10-17, app 61f16bb5 (Canada super visa): the applicant said "born
 * in Rawalpindi" twice and the reply claimed it was recorded, but the profile
 * held `birthplace_city: "Rawalpindi"` next to `place_of_birth: null` — and
 * place_of_birth is what IMM 5257's PlaceBirthCity and the prefill read. The
 * model is now told the canonical names too, but a prompt is a request; this
 * is the guarantee.
 *
 * Synonyms are MOVED onto the canonical key only when the canonical key holds
 * no value of its own. Unknown keys are never dropped.
 */
export const FACT_KEY_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  place_of_birth: [
    'birthplace_city',
    'birthplace',
    'birth_place',
    'city_of_birth',
    'birth_city',
    'town_of_birth',
    'place_of_birth_city',
  ],
  // IMM 5257's Occupation field and the eTA route both read `occupation`.
  occupation: [
    'current_occupation',
    'current_job',
    'profession',
    'applicant_occupation',
  ],
  // canada-ircc.ts reads `phone_type` (live 2026-10-29: "(mobile)" was lost).
  phone_type: ['phone_number_type', 'telephone_number_type'],
  second_inviter_name: [
    'second_host_name',
    'second_inviter_full_name',
    'second_host_full_name',
    'additional_inviter_name',
  ],
  second_inviter_address: [
    'second_host_address',
    'second_inviter_home_address',
  ],
  second_inviter_phone: [
    'second_host_phone',
    'second_inviter_phone_number',
    'second_inviter_telephone',
  ],
  second_inviter_email: ['second_host_email'],
  second_inviter_relationship: ['second_host_relationship'],
};

function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/**
 * The extraction with each known synonym moved onto its canonical key.
 * `protectedKeys` are keys the route asks under their own name (the eTA asks
 * `city_of_birth`); those stay where the extractor put them.
 */
export function canonicalizeFactKeys(
  extracted: Record<string, unknown>,
  protectedKeys: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const out = { ...extracted };
  for (const [canonical, synonyms] of Object.entries(FACT_KEY_SYNONYMS)) {
    for (const syn of synonyms) {
      if (protectedKeys.has(syn) || !(syn in out) || !present(out[syn]))
        continue;
      if (present(out[canonical])) continue;
      out[canonical] = out[syn];
      delete out[syn];
    }
  }
  return out;
}

/**
 * Canonical values a stored profile is missing but holds under a synonym —
 * the repair for rows written before the extraction was canonicalised.
 * Gap-fill only: never overwrites a canonical value.
 */
export function canonicalGapFill(
  profile: Record<string, unknown>,
  protectedKeys: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [canonical, synonyms] of Object.entries(FACT_KEY_SYNONYMS)) {
    if (present(profile[canonical])) continue;
    const syn = synonyms.find(
      (k) => !protectedKeys.has(k) && present(profile[k]),
    );
    if (syn) patch[canonical] = profile[syn];
  }
  return patch;
}

// ── second inviter ──────────────────────────────────────────────────────────

/** Primary-inviter keys (canonical and aliases) → the second inviter's key. */
const SECOND_INVITER_TARGET: Readonly<Record<string, string>> = {
  inviter_name: 'second_inviter_name',
  inviter_full_name: 'second_inviter_name',
  host_name: 'second_inviter_name',
  host_full_name: 'second_inviter_name',
  inviter_address: 'second_inviter_address',
  host_address: 'second_inviter_address',
  host_home_address: 'second_inviter_address',
  inviter_phone: 'second_inviter_phone',
  host_phone: 'second_inviter_phone',
  host_telephone: 'second_inviter_phone',
  inviter_phone_type: 'second_inviter_phone_type',
  host_phone_type: 'second_inviter_phone_type',
  inviter_email: 'second_inviter_email',
  host_email: 'second_inviter_email',
  inviter_relationship: 'second_inviter_relationship',
  host_relationship: 'second_inviter_relationship',
  inviter_date_of_birth: 'second_inviter_date_of_birth',
  inviter_dob: 'second_inviter_date_of_birth',
  host_date_of_birth: 'second_inviter_date_of_birth',
  host_dob: 'second_inviter_date_of_birth',
  inviter_status: 'second_inviter_status',
  host_status: 'second_inviter_status',
  host_immigration_status: 'second_inviter_status',
  host_citizenship_status: 'second_inviter_status',
};

const INVITER_NAME_KEYS = [
  'inviter_name',
  'inviter_full_name',
  'host_name',
  'host_full_name',
];

function nameOf(record: Record<string, unknown>): string | null {
  for (const k of INVITER_NAME_KEYS) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** "Bilawal" and "Mian Muhammad Bilawal" are one person; Sajawal is not. */
export function samePerson(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

/** "Is anyone else inviting you besides …?" / "Is a second person also inviting you?" */
export function isSecondInviterQuestion(question: string | null | undefined) {
  const q = question ?? '';
  return (
    /invit|\bhosts?\b|co-?sign/i.test(q) &&
    /\b(second|another|anyone else|someone else|besides|other than|in addition to)\b/i.test(
      q,
    )
  );
}

/**
 * Keep the primary inviter's fields for the primary inviter.
 *
 * Prod 2026-10-16, app 61f16bb5: asked "Is anyone else inviting you to Canada
 * besides your primary inviter, Mian Muhammad Bilawal?", the applicant named
 * her other son at 1228 Turner Drive, and the extractor wrote that address to
 * `inviter_address` — the primary's — with no second_inviter_* at all. The
 * IMM 5257 host address then showed the wrong son's house.
 *
 * Inviter fields in the extraction move to second_inviter_* when
 *  - they name a different person from the inviter on file, or
 *  - they answer the second-inviter question and do not name the primary.
 * A second_inviter_* value the extractor gave itself is never overwritten.
 */
export function routeSecondInviter(
  profile: Record<string, unknown>,
  extracted: Record<string, unknown>,
  question: string | null | undefined,
): Record<string, unknown> {
  const hasInviterKey = Object.keys(extracted).some(
    (k) => k in SECOND_INVITER_TARGET && present(extracted[k]),
  );
  if (!hasInviterKey) return extracted;

  const primary = nameOf(profile);
  const named = nameOf(extracted);
  const route =
    named && primary
      ? !samePerson(named, primary)
      : isSecondInviterQuestion(question);
  if (!route) return extracted;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extracted)) {
    if (!(k in SECOND_INVITER_TARGET)) out[k] = v;
  }
  let moved = false;
  for (const [k, v] of Object.entries(extracted)) {
    const target = SECOND_INVITER_TARGET[k];
    if (!target || !present(v)) continue;
    if (!present(out[target])) {
      out[target] = v;
      moved = true;
    }
  }
  if (!('has_second_inviter' in out)) out.has_second_inviter = true;
  // Provenance: these second-inviter facts were moved here by this guess,
  // not given as the second inviter's. The IRCC fill does not type them
  // (canada-ircc.ts secondInviterConfirmed); the applicant does.
  if (moved && !present(out.second_inviter_source))
    out.second_inviter_source = 'router';
  return out;
}
