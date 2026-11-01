import { plannedStay } from './stay-dates'

/**
 * The answers an intake interview must collect before it can be called done.
 *
 * WHY THIS EXISTS
 *
 * "Intake complete" used to mean two different things in two places, and
 * neither was "the questions were answered":
 *
 *  - the progress stage said done once a profile row existed AND a visa type was
 *    chosen. Picking the route from the dropdown sets the visa type, so an
 *    applicant who had answered two questions saw Intake ✓ (dry run 2026-10-14);
 *  - the interview graph only checked three keys, and only for legacy
 *    framework applications — a registry route never reached that check at all.
 *
 * Both now read this one list. It is also what the interviewer is told to ask,
 * so the official form's own questions — IMM 5257 asks passport type, US
 * status, previous travel to Canada and whether a representative is used —
 * are asked instead of left to the model's recall.
 *
 * Country/route specific questions are CONFIGURATION in `ROUTE_FACTS` below,
 * keyed by destination and registry visa type. A route with no entry gets the
 * base list and nothing else, so adding Canada's questions cannot change what
 * any other country is asked.
 *
 * Pure and dependency-free: shared by the API (interview + progress) and the
 * web app (stage navigation).
 */

export interface IntakeFactSpec {
  /** Canonical snake_case profile key the extractor is told to write. */
  key: string
  /** Other keys an earlier extraction may have used for the same fact. */
  aliases?: readonly string[]
  /** What to ask, in English. The interviewer phrases it in the user's language. */
  question: string
  /**
   * Label and group of the application-form field this answer fills. Present
   * on route facts the official form asks verbatim, so prefill can carry the
   * answer onto the form even when the generator left it out.
   */
  form?: { label: string; group: string }
  /** Only required when this other fact (canonical key) answered yes. */
  when?: string
  /** Custom satisfaction test, for facts answered by more than one shape. */
  satisfiedBy?: (profile: Record<string, unknown>) => boolean
}

export interface IntakeRouteContext {
  /** ISO-3166 alpha-2 destination, e.g. 'CA'. */
  country?: string | null
  /** Registry visa type id (`visa_types.visaai_id`), e.g. 'ca-visitor-visa-temporary-resident-visa'. */
  visaaiId?: string | null
}

function present(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return true // an empty list is an answer ("none")
  return true
}

/** Yes/no reading of an answer, or undefined when it is not a yes/no. */
export function intakeAnswerIsYes(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['yes', 'y', 'true'].includes(s)) return true
    if (['no', 'n', 'false', 'none', 'never'].includes(s)) return false
  }
  return undefined
}

/** The value a profile holds for a fact, under its canonical key or any alias. */
export function readIntakeFact(
  profile: Record<string, unknown> | null | undefined,
  spec: Pick<IntakeFactSpec, 'key' | 'aliases'>,
): unknown {
  const p = profile ?? {}
  for (const k of [spec.key, ...(spec.aliases ?? [])]) {
    if (present(p[k])) return p[k]
  }
  return undefined
}

// ── base: every route ────────────────────────────────────────────────────────

/**
 * Asked on every route. Deliberately the same three facts the interview has
 * always required, so routes without configuration see no change — except that
 * the stay may now be answered with dates (the stored day count is derived from
 * them; see stay-dates.ts).
 */
const BASE_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'purpose_of_visit',
    aliases: [
      'purpose',
      'visit_purpose',
      'purpose_of_travel',
      'trip_purpose',
      'reason_for_visit',
      'travel_purpose',
    ],
    question: 'What is the purpose of the trip?',
  },
  {
    key: 'employed',
    aliases: [
      'employment_status',
      'is_employed',
      'occupation',
      'is_retired',
      'retired',
      'is_student',
    ],
    question: 'Are you currently employed, self-employed, retired or a student?',
  },
  {
    key: 'duration_of_stay_days',
    aliases: ['stay_duration_days', 'intended_stay_days', 'length_of_stay_days'],
    question:
      'On what exact date do you plan to arrive, and on what date will you leave?',
    satisfiedBy: (p) => plannedStay(p).days !== null,
  },
]

