import { plannedStay } from '@visaai/types';
import type { RuleFact } from './rule.types';

/**
 * Translate an intake profile into the facts the rule engine reads.
 *
 * WHY THIS EXISTS
 *
 * Intake extraction (process-answer.ts) writes whatever snake_case key the
 * model picks: `purpose_of_visit: "family visit"`, `previous_visa_refused:
 * true`, `applicant_citizenship: "Pakistan"`, `date_of_birth`. The registry
 * rules are written against the CLOSED vocabulary in rule.types.ts: `purpose`,
 * `has_prior_refusal`, `nationality`, `age`. Passing the raw profile meant
 * every conditional requirement evaluated `unknown` and fell off the checklist
 * — observed on the 2026-10-14 dry run, where a family visitor with a prior
 * refusal got a three-item Canada TRV list with no invitation letter.
 *
 * RULES OF THE MAPPING
 *
 * - Additive. Every original key is kept; normalized keys are added alongside.
 * - A rule fact the profile already states is never overridden by an
 *   inference — except `purpose`, whose value is normalized in place because
 *   free text there can never match a rule's vocabulary anyway.
 * - Conservative. A fact is only set when the profile says it. Absent stays
 *   absent, so the rule stays `unknown` and the item renders "may be
 *   required" — never a guessed `false` that silently drops a document.
 *
 * Pure: `now` is a parameter so age is reproducible in tests.
 */
