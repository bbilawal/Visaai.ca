import {
  isSeasonalAgriculturalWorker,
  nationalityCode,
  plannedStay,
  stayDaysInclusive,
  workPermitKindOf,
  workPermitPrincipalOf,
  worksInQuebecOf,
} from '@visaai/types';
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
 *   free text there can never match a rule's vocabulary anyway, and
 *   `business_activity`, which is normalized or REMOVED: unrecognised text
 *   would make an `eq` rule false and silently drop a document.
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
    out.nationality =
      toCountryCode(out.nationality) ??
      nationalityCode(out.nationality) ??
      out.nationality;
  }
  // A passport MRZ writes "PAK"; the shared normaliser reads alpha-3 codes and
  // the passport's issuing country, so a nationality rule can still decide.
  setIfAbsent(
    'nationality',
    nationalityCode(
      first(src, [
        'passport_country',
        'passport_issuing_country',
        'passport_nationality',
      ]),
    ) ?? undefined,
  );
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

  // A study permit asks the study dates, not trip dates (IMM 1294 "Details of
  // intended study"), so the planned stay is the program. Only a fallback: a
  // stay from trip dates or an explicit count above wins. Without it the
  // "more than 6 months" medical-exam rule stayed `unknown` for every student.
  setIfAbsent(
    'stay_duration_days',
    spanDays(
      first(src, [
        'study_start_date',
        'program_start_date',
        'studies_start_date',
      ]),
      first(src, [
        'study_end_date',
        'program_end_date',
        'studies_end_date',
        'expected_completion_date',
      ]),
    ),
  );

  // A work permit asks the work dates (IMM 1295 "Duration of expected
  // employment"), not trip dates. Same fallback as the study dates, so the
  // "more than 6 months" medical rule and the CAQ's "more than 30 days" can
  // decide for a worker. Only on a work permit profile (the work interview
  // writes work_permit_type): this mapper does not know the route, and a
  // visitor's extracted past job must never become a "stay" (review 2026-10-29).
  if (
    first(src, [
      'work_permit_type',
      'work_permit_category',
      'type_of_work_permit',
    ]) !== undefined
  )
    setIfAbsent(
      'stay_duration_days',
      spanDays(
        first(src, ['work_start_date', 'intended_work_start_date']),
        first(src, ['work_end_date', 'intended_work_end_date']),
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

  // marital_status — the registry's values (married, common_law, de_facto),
  // so "Common-law partner" or "legally married" still matches. An exact
  // match only hid both relationship-proof slots from a common-law couple
  // whose answer was worded longer (review of #250, 2026-10-19).
  if (typeof out.marital_status === 'string') {
    out.marital_status = canonicalMaritalStatus(out.marital_status);
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

  // Canada eTA facts (rule.types.ts). Same keys and aliases the eTA
  // interview writes (@visaai/types intake-requirements, IRCC_ETA_FACTS).
  setIfAbsent(
    'us_lpr',
    anyBool(src, [
      'us_permanent_resident',
      'is_us_permanent_resident',
      'us_lawful_permanent_resident',
      'has_us_green_card',
      'us_green_card',
    ]),
  );
  setIfAbsent(
    'travel_by_air',
    anyBool(src, ['arriving_by_air', 'flying_to_canada']),
  );
  setIfAbsent(
    'valid_us_nonimmigrant_visa',
    anyBool(src, [
      'has_valid_us_visa',
      'valid_us_visa',
      'holds_us_visa',
      'has_us_visa',
    ]),
  );
  setIfAbsent(
    'canadian_visa_last_10y',
    anyBool(src, [
      'held_canadian_visa_last_10_years',
      'had_canadian_visa_10_years',
    ]),
  );
  // The canonical keys themselves may hold "yes"/"no" text.
  for (const k of [
    'us_lpr',
    'travel_by_air',
    'valid_us_nonimmigrant_visa',
    'canadian_visa_last_10y',
  ] as const) {
    if (typeof out[k] === 'string') {
      const b = toBool(out[k]);
      if (b !== undefined) out[k] = b;
    }
  }

  // business_activity — what a business visitor will do in the destination,
  // normalized to the closed vocabulary in rule.types.ts. An explicit
  // business-activity answer (or alias) DECIDES it: if one was given but is
  // not recognisable, the fact stays unset ("may be required") and the purpose
  // text is NOT consulted — "fixing the machines we sold" with a purpose of
  // "Business meetings" must not become `meetings` and drop the warranty
  // documents. Only with no explicit answer is the raw purpose text read.
  const explicitActivity = first(src, [
    'business_activity',
    'business_activities',
    'business_purpose',
    'purpose_of_business_visit',
    'business_visit_activity',
  ]);
  delete out.business_activity;
  const activity =
    explicitActivity !== undefined
      ? normalizeBusinessActivity(explicitActivity)
      : typeof purposeRaw === 'string'
        ? normalizeBusinessActivity(purposeRaw)
        : undefined;
  if (activity) out.business_activity = activity;

  // Canada work permit facts (rule.types.ts). Read through the same
  // @visaai/types classifiers the work interview (IRCC_WORK_FACTS) uses, so
  // the checklist and the interview never disagree on the permit kind.
  // work_permit_type is normalized or REMOVED, like business_activity: free
  // text such as "start-up visa" must not make an `in` rule false and drop
  // the employer documents; unset, the rows read "may be required".
  const workKind = workPermitKindOf(src);
  if (workKind) out.work_permit_type = workKind;
  else delete out.work_permit_type;
  setIfAbsent('works_in_quebec', worksInQuebecOf(src));
  setIfAbsent('open_permit_principal', workPermitPrincipalOf(src));

  // The medical-exam triggers other than stay-and-residence. The work
  // interview asks ONE question for both public-health jobs and agriculture
  // ("health care, a clinical laboratory, child care, a school, in-home
  // caregiving, domestic work, or agriculture?"), because IRCC asks an exam of
  // both — of a public-health job always, of an agricultural worker only after
  // 6+ months in a listed country. A reply that names only agriculture is read
  // as agriculture; a bare "yes" as a public-health job (the exam upload never
  // blocks the forms); "no" rules out both.
  const healthRaw = first(src, [
    'public_health_occupation',
    'public_health_job',
  ]);
  delete out.public_health_occupation;
  const health = occupationFacts(healthRaw);
  if (health.publicHealth !== undefined)
    out.public_health_occupation = health.publicHealth;
  if (isSeasonalAgriculturalWorker(src)) out.agricultural_occupation = true;
  else setIfAbsent('agricultural_occupation', health.agricultural);
  setIfAbsent(
    'ime_country_six_months',
    leadingYesNo(
      first(src, [
        'designated_country_six_months',
        'lived_in_designated_country',
      ]),
    ),
  );

  // resident_non_citizen — IRCC: "if you're not a citizen of the country or
  // territory where you're applying, you must send proof of your present
  // immigration status in that country or territory." Only when both
  // countries are known codes; a second citizenship of the residence country
  // counts as a citizen.
  if (
    typeof out.residence_country === 'string' &&
    /^[A-Z]{2}$/.test(out.residence_country) &&
    typeof out.nationality === 'string' &&
    /^[A-Z]{2}$/.test(out.nationality)
  ) {
    // The interview stores dual citizenship as other_citizenships (a list).
    const others = [
      out.second_nationality,
      ...[
        src.other_citizenships,
        src.other_citizenship,
        src.additional_citizenships,
      ].flatMap((v) =>
        Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : [],
      ),
    ]
      .map((v) => toCountryCode(typeof v === 'string' ? v.trim() : v))
      .filter((c): c is string => !!c);
    setIfAbsent(
      'resident_non_citizen',
      out.residence_country !== out.nationality &&
        !others.includes(out.residence_country),
    );
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

// Order matters, and the first match wins: after-sales service is checked
// FIRST because it is the one activity that requires documents (warranty or
// service agreements, contracts). "Meetings with the client and technical
// support on the software we sold" is after-sales service, not meetings —
// classifying it as meetings would drop a document IRCC asks for.
const BUSINESS_ACTIVITY_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(after[\s-]?sales?|warrant(y|ies)|repair\w*|fix|fixing|servicing|servic(e|es) (the |our |of )?(equipment|machine\w*|systems?|products?)|technical support|support (on|for)|upgrad\w*|install\w*|maintenance|commissioning|(servic(e|es)|support)[\s-](contracts?|agreements?))\b/i,
    'after_sales_service',
  ],
  [/\b(train(ing|ed)?|instruct\w*)\b/i, 'training'],
  [/\b(buy(ing)?|purchas\w*|sourcing|procure\w*)\b/i, 'buying_goods'],
  [
    /\b(meetings?|meet(ing)? (with )?clients?|conferences?|conventions?|trade (fair|show)s?|negotiat\w*|consultations?|seminars?)\b/i,
    'meetings',
  ],
];

/** Map free-text business activity to the rule vocabulary, or undefined. */
export function normalizeBusinessActivity(v: unknown): string | undefined {
  const text = Array.isArray(v)
    ? v.filter((x) => typeof x === 'string').join('; ')
    : v;
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const t = text.trim();
  const canonical = t.toLowerCase().replace(/[\s-]+/g, '_');
  if (BUSINESS_ACTIVITY_PATTERNS.some(([, value]) => value === canonical))
    return canonical;
  for (const [re, value] of BUSINESS_ACTIVITY_PATTERNS) {
    if (re.test(t)) return value;
  }
  return undefined;
}

const PUBLIC_HEALTH_JOB =
  /\b(health|hospital|clinic\w*|laborator\w*|lab|nurs\w*|doctor|physician|medic\w*|dent\w*|patient|child[\s-]?care|day[\s-]?care|nanny|school|teach\w*|caregiv\w*|care[\s-]?giv\w*|domestic|long[\s-]term care|elderly|disabilit\w*)\b/i;
const AGRICULTURAL_JOB =
  /\b(agricultur\w*|farm\w*|harvest\w*|crop|greenhouse|orchard|livestock|sawp)\b/i;

/** The work interview's public-health/agriculture answer, as the two rule facts. */
function occupationFacts(v: unknown): {
  publicHealth?: boolean;
  agricultural?: boolean;
} {
  if (typeof v === 'boolean')
    return v
      ? { publicHealth: true }
      : { publicHealth: false, agricultural: false };
  if (typeof v !== 'string' || !v.trim()) return {};
  // "construction, not healthcare": a negated job word is not the job.
  const t = v
    .trim()
    .replace(/\b(not|no|never|non)[\s-]+(in\s+|a\s+|an\s+)?[\w-]+/gi, ' ');
  const yn = leadingYesNo(v.trim());
  if (yn === false) return { publicHealth: false, agricultural: false };
  if (PUBLIC_HEALTH_JOB.test(t)) return { publicHealth: true };
  if (AGRICULTURAL_JOB.test(t))
    return { publicHealth: false, agricultural: true };
  if (yn === true) return { publicHealth: true };
  return {};
}

/** "Yes", "yes, Pakistan", "No — never": the answer's leading yes or no. */
function leadingYesNo(v: unknown): boolean | undefined {
  const b = toBool(v);
  if (b !== undefined || typeof v !== 'string') return b;
  const s = v.trim().toLowerCase();
  if (/^(yes|y)\b/.test(s)) return true;
  if (/^(no|not|none|never)\b/.test(s)) return false;
  return undefined;
}

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

/**
 * Days from a study start to its end, both counted. A month-only answer
 * ("2027-01") reads as the first day of a start month and the last day of an
 * end month — the longest the stated months allow, which only matters at the
 * 6-month edge and never turns a long program short.
 */
function spanDays(start: unknown, end: unknown): number | undefined {
  const day = (v: unknown, edge: 'first' | 'last'): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = /^(\d{4})-(\d{2})$/.exec(t);
    if (!m) return undefined;
    if (edge === 'first') return `${m[1]}-${m[2]}-01`;
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    return `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`;
  };
  const days = stayDaysInclusive(day(start, 'first'), day(end, 'last'));
  return days ?? undefined;
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

const RETIRED_REGION_CODES = new Set([
  'AN',
  'BU',
  'CS',
  'DD',
  'DY',
  'FX',
  'HV',
  'NH',
  'RH',
  'SU',
  'TP',
  'UK',
  'VD',
  'YD',
  'YU',
  'ZR',
]);

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
        // ICU also names retired ISO codes (DD -> "Germany", UK -> "United
        // Kingdom", VD -> "Vietnam"...). Skip them so a name maps to the
        // CURRENT code whichever order the loop meets them in.
        if (RETIRED_REGION_CODES.has(code)) continue;
        if (name && name !== code && !nameToCode.has(name.toLowerCase()))
          nameToCode.set(name.toLowerCase(), code);
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

function canonicalMaritalStatus(v: string): string {
  const s = v.trim().toLowerCase();
  if (/\b(never|un-?married|single)\b/.test(s)) return 'single';
  if (/common[\s_-]*law/.test(s)) return 'common_law';
  if (/de[\s_-]*facto/.test(s)) return 'de_facto';
  if (/\bmarried\b/.test(s)) return 'married';
  return s.replace(/[\s-]+/g, '_');
}