// ── per-route configuration ──────────────────────────────────────────────────

const PLANNED_ENTRY: IntakeFactSpec = {
  key: 'planned_entry_date',
  form: { label: 'Date entering', group: 'Travel' },
  aliases: [
    'intended_arrival_date',
    'intended_entry_date',
    'planned_arrival_date',
    'expected_arrival_date',
    'arrival_date',
    'entry_date',
  ],
  question: 'On what exact date do you plan to arrive (YYYY-MM-DD)?',
}

const PLANNED_DEPARTURE: IntakeFactSpec = {
  key: 'planned_departure_date',
  form: { label: 'Date leaving', group: 'Travel' },
  aliases: [
    'intended_departure_date',
    'planned_exit_date',
    'expected_departure_date',
    'departure_date',
    'exit_date',
    'return_date',
  ],
  question: 'On what exact date will you leave (YYYY-MM-DD)?',
}

/**
 * What IRCC's temporary-resident application (IMM 5257 and the tr-rt portal)
 * asks that a generic visitor interview does not. Each one is a question on
 * the official form; leaving them to the model's recall meant they were never
 * asked (dry run 2026-10-14, defect #50).
 */
const IRCC_VISITOR_FACTS: readonly IntakeFactSpec[] = [
  PLANNED_ENTRY,
  PLANNED_DEPARTURE,
  {
    key: 'passport_type',
    form: { label: 'Passport type', group: 'Passport' },
    aliases: ['travel_document_type'],
    question:
      'What type of passport will you travel on — regular (ordinary), diplomatic, official, service, or another travel document?',
  },
  {
    key: 'us_permanent_resident',
    form: { label: 'Lawful permanent resident of the United States', group: 'Passport' },
    aliases: [
      'is_us_permanent_resident',
      'us_lawful_permanent_resident',
      'has_us_green_card',
      'us_green_card',
    ],
    question:
      'Are you a lawful permanent resident of the United States (a US green card holder)?',
  },
  {
    key: 'has_valid_us_visa',
    form: { label: 'Valid United States visa', group: 'Background' },
    aliases: ['valid_us_visa', 'holds_us_visa', 'has_us_visa', 'us_visa'],
    question: 'Do you currently hold a valid United States visa? If yes, which type and when does it expire?',
  },
  {
    key: 'previously_visited_canada',
    form: { label: 'Previously travelled to Canada', group: 'Background' },
    aliases: [
      'visited_canada_before',
      'has_visited_canada',
      'previous_travel_to_canada',
      'travelled_to_canada_before',
      'traveled_to_canada_before',
      'prior_canada_travel',
    ],
    question:
      'Have you travelled to Canada before? If yes, when, for how long and on which visa?',
  },
  {
    key: 'uses_representative',
    form: { label: 'Using a representative (IMM 5476)', group: 'Representative' },
    aliases: [
      'has_representative',
      'using_representative',
      'uses_authorized_representative',
    ],
    question:
      'Is anyone — a consultant, lawyer, friend or relative — acting as your representative on this application?',
  },
  {
    key: 'representative_name',
    form: { label: "Representative's full name", group: 'Representative' },
    aliases: ['representative_full_name'],
    question: "What is your representative's full name?",
    when: 'uses_representative',
  },
  {
    key: 'representative_paid',
    form: { label: 'Representative paid or unpaid', group: 'Representative' },
    aliases: ['representative_compensated', 'representative_type', 'is_paid_representative'],
    question:
      'Is your representative paid (a licensed consultant or lawyer) or unpaid (a friend or relative)?',
    when: 'uses_representative',
  },
  {
    key: 'representative_contact',
    form: { label: "Representative's email and telephone", group: 'Representative' },
    aliases: ['representative_email', 'representative_phone', 'representative_telephone'],
    question: "What is your representative's email address and telephone number?",
    when: 'uses_representative',
  },
  {
    key: 'representative_address',
    form: { label: "Representative's mailing address", group: 'Representative' },
    aliases: ['representative_mailing_address'],
    question: "What is your representative's full mailing address?",
    when: 'uses_representative',
  },
]