export function profileToRuleFacts(
  profile: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): Record<string, unknown> {
  const src = profile ?? {};
  const out: Record<string, unknown> = { ...src };

  const setIfAbsent = (fact: RuleFact, value: unknown) => {
    if (value === undefined) return;
    if (isPresent(out[fact])) return;
    out[fact] = value;
  };

  // purpose — normalized in place when it is recognisable text.
  const purposeRaw = first(src, [
    'purpose',
    'purpose_of_visit',
    'visit_purpose',
    'purpose_of_travel',
    'trip_purpose',
    'reason_for_visit',
    'travel_purpose',
  ]);
  if (typeof purposeRaw === 'string' && purposeRaw.trim()) {
    out.purpose = normalizePurpose(purposeRaw) ?? purposeRaw.trim();
  }

  // has_prior_refusal
  setIfAbsent(
    'has_prior_refusal',
    anyBool(src, [
      'previous_visa_refused',
      'prior_visa_refusal',
      'prior_refusal',
      'previous_refusal',
      'previous_visa_refusal',
      'visa_refused',
      'visa_refused_before',
      'refused_visa',
      'has_been_refused',
      'has_visa_refusal',
      'visa_refusal',
      'visa_denied',
      'previous_visa_denied',
    ]),
  );

  // nationality / residence_country — ISO-3166 alpha-2 when recognisable.
  setIfAbsent(
    'nationality',
    toCountryCode(
      first(src, [
        'applicant_citizenship',
        'citizenship',
        'country_of_citizenship',
        'applicant_nationality',
        'nationality_country',
      ]),
    ),
  );
  if (typeof out.nationality === 'string') {
    out.nationality = toCountryCode(out.nationality) ?? out.nationality;
  }
  setIfAbsent(
    'residence_country',
    toCountryCode(
      first(src, [
        'country_of_residence',
        'current_country_of_residence',
        'residence',
        'current_residence_country',
        'applicant_residence_country',
      ]),
    ),
  );

  // stay_duration_days — from the planned DATES when both are known (#20). A
  // stored day count goes stale the moment a date is corrected; the dates are
  // what the applicant actually committed to, so they win over the count.
  const stay = plannedStay(src);
  if (stay.days !== null) out.stay_duration_days = stay.days;
  setIfAbsent(
    'stay_duration_days',
    toNumber(
      first(src, [
        'duration_of_stay_days',
        'stay_days',
        'intended_stay_days',
        'length_of_stay_days',
        'trip_duration_days',
      ]),
    ),
  );

  // age / is_minor
  setIfAbsent(
    'age',
    ageFrom(first(src, ['date_of_birth', 'dob', 'birth_date']), now),
  );
  if (typeof out.age === 'string') out.age = toNumber(out.age) ?? out.age;
  if (typeof out.age === 'number' && Number.isFinite(out.age)) {
    setIfAbsent('is_minor', out.age < 18);
  }

  // has_dependants — the applicant's own children/dependants. Deliberately NOT
  // inferred from the relative being visited (`relationship_to_family_in_
  // destination: "son"` is who they visit, not a dependant on the file) nor
  // from marital status (a married applicant's spouse is not necessarily a
  // dependant on this application).
  setIfAbsent('has_dependants', dependantsFrom(src));
  const count = toNumber(
    first(src, [
      'dependant_count',
      'dependent_count',
      'number_of_dependants',
      'number_of_dependents',
    ]),
  );
  setIfAbsent('dependant_count', count);

  // has_sponsor — only from an explicit statement or a named sponsor.
  setIfAbsent(
    'has_sponsor',
    anyBool(src, ['has_sponsor', 'sponsored', 'has_financial_sponsor']) ??
      (isPresent(src.sponsor_name) ? true : undefined),
  );
  const sponsorRel = first(src, [
    'relationship_to_sponsor',
    'sponsor_relation',
  ]);
  if (typeof sponsorRel === 'string' && sponsorRel.trim()) {
    setIfAbsent('sponsor_relationship', sponsorRel.trim().toLowerCase());
  }

  // marital_status — snake_case so "Common-law" matches "common_law".
  if (typeof out.marital_status === 'string') {
    out.marital_status = out.marital_status
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  }

  // has_prior_travel
  const history = first(src, [
    'travel_history_countries',
    'countries_visited',
    'previous_travel_countries',
  ]);
  setIfAbsent(
    'has_prior_travel',
    anyBool(src, [
      'has_travelled_abroad',
      'has_traveled_abroad',
      'traveled_abroad',
      'travelled_abroad',
    ]) ?? (Array.isArray(history) && history.length > 0 ? true : undefined),
  );

  // has_prior_travel also follows from a previous trip to the destination.
  setIfAbsent(
    'has_prior_travel',
    anyBool(src, [
      'previously_visited_canada',
      'visited_canada_before',
      'has_visited_canada',
      'travelled_to_canada_before',
      'traveled_to_canada_before',
    ]) === true
      ? true
      : undefined,
  );

  // uses_representative — IMM 5476 and its peers hang off it. Before this was
  // mapped the rule could only ever evaluate `unknown`, so the form sat on the
  // checklist as "may be required" even after the applicant named their
  // representative.
  setIfAbsent(
    'uses_representative',
    anyBool(src, [
      'uses_representative',
      'has_representative',
      'using_representative',
      'uses_authorized_representative',
    ]),
  );

  // passport_type — normalized in place to the rule vocabulary
  // (ordinary | diplomatic | official | service) when recognisable.
  if (typeof src.passport_type === 'string') {
    const pt = normalizePassportType(src.passport_type);
    if (pt) out.passport_type = pt;
  }

  setIfAbsent(
    'has_criminal_record',
    anyBool(src, [
      'criminal_record',
      'criminal_history',
      'has_criminal_history',
    ]),
  );
  setIfAbsent(
    'travelling_with_minor',
    anyBool(src, [
      'traveling_with_minor',
      'travelling_with_children',
      'traveling_with_children',
    ]),
  );

  return out;
}

const PURPOSE_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(family|relatives?|sons?|daughters?|grand\w*|parents?|mother|father|mom|mum|dad|brothers?|sisters?|siblings?|child(ren)?|kids?|spouse|wife|husband|niece|nephew|cousins?|aunt|uncle|in-laws?)\b/i,
    'visit_family',
  ],
  [/\bfriends?\b/i, 'visit_friends'],
  [/\b(medical|treatment|hospital|surgery)\b/i, 'medical'],
  [
    /\b(study|studies|student|school|university|college|academic|course)\b/i,
    'study',
  ],
  [/\b(business|conference|meetings?|trade fair|client)\b/i, 'business'],
  [/\btransit\b/i, 'transit'],
  [
    /\b(touris[mt]|holiday|vacation|sightseeing|leisure|travel(ling)? for pleasure)\b/i,
    'tourism',
  ],
  [/\b(work|employment|job)\b/i, 'work'],
];