interface RouteFacts {
  country: string
  /** Registry visa types this applies to. Empty = every route to `country`. */
  visaaiIds: readonly string[]
  facts: readonly IntakeFactSpec[]
}

/**
 * Route configuration. Canada's visitor routes share the IMM 5257 temporary
 * resident application, so they share its questions.
 */
export const ROUTE_FACTS: readonly RouteFacts[] = [
  {
    country: 'CA',
    visaaiIds: [
      'ca-visitor-visa-temporary-resident-visa',
      'ca-super-visa',
      'ca-business-visitors',
    ],
    facts: IRCC_VISITOR_FACTS,
  },
]

/** Every fact the route asks for, conditional ones included. */
export function intakeFactSpecs(ctx: IntakeRouteContext = {}): IntakeFactSpec[] {
  const country = ctx.country?.trim().toUpperCase() ?? ''
  const visaaiId = ctx.visaaiId?.trim() ?? ''
  const extra = ROUTE_FACTS.filter(
    (r) =>
      r.country === country &&
      (r.visaaiIds.length === 0 || r.visaaiIds.includes(visaaiId)),
  ).flatMap((r) => r.facts)

  const out: IntakeFactSpec[] = [...BASE_FACTS]
  for (const f of extra) {
    if (!out.some((o) => o.key === f.key)) out.push(f)
  }
  return out
}

function isSatisfied(profile: Record<string, unknown>, spec: IntakeFactSpec): boolean {
  if (present(readIntakeFact(profile, spec))) return true
  return spec.satisfiedBy ? spec.satisfiedBy(profile) : false
}

/**
 * The facts this route still needs, in asking order. A conditional fact is
 * only listed once the fact it hangs off has been answered yes.
 */
export function missingIntakeFacts(
  profile: Record<string, unknown> | null | undefined,
  ctx: IntakeRouteContext = {},
): IntakeFactSpec[] {
  const p = profile ?? {}
  const specs = intakeFactSpecs(ctx)
  return specs.filter((spec) => {
    if (spec.when) {
      const parent = specs.find((s) => s.key === spec.when)
      const answer = parent ? readIntakeFact(p, parent) : p[spec.when]
      if (intakeAnswerIsYes(answer) !== true) return false
    }
    return !isSatisfied(p, spec)
  })
}

/** True when every required intake answer for the route is on the profile. */
export function isIntakeAnswered(
  profile: Record<string, unknown> | null | undefined,
  ctx: IntakeRouteContext = {},
): boolean {
  return missingIntakeFacts(profile, ctx).length === 0
}

/**
 * Route facts that belong on the application form and apply to this profile
 * (a conditional fact only once its parent answered yes), with the profile's
 * value. Unanswered facts are skipped — prefill never invents an answer.
 */
export function answeredFormFacts(
  profile: Record<string, unknown> | null | undefined,
  ctx: IntakeRouteContext = {},
): Array<{ spec: IntakeFactSpec; value: unknown }> {
  const p = profile ?? {}
  const specs = intakeFactSpecs(ctx)
  const out: Array<{ spec: IntakeFactSpec; value: unknown }> = []
  for (const spec of specs) {
    if (!spec.form) continue
    if (spec.when) {
      const parent = specs.find((s) => s.key === spec.when)
      if (intakeAnswerIsYes(parent ? readIntakeFact(p, parent) : p[spec.when]) !== true) continue
    }
    const value = readIntakeFact(p, spec)
    if (value === undefined) continue
    out.push({ spec, value })
  }
  return out
}