function normalizePassportType(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/\b(regular|ordinary|normal|standard|tourist)\b/.test(t) || t === 'p')
    return 'ordinary';
  if (/\bdiplomatic\b/.test(t) || t === 'pd') return 'diplomatic';
  if (/\bofficial\b/.test(t) || t === 'po') return 'official';
  if (/\bservice\b/.test(t) || t === 'ps') return 'service';
  return null;
}

/** Map free-text purpose to the rule vocabulary, or null when unrecognised. */
export function normalizePurpose(text: string): string | null {
  const t = text.trim();
  for (const [re, value] of PURPOSE_PATTERNS) {
    if (re.test(t)) return value;
  }
  return null;
}

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

function first(src: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (isPresent(src[k])) return src[k];
  return undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['yes', 'y', 'true'].includes(s)) return true;
    if (['no', 'n', 'false', 'none', 'never'].includes(s)) return false;
  }
  if (Array.isArray(v)) return v.length > 0;
  return undefined;
}

/** True if any listed key is true; false only if some key is false and none true. */
function anyBool(
  src: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  let sawFalse = false;
  for (const k of keys) {
    const b = toBool(src[k]);
    if (b === true) return true;
    if (b === false) sawFalse = true;
  }
  return sawFalse ? false : undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return undefined;
}

function ageFrom(dob: unknown, now: Date): number | undefined {
  if (typeof dob !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < mo ||
    (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

function dependantsFrom(src: Record<string, unknown>): boolean | undefined {
  const explicit = anyBool(src, [
    'has_dependants',
    'has_dependents',
    'has_children',
  ]);
  if (explicit !== undefined) return explicit;
  const n = toNumber(
    first(src, [
      'number_of_children',
      'children_count',
      'num_children',
      'dependant_count',
      'dependent_count',
      'number_of_dependants',
      'number_of_dependents',
    ]),
  );
  if (n !== undefined && n > 0) return true;
  const list = first(src, ['dependants', 'dependents', 'children']);
  if (Array.isArray(list) && list.length > 0) return true;
  return undefined;
}

const DEMONYMS: Record<string, string> = {
  pakistani: 'PK',
  indian: 'IN',
  bangladeshi: 'BD',
  nigerian: 'NG',
  chinese: 'CN',
  filipino: 'PH',
  filipina: 'PH',
  american: 'US',
  canadian: 'CA',
  british: 'GB',
  iranian: 'IR',
  mexican: 'MX',
  brazilian: 'BR',
  afghan: 'AF',
  egyptian: 'EG',
  turkish: 'TR',
  'sri lankan': 'LK',
  nepali: 'NP',
  nepalese: 'NP',
  vietnamese: 'VN',
  ghanaian: 'GH',
  kenyan: 'KE',
  australian: 'AU',
  german: 'DE',
  french: 'FR',
  irish: 'IE',
};

let nameToCode: Map<string, string> | null = null;
function countryNameIndex(): Map<string, string> {
  if (nameToCode) return nameToCode;
  nameToCode = new Map();
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i += 1) {
      for (let j = 0; j < 26; j += 1) {
        const code = String.fromCharCode(A + i, A + j);
        const name = dn.of(code);
        if (name && name !== code) nameToCode.set(name.toLowerCase(), code);
      }
    }
  } catch {
    // No ICU data: country names stay unmapped, codes still work.
  }
  nameToCode.set('usa', 'US');
  nameToCode.set('united states of america', 'US');
  nameToCode.set('uk', 'GB');
  nameToCode.set('england', 'GB');
  return nameToCode;
}

function toCountryCode(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase();
  const lower = s.toLowerCase();
  return DEMONYMS[lower] ?? countryNameIndex().get(lower);
}
