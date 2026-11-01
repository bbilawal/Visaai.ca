import { plannedStay } from './stay-dates'
import { CA_ETA_VISAAI_ID, isEtaConditional, nationalityCode, profileNationality } from './canada-eta'
import { CA_EE_VISAAI_ID } from './canada-express-entry'
import { CA_SPOUSAL_VISAAI_ID } from './canada-spousal-sponsorship'
import { CA_STUDY_VISAAI_ID } from './canada-study-permit'
import { CA_WORK_VISAAI_ID } from './canada-work-permit'

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
  /**
   * What a recorded answer still lacks, or undefined when it is complete. A
   * recorded answer with a gap is not an answer: the interviewer asks again,
   * naming the gap. Live E2E 2026-10-19: earlier jobs recorded without a
   * street address or duties counted as answered, and the portal could not
   * write a single one of their rows.
   */
  incomplete?: (profile: Record<string, unknown>) => string | undefined
  /**
   * How the extractor records the answer when it is not a plain value: a
   * list, a list of names, a record. Shown beside the canonical key.
   */
  shape?: string
  /**
   * A declaration kept only from a reply to a question that asked it: the
   * question asked must match this pattern, or the extracted value is dropped
   * and the interviewer asks it. Live 2026-10-19: "close contact at work" was
   * recorded as "contact as a health care worker: Yes" without the question
   * ever being asked — an answer IRCC takes as a declaration.
   */
  askedBy?: RegExp
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
  // Asked by IRCC only for a passport from Taiwan, Israel or Romania (tr-rt
  // bundle 2026-10-19: hasTaiwanPassport, hasIsraeliPassport,
  // hasRomaniaPassport, all required), so only of those nationals here.
  {
    key: 'taiwan_passport_with_personal_id',
    form: { label: 'Taiwan passport with personal identification number', group: 'Passport' },
    question:
      "For this trip, are you using an ordinary passport issued by Taiwan's Ministry of Foreign Affairs that shows your personal identification number?",
    satisfiedBy: (p) => profileNationality(p) !== 'TW',
  },
  {
    key: 'taiwan_personal_id_number',
    form: { label: 'Taiwan personal identification number', group: 'Passport' },
    question: 'What is the personal identification number printed in your Taiwan passport?',
    when: 'taiwan_passport_with_personal_id',
  },
  {
    key: 'israeli_national_passport',
    form: { label: 'National Israeli passport', group: 'Passport' },
    question: 'For this trip, are you using a national Israeli passport?',
    satisfiedBy: (p) => profileNationality(p) !== 'IL',
  },
  {
    key: 'romanian_electronic_passport',
    form: { label: 'Romanian electronic passport', group: 'Passport' },
    question:
      'Will you use an electronic Romanian passport (e-passport, with the chip symbol on the cover) to travel to Canada?',
    satisfiedBy: (p) => profileNationality(p) !== 'RO',
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
  // The card's number and expiry date, for the routes that ask them (study
  // and work permit pick them below). Not asked on tr-rt (TRV, business
  // visitor, super visa): live 2026-10-31 a "Yes" there reveals no number or
  // expiry field and ends the flow ("you don't need to apply for anything"),
  // so TRRT_VISITOR_FACTS leaves them out.
  {
    key: 'us_green_card_number',
    form: { label: 'Green Card — USCIS number', group: 'Passport' },
    aliases: ['green_card_number', 'uscis_number', 'alien_registration_number', 'a_number'],
    question:
      'What is the USCIS number on your Green Card (9 digits, also called the A-number)?',
    when: 'us_permanent_resident',
  },
  {
    key: 'us_green_card_expiry_date',
    form: { label: 'Green Card — expiry date', group: 'Passport' },
    aliases: ['green_card_expiry_date', 'green_card_expiry'],
    question: 'On what date does your Green Card expire (YYYY-MM-DD)?',
    shape: 'YYYY-MM-DD',
    when: 'us_permanent_resident',
  },
  {
    key: 'has_valid_us_visa',
    form: { label: 'Valid United States visa', group: 'Background' },
    aliases: ['valid_us_visa', 'holds_us_visa', 'has_us_visa', 'us_visa'],
    question: 'Do you currently hold a valid United States visa (for example a B1/B2 visitor visa)?',
  },
  // IRCC's visitor visa asks the U.S. visa's number and expiry date straight
  // after a "Yes" (live branch sweep 2026-10-18), as the eTA does: the same
  // keys as the eTA's questions, so one answer serves both forms.
  {
    key: 'us_nonimmigrant_visa_number',
    form: { label: 'U.S. visa number', group: 'Background' },
    aliases: ['us_visa_number', 'us_nonimmigrant_visa_no'],
    question:
      'What is the number of your U.S. visa, exactly as printed on the visa (the red "Visa Number" in the lower right)?',
    when: 'has_valid_us_visa',
  },
  {
    key: 'us_nonimmigrant_visa_expiry_date',
    form: { label: 'U.S. visa expiry date', group: 'Background' },
    aliases: ['us_visa_expiry_date', 'us_visa_expiry'],
    question: 'On what date does your U.S. visa expire (YYYY-MM-DD)?',
    when: 'has_valid_us_visa',
  },
  // Then, required (live 2026-10-19): "Are you using a different passport
  // for this application than the one you used to get your U.S.
  // nonimmigrant visa?" A Yes asks that other passport's country, number and
  // dates (canada-ircc.ts reads these keys).
  {
    key: 'us_visa_in_other_passport',
    form: { label: 'U.S. visa is in a different passport', group: 'Background' },
    aliases: ['us_visa_different_passport'],
    question:
      'Is the passport you are applying with different from the one your U.S. visa is in?',
    when: 'has_valid_us_visa',
  },
  {
    key: 'us_visa_passport_country',
    form: { label: 'Country of the passport with the U.S. visa', group: 'Background' },
    question: 'Which country issued the passport your U.S. visa is in?',
    when: 'us_visa_in_other_passport',
  },
  {
    key: 'us_visa_passport_number',
    form: { label: 'Number of the passport with the U.S. visa', group: 'Background' },
    question: 'What is the number of the passport your U.S. visa is in, exactly as printed?',
    when: 'us_visa_in_other_passport',
  },
  {
    key: 'us_visa_passport_issue_date',
    form: { label: 'Issue date of the passport with the U.S. visa', group: 'Background' },
    question: 'On what date was the passport your U.S. visa is in issued (YYYY-MM-DD)?',
    shape: 'YYYY-MM-DD',
    when: 'us_visa_in_other_passport',
  },
  {
    key: 'us_visa_passport_expiry_date',
    form: { label: 'Expiry date of the passport with the U.S. visa', group: 'Background' },
    question: 'On what date does (or did) the passport your U.S. visa is in expire (YYYY-MM-DD)?',
    shape: 'YYYY-MM-DD',
    when: 'us_visa_in_other_passport',
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
  // IRCC asks an unpaid representative how they are related to the
  // applicant (family member, friend or other). Known already when the
  // representative is the host, and not asked of a paid one.
  {
    key: 'representative_relationship',
    aliases: ['representative_relationship_to_applicant'],
    question:
      'How is your representative related to you — a family member (say how), a friend, or someone else?',
    when: 'uses_representative',
    satisfiedBy: (p) =>
      intakeAnswerIsYes(p.representative_paid ?? p.is_paid_representative) === true ||
      representativeIsHost(p),
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


// ── IRCC portal questions (tr-rt) ────────────────────────────────────────────
//
// Everything below is asked by the online application itself, page by page
// (apps/api/src/modules/automation/portal-fills/canada-ircc.ts reads each key).
// Dry run 2026-10-16: none of it was asked, so the portal assistant left 20
// pages to the applicant. A document that already answers one (the passport's
// place of birth, the CNIC) satisfies it, and it is not asked.

function isNo(v: unknown): boolean {
  return intakeAnswerIsYes(v) === false
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Married or common-law, as far as the profile says; undefined when unknown. */
function hasSpouse(p: Record<string, unknown>): boolean | undefined {
  const s = textOf(p.marital_status ?? p.civil_status).toLowerCase()
  if (s) return /married|common/.test(s) && !/never|un-?married/.test(s)
  if (textOf(p.spouse_name) || p.spouse) return true
  return undefined
}

/**
 * The applicant is 5 or younger today (or within a day of turning 6, as the
 * portal mapping assumes): IRCC asks them the 2-year TB questions.
 */
function agedFiveOrUnder(p: Record<string, unknown>): boolean {
  const dob = isoDay(p.date_of_birth ?? p.dob ?? p.birth_date)
  if (!dob) {
    // A birth year alone: 5 or under when this year minus it is 5 or less.
    const y = Number(String(p.birth_year ?? p.year_of_birth ?? '').trim())
    return Number.isInteger(y) && y > 1900 && new Date().getUTCFullYear() - y <= 5
  }
  const on = new Date(Date.now() - 24 * 60 * 60 * 1000)
  let age = on.getUTCFullYear() - dob.getUTCFullYear()
  const m = on.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age -= 1
  return age <= 5
}

/**
 * The applicant is 16 or under (date of birth, else surely so from the birth
 * year alone): IRCC's /minors-guardian asks who the child travels with. No
 * date of birth and no birth year: not asked.
 */
function sixteenOrUnder(p: Record<string, unknown>): boolean {
  const dob = isoDay(p.date_of_birth ?? p.dob ?? p.birth_date)
  if (!dob) {
    const y = Number(String(p.birth_year ?? p.year_of_birth ?? '').trim())
    return Number.isInteger(y) && y > 1900 && new Date().getUTCFullYear() - y <= 16
  }
  // A day behind, as the browser may be: asked on the 17th birthday too.
  const on = new Date(Date.now() - 24 * 60 * 60 * 1000)
  let age = on.getUTCFullYear() - dob.getUTCFullYear()
  const m = on.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age -= 1
  return age <= 16
}

/** At least one parent is recorded in the `parents` list. */
const parentsListed = (p: Record<string, unknown>) =>
  Array.isArray(p.parents) && p.parents.length > 0

/** Not married: the spouse questions do not apply. */
const noSpouse = (p: Record<string, unknown>) => hasSpouse(p) === false

function childrenOf(p: Record<string, unknown>): Record<string, unknown>[] {
  const v = p.children
  return Array.isArray(v)
    ? v.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c))
    : []
}

function noChildren(p: Record<string, unknown>): boolean {
  if (isNo(p.has_children)) return true
  if (p.number_of_children === 0 || p.number_of_children === '0') return true
  return Array.isArray(p.children) && p.children.length === 0
}

/** Every child already carries one of these answers. */
function everyChildHas(p: Record<string, unknown>, keys: string[]): boolean {
  const kids = childrenOf(p)
  return kids.length > 0 && kids.every((c) => keys.some((k) => present(c[k])))
}

/** The representative is the host (same name). */
function representativeIsHost(p: Record<string, unknown>): boolean {
  const rep = textOf(p.representative_name).toLowerCase()
  const host = textOf(
    p.inviter_name ?? p.host_name ?? p.family_member_name ?? p.accommodation_provider_name,
  ).toLowerCase()
  return !!rep && rep === host
}

/** The representative is the host and their contact holds a phone number. */
function representativeIsHostWithPhone(p: Record<string, unknown>): boolean {
  const rep = textOf(p.representative_name).toLowerCase()
  const host = textOf(
    p.inviter_name ?? p.host_name ?? p.family_member_name ?? p.accommodation_provider_name,
  ).toLowerCase()
  return !!rep && rep === host && /\d{7}/.test(textOf(p.representative_contact).replace(/\D/g, ''))
}

const DECLARATION = (
  key: string,
  question: string,
  aliases: readonly string[],
  extra: Partial<IntakeFactSpec> = {},
): IntakeFactSpec => ({ key, aliases, question, ...extra })

/**
 * No current job for IRCC's work history: retired, homemaker, unemployed or a
 * student. The portal's current-job row (canada-ircc.ts `currentJob`) skips
 * exactly these, so its questions are not asked of them.
 */
function noCurrentJob(p: Record<string, unknown>): boolean {
  if (noJob(p)) return true
  if (intakeAnswerIsYes(p.retired ?? p.is_retired) === true) return true
  if (intakeAnswerIsYes(p.is_student) === true) return true
  if (intakeAnswerIsYes(p.is_employed ?? p.currently_employed) === false) return true
  const s = [p.employment_status, p.employed, p.job_title, p.occupation]
    .map((v) => textOf(v).toLowerCase())
    .join(' ')
  return /\b(retired|student|unemployed|not employed|home ?maker|house ?wife)\b/.test(s)
}

/** An occupation that names the kind of work, not just "employed". */
function specificOccupation(p: Record<string, unknown>): boolean {
  const occ = textOf(p.occupation).toLowerCase()
  return (
    !!occ &&
    !/^(employed|self[- ]?employed|employee|working|salaried|job|private job|business|businessman|businesswoman|business ?owner|own business|yes|student|none|no)$/.test(
      occ,
    )
  )
}

/** Has children, as far as the profile says. */
function hasChildren(p: Record<string, unknown>): boolean {
  if (noChildren(p)) return false
  if (childrenOf(p).length > 0) return true
  if (intakeAnswerIsYes(p.has_children) === true) return true
  return Number(p.number_of_children) > 0
}

// ── follow-ups a "Yes" (or a "No") reveals on the tr-rt form ─────────────────
//
// Branch sweep 2026-10-18: each of these opens a field or a table IRCC
// requires before it saves the page, and the interview never asked what goes
// in it. Each is asked only when its parent answer opens it, and is recorded
// under the key canada-ircc.ts reads.

function objectsOf(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c))
    : []
}

const squashName = (v: unknown) => textOf(v).toLowerCase().replace(/[^a-z]+/g, ' ').trim()

/** Same person by name: equal, or every word of one is in the other. */
function sameName(a: unknown, b: unknown): boolean {
  const x = squashName(a)
  const y = squashName(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const words = long.split(' ')
  return short.split(' ').every((w) => words.includes(w))
}

const personNameOf = (c: Record<string, unknown>) =>
  textOf(c.name ?? c.full_name) ||
  [c.given_name ?? c.first_name, c.family_name ?? c.last_name ?? c.surname]
    .map(textOf)
    .filter(Boolean)
    .join(' ')

/** A piece the applicant said they do not know: not asked again. */
const NOT_KNOWN = /\b(unknown|not known|don'?t know|do not know|not sure|no idea|n\/a)\b/i

/**
 * What a one-line address still lacks for IRCC (street, city and country — the
 * line canada-ircc.ts `anyAddress` reads), or undefined.
 */
function addressLineGap(v: unknown): string | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    return textOf(o.street ?? o.street_address ?? o.line1) && textOf(o.city) && textOf(o.country)
      ? undefined
      : 'the street, the city and the country'
  }
  const line = textOf(v)
  if (NOT_KNOWN.test(line)) return undefined
  return line.split(',').filter((s) => s.trim()).length >= 3
    ? undefined
    : 'the street, the city and the country'
}

const OTHER_NAME_KIND = /maiden|before marriage|birth name|alias|nick|previous|former|old/i

/** What the recorded other names still lack (canada-ircc.ts `otherNameGaps`). */
function otherNamesGap(p: Record<string, unknown>): string | undefined {
  const gaps: string[] = []
  objectsOf(p.other_names ?? p.aliases ?? p.previous_names).forEach((o, i) => {
    const name = personNameOf(o)
    const missing: string[] = []
    if (!name) missing.push('the name')
    if (!OTHER_NAME_KIND.test(textOf(o.kind ?? o.type ?? o.name_type)))
      missing.push('whether it is an alias, a name before marriage or a previous name')
    if (missing.length) gaps.push(`${name || `name ${i + 1}`}: ${missing.join(', ')}`)
  })
  return gaps.length ? gaps.join('; ') : undefined
}

/** What the recorded other citizenships still lack. */
function otherCitizenshipsGap(p: Record<string, unknown>): string | undefined {
  const gaps: string[] = []
  objectsOf(p.other_citizenships).forEach((c, i) => {
    const country = textOf(c.country)
    const missing: string[] = []
    if (!country) missing.push('the country')
    const fromBirth = intakeAnswerIsYes(c.from_birth)
    if (fromBirth === undefined) missing.push('whether it is from birth')
    else if (!fromBirth && !/^\d{4}/.test(textOf(c.since)) && !NOT_KNOWN.test(textOf(c.since)))
      missing.push('the date it was granted')
    if (missing.length) gaps.push(`${country || `citizenship ${i + 1}`}: ${missing.join(', ')}`)
  })
  return gaps.length ? gaps.join('; ') : undefined
}

/** What the recorded schools still lack for IRCC's education entry. */
function educationGap(p: Record<string, unknown>): string | undefined {
  const gaps: string[] = []
  objectsOf(p.education_history).forEach((e, i) => {
    const school = textOf(e.school ?? e.institution ?? e.name)
    const missing: string[] = []
    const piece = (label: string, ...keys: string[]) => {
      const v = keys.map((k) => textOf(e[k])).find(Boolean) ?? ''
      if (!v) missing.push(label)
    }
    if (!school) missing.push('the school name')
    if (!MONTH.test(textOf(e.from)) && !NOT_KNOWN.test(textOf(e.from))) missing.push('start month and year')
    const to = textOf(e.to)
    if (!MONTH.test(to) && !ONGOING_PERIOD.test(to) && !NOT_KNOWN.test(to)) missing.push('end month and year')
    piece('level of study', 'level', 'level_of_study')
    piece('field of study', 'field_of_study', 'field')
    // Every piece of IRCC's education entry is required, the school's street
    // address included (live 2026-10-19).
    piece('street address', 'street_address', 'street', 'address')
    piece('city', 'city', 'town')
    piece('country', 'country')
    if (missing.length) gaps.push(`${school || `school ${i + 1}`}: ${missing.join(', ')}`)
  })
  return gaps.length ? gaps.join('; ') : undefined
}

/**
 * What the recorded periods of military or police service still lack for
 * IRCC's service entry (live 2026-10-19, all required): where stationed, the
 * country, from and to (month and year, or ongoing) and the details (unit,
 * rank, duties — at most 100 characters).
 */
function militaryServiceGap(p: Record<string, unknown>): string | undefined {
  const gaps: string[] = []
  objectsOf(p.military_service_history).forEach((e, i) => {
    const missing: string[] = []
    if (!textOf(e.location ?? e.stationed ?? e.place)) missing.push('where you were stationed')
    if (!textOf(e.country)) missing.push('the country')
    if (!MONTH.test(textOf(e.from)) && !NOT_KNOWN.test(textOf(e.from))) missing.push('start month and year')
    const to = textOf(e.to)
    if (!MONTH.test(to) && !ONGOING_PERIOD.test(to) && !NOT_KNOWN.test(to)) missing.push('end month and year')
    const details = textOf(e.details ?? e.unit ?? e.description)
    if (!details) missing.push('the unit, rank and duties')
    else if (details.length > 100) missing.push('a shorter description of the unit, rank and duties (IRCC accepts at most 100 characters)')
    if (missing.length) gaps.push(`period ${i + 1}: ${missing.join(', ')}`)
  })
  return gaps.length ? gaps.join('; ') : undefined
}

/** What the recorded children still lack for IRCC's child entry. */
function childrenGap(p: Record<string, unknown>): string | undefined {
  const gaps: string[] = []
  childrenOf(p).forEach((c, i) => {
    const name = personNameOf(c)
    const missing: string[] = []
    if (!name || !/\s/.test(name)) missing.push('full name')
    if (!present(c.date_of_birth ?? c.dob ?? c.birth_date ?? c.birth_year ?? c.year_of_birth))
      missing.push('date of birth (the year is enough)')
    if (
      !/son|daughter/i.test(textOf(c.relationship ?? c.relation)) &&
      !/^(m|f|male|female)$/i.test(textOf(c.sex ?? c.gender))
    )
      missing.push('son or daughter')
    if (missing.length) gaps.push(`${name || `child ${i + 1}`}: ${missing.join(', ')}`)
  })
  return gaps.length ? gaps.join('; ') : undefined
}

/**
 * A child who does not live at the applicant's address: said so on the child,
 * or left out of "which of your children live with you?".
 */
function childLivesElsewhere(c: Record<string, unknown>, p: Record<string, unknown>): boolean {
  const own = intakeAnswerIsYes(c.same_address ?? c.lives_with_applicant ?? c.same_address_as_applicant)
  if (own !== undefined) return !own
  const name = personNameOf(c)
  const list = p.children_living_with_you
  if (Array.isArray(list)) return !list.some((n) => sameName(n, name))
  if (typeof list === 'string' && /^(none|no|nobody|no one|neither)$/i.test(list.trim())) return true
  return intakeAnswerIsYes(c.in_home_country) === false
}

/** Children living elsewhere whose home address is not recorded. */
function childAddressGap(p: Record<string, unknown>): string | undefined {
  const lines = textOf(p.children_addresses)
    .split(/\n|;/)
    .map((l) => /^([^:]+):\s*\S/.exec(l.trim())?.[1] ?? '')
    .filter(Boolean)
  const host = p.inviter_name ?? p.host_name ?? p.family_member_name
  const names = childrenOf(p)
    .filter((c) => childLivesElsewhere(c, p))
    .filter((c) => !present(c.address ?? c.residential_address ?? c.home_address))
    .map(personNameOf)
    // The host's address is asked on its own (the son the applicant visits).
    .filter((n) => !sameName(n, host) && !lines.some((l) => sameName(l, n)))
  return names.length ? `the home address of ${names.join(' and ')}` : undefined
}

/** What the recorded parents still lack: a date of death, or an address. */
function parentsGap(p: Record<string, unknown>): string | undefined {
  const gaps: string[] = []
  objectsOf(p.parents).forEach((c, i) => {
    const name = personNameOf(c) || `parent ${i + 1}`
    if (intakeAnswerIsYes(c.deceased ?? c.is_deceased) === true) {
      if (!present(c.date_of_death ?? c.death_date ?? c.year_of_death ?? c.death_year))
        gaps.push(`${name}: date of death (the year is enough)`)
      return
    }
    if (
      intakeAnswerIsYes(c.same_address ?? c.lives_with_applicant) === false &&
      !present(c.address ?? c.residential_address ?? c.home_address)
    )
      gaps.push(`${name}: their home address`)
  })
  return gaps.length ? gaps.join('; ') : undefined
}

/** The marriage or relationship ended: IRCC asks the date it ended. */
const unionEnded = (p: Record<string, unknown>) =>
  /divorc|separat|annul|widow/i.test(textOf(p.marital_status ?? p.civil_status))

/**
 * The details box IRCC opens after a "Yes" to a background declaration (live
 * sweep 2026-10-18: `<id>Details` textareas, at most 500 characters).
 * canada-ircc.ts `declarationDetails` reads `<parent>_details`.
 */
function declarationDetails(
  parent: string,
  question: string,
  aliases: readonly string[],
): IntakeFactSpec {
  const key = `${parent}_details`
  return {
    key,
    aliases,
    question,
    shape: "the applicant's own words, at most 500 characters",
    when: parent,
    incomplete: (p) =>
      textOf(readIntakeFact(p, { key, aliases })).length > 500
        ? 'a shorter version: IRCC accepts at most 500 characters'
        : undefined,
  }
}

/** The first day of a "YYYY-MM" or "YYYY-MM-DD" answer, or null. */
function monthStart(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})/.exec(textOf(v))
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null
}

/** True when the date is on or before the same day `years` ago. */
function atLeastYearsAgo(d: Date, years: number): boolean {
  const cutoff = new Date()
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years)
  return d.getTime() <= cutoff.getTime()
}

const firstMonth = (vs: unknown[]) =>
  vs.map(monthStart).find((d): d is Date => d !== null) ?? null

/** Biometrics given within the past 10 years, by the recorded date. */
function biometricsWithinTenYears(p: Record<string, unknown>): boolean {
  const d = firstMonth([p.biometrics_enrollment_date, p.biometrics_date])
  return !!d && !atLeastYearsAgo(d, 10)
}

function isRetiredApplicant(p: Record<string, unknown>): boolean {
  if (intakeAnswerIsYes(p.retired ?? p.is_retired) === true) return true
  return /\bretired\b/.test(
    [p.employment_status, p.employed, p.occupation].map((v) => textOf(v).toLowerCase()).join(' '),
  )
}

/**
 * IRCC's work history must cover the last 10 years with no gaps (live E2E
 * 2026-10-19). The portal assistant writes only the CURRENT row (job,
 * retirement or homemaking — canada-ircc.ts `currentJob`), so when that began
 * less than 10 years ago the applicant also owes what came before it. The
 * start that counts is the current activity's own: the retirement date when
 * retired, the job's start when employed, else since when they have not
 * worked. A job or retirement start not yet known is asked first (its own
 * question), and this is decided after; anyone else without a start date is
 * asked here.
 */
function currentActivityCoversTenYears(p: Record<string, unknown>): boolean {
  let start: Date | null
  if (isRetiredApplicant(p)) {
    start = firstMonth([p.retirement_date, p.retired_since, p.date_of_retirement, p.occupation_since])
    // retirement_date is asked first when "retired" was answered yes.
    if (!start) return intakeAnswerIsYes(p.retired ?? p.is_retired) === true
  } else if (!noCurrentJob(p)) {
    start = firstMonth([
      p.employment_start_date,
      p.employment_since,
      p.employed_since,
      p.current_employment_start_date,
    ])
    if (!start) return true // employment_start_date is asked first
  } else {
    start = firstMonth([
      p.occupation_since,
      p.not_employed_since,
      p.unemployed_since,
      p.homemaker_since,
      p.studying_since,
    ])
    if (!start) return false
  }
  return atLeastYearsAgo(start, 10)
}

const NO_JOB_PERIOD =
  /\b(un-?employed|not (employed|working)|no (work|job)|job[- ]?seek\w*|looking for (work|a job)|between jobs|retire(d|ment)?|home ?maker|house ?wife|house ?husband|stay[- ]at[- ]home)\b/i
const STUDY_PERIOD = /\b(student|studying|studies|study)\b/i
const ONGOING_PERIOD = /^(present|now|current(ly)?|ongoing|to date|today|till date)$/i

const MONTH = /^\d{4}-\d{2}/
/** An answer the applicant does not know, recorded as such. */
const UNKNOWN = /^(unknown|not known|don'?t know|do not know|n\/a)$/i

/** The recorded text for a missing piece, to see whether it was "unknown". */
function knownAs(e: Record<string, unknown>, piece: string): string {
  const keys: Record<string, string[]> = {
    'street address': ['address', 'street', 'street_address'],
    'start month and year': ['from', 'from_date', 'start_date', 'start'],
    'end month and year': ['to', 'to_date', 'end_date', 'end'],
    city: ['city', 'town'],
    country: ['country'],
    employer: ['employer'],
    'main duties': ['duties'],
  }
  const addr = e.address
  const obj =
    addr && typeof addr === 'object' && !Array.isArray(addr)
      ? (addr as Record<string, unknown>)
      : {}
  const v = (keys[piece] ?? []).map((k) => textOf(e[k]) || textOf(obj[k])).find((x) => x !== '') ?? ''
  // A year alone is all the applicant remembers: not asked again.
  return /month and year/.test(piece) && /^\d{4}$/.test(v) ? 'unknown' : v
}

const firstText = (e: Record<string, unknown>, ...keys: string[]) =>
  keys.map((k) => textOf(e[k])).find((v) => v !== '') ?? ''

/**
 * The pieces an earlier period still lacks for IRCC's work-history dialog
 * (canada-ircc.ts `workRowGaps`): from and to, a street, city and country, and
 * for a job also the employer and duties. The current period is not checked —
 * its own questions cover it. Studies are recorded elsewhere on the form.
 */
function workHistoryGap(p: Record<string, unknown>): string | undefined {
  const raw = [p.work_history, p.employment_history, p.previous_jobs, p.previous_employment].find(
    Array.isArray,
  ) as unknown[] | undefined
  if (!raw) return undefined
  const rows = raw.filter(
    (e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e),
  )
  const gaps: string[] = []
  rows.forEach((e, i) => {
    const to = firstText(e, 'to', 'to_date', 'end_date', 'end')
    if (ONGOING_PERIOD.test(to) || (!to && i === rows.length - 1)) return
    const what = firstText(e, 'activity', 'job_title', 'title', 'occupation', 'position')
    if (STUDY_PERIOD.test(what) && !NO_JOB_PERIOD.test(what)) return
    const from = firstText(e, 'from', 'from_date', 'start_date', 'start')
    // The address the portal reads (canada-ircc.ts `workRowAddress`): an
    // object under `address` holds its own street and city; a line holds them
    // only as "street, city, country"; otherwise the parts on the period.
    const addr = e.address ?? e.employer_address ?? e.work_address
    const obj =
      addr && typeof addr === 'object' && !Array.isArray(addr)
        ? (addr as Record<string, unknown>)
        : undefined
    const line = typeof addr === 'string' ? addr.trim() : ''
    // A line names its city only after two commas ("street, city, country");
    // "House 12, Street 4" is a street (live 2026-10-19), so the city is asked.
    const fullLine = /,[^,]*\S[^,]*,\s*\S/.test(line)
    const src = obj ?? e
    const street = obj
      ? firstText(obj, 'street', 'street_address', 'line1')
      : line || firstText(e, 'street', 'street_address')
    const missing: string[] = []
    if (!MONTH.test(from)) missing.push('start month and year')
    if (!MONTH.test(to)) missing.push('end month and year')
    if (!what) missing.push('what it was')
    if (!street || UNKNOWN.test(street)) missing.push('street address')
    if (!fullLine && !firstText(src, 'city', 'town')) missing.push('city')
    if (!fullLine && !firstText(src, 'country') && !firstText(e, 'country'))
      missing.push('country')
    if (what && !NO_JOB_PERIOD.test(what)) {
      if (!firstText(e, 'employer', 'employer_name', 'company', 'company_name'))
        missing.push('employer')
      if (!firstText(e, 'duties', 'job_duties', 'responsibilities', 'description'))
        missing.push('main duties')
    }
    // A piece the applicant said they do not know is not asked again; the
    // portal lists it for them to add.
    const open = missing.filter((m) => !UNKNOWN.test(knownAs(e, m)))
    if (open.length)
      gaps.push(
        `${from || 'unknown start'} to ${to || 'unknown end'}${what ? ` (${what})` : ''}: ${open.join(', ')}`,
      )
  })
  return gaps.length ? gaps.join('; ') : undefined
}

/**
 * Every profile key a national identity number is held under — the same list
 * canada-ircc.ts `nationalIdNumber` reads. `national_id_number` is canonical:
 * an ID card scan writes it (sync-profile.ts) and document-subject.ts matches
 * the applicant's own ID card against it.
 */
const NATIONAL_ID_NUMBER_KEYS = [
  'national_id_number',
  'national_id',
  'national_identity_card_number',
  'national_identity_number',
  'national_identity_document_number',
  'national_id_card_number',
  'cnic',
  'cnic_number',
] as const

const nationalIdOnFile = (p: Record<string, unknown>) =>
  NATIONAL_ID_NUMBER_KEYS.some((k) => textOf(p[k]) !== '')

/**
 * The applicant holds a national identity document: said yes, or a number is
 * already on file (from an ID card scan or an earlier answer).
 */
const holdsNationalId = (p: Record<string, unknown>) =>
  nationalIdOnFile(p) ||
  intakeAnswerIsYes(p.has_national_id ?? p.has_national_identity_document) === true

/**
 * What a Canadian address still lacks for IRCC's address fields (street
 * number and name, city, province, postal code), or undefined. Live E2E
 * 2026-10-19: the business contact's address was recorded as "Toronto,
 * Canada", and the portal could fill none of the inviter's address.
 */
const CA_POSTAL_CODE = /\b[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d\b/

const ADDRESS_SHAPE =
  'one line: street number and name, city, province, postal code; a piece the applicant does not know as "unknown" (e.g. "Toronto, ON, postal code unknown")'

/** `incomplete` for a Canadian address fact, read the way the interview reads it. */
const canadianAddressIncomplete =
  (key: string, aliases: string[]) => (p: Record<string, unknown>) =>
    canadianAddressGap(readIntakeFact(p, { key, aliases }))

function canadianAddressGap(v: unknown): string | undefined {
  const piece = (x: unknown) => (typeof x === 'number' ? String(x) : textOf(x))
  const parts =
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.values(v as Record<string, unknown>).map(piece).filter(Boolean).join(', ')
      : textOf(v)
  // The applicant said they do not know the rest: the portal lists it for
  // them. Not anchored (unlike UNKNOWN): it is one piece of a whole line. The
  // check is looser than the portal (a PO box or "Unit 5" passes here and is
  // still left for the applicant there) so the interview cannot loop.
  if (!parts || /\b(unknown|not known|don'?t know|do not know|not sure|no idea|n\/a)\b/i.test(parts))
    return undefined
  const missing: string[] = []
  if (!/\d/.test(parts.replace(CA_POSTAL_CODE, ''))) missing.push('street number and street name')
  if (!CA_POSTAL_CODE.test(parts)) missing.push('postal code')
  return missing.length ? `the address has no ${missing.join(' and no ')}` : undefined
}

/**
 * The country the applicant lives in, as ISO alpha-2: the stated one, else the
 * last piece of the home address ("…, Dubai, United Arab Emirates").
 */
function residenceCountryCode(p: Record<string, unknown>): string | null {
  for (const k of ['country_of_residence', 'current_country_of_residence', 'residence_country']) {
    const code = nationalityCode(p[k])
    if (code) return code
  }
  const home = p.residential_address ?? p.home_address
  if (home && typeof home === 'object' && !Array.isArray(home))
    return nationalityCode((home as Record<string, unknown>).country)
  const last = textOf(home).split(',').pop()
  return last ? nationalityCode(last.replace(/\d+/g, '').trim()) : null
}

/**
 * The applicant lives outside every country they are a citizen of (a
 * Pakistani worker in Dubai): IRCC's residence row then needs their status
 * there, which nothing derives. Unknown either way: not asked.
 */
function livesOutsideCitizenship(p: Record<string, unknown>): boolean {
  const home = residenceCountryCode(p)
  const own = profileNationality(p)
  if (!home || !own || home === own) return false
  const others = Array.isArray(p.other_citizenships) ? p.other_citizenships : []
  return !others.some((c) =>
    nationalityCode(c && typeof c === 'object' ? (c as Record<string, unknown>).country : c) === home,
  )
}

const residenceStatusText = (p: Record<string, unknown>) =>
  textOf(p.residence_status ?? p.status_in_country_of_residence ?? p.immigration_status).toLowerCase()

/**
 * IRCC's residence row needs the To date (`datesToResidence`) for every status
 * but citizen / permanent resident (live 2026-10-31: it stays visible with
 * "ongoing" ticked, and a Worker row without it did not save).
 */
const statusHasEndDate = (p: Record<string, unknown>) => {
  const said = residenceStatusText(p)
  return livesOutsideCitizenship(p) && !!said && !/citizen|permanent|\bpr\b/.test(said)
}

const widowed = (p: Record<string, unknown>) => /widow/i.test(textOf(p.marital_status ?? p.civil_status))

const IRCC_PORTAL_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'country_of_birth',
    aliases: ['birth_country'],
    question: 'In which country were you born?',
    // "Rawalpindi, Pakistan" from a passport already names it.
    satisfiedBy: (p) => /,\s*\S/.test(textOf(p.place_of_birth)),
  },
  // Read off the passport scan; asked only when the scan did not give it
  // (live E2E 2026-10-18: OCR missed it and IRCC's bio-data sex was blank).
  {
    key: 'sex',
    form: { label: 'Sex', group: 'Personal' },
    aliases: ['gender', 'applicant_sex', 'applicant_gender', 'passport_sex'],
    question: 'What sex is shown on your passport — male, female or X (another gender)?',
  },
  {
    key: 'multiple_citizenship',
    aliases: ['dual_citizenship', 'dual_national', 'has_multiple_citizenships'],
    question: 'Are you a citizen of more than one country?',
    satisfiedBy: (p) => Array.isArray(p.other_citizenships),
  },
  // "Yes" opens IRCC's citizenship table (otherCountriesCitizenship): each
  // country, whether from birth, and since when.
  {
    key: 'other_citizenships',
    aliases: ['other_citizenship', 'additional_citizenships'],
    question:
      'Which other countries are you a citizen of? For each one: have you been a citizen since birth, and if not, on what date did you become a citizen?',
    shape:
      'a list, one object per other country: {"country", "from_birth": true|false, "since" (YYYY-MM-DD, when not from birth)}',
    when: 'multiple_citizenship',
    incomplete: otherCitizenshipsGap,
  },
  {
    key: 'citizen_from_birth',
    aliases: ['citizenship_by_birth', 'citizen_since_birth'],
    question: 'Have you been a citizen of your country since birth?',
  },
  // IRCC asks the date citizenship began; ticking "since birth" fills it, so
  // only a citizen by naturalisation is asked.
  {
    key: 'citizenship_acquired_date',
    aliases: ['citizenship_date', 'date_became_citizen', 'naturalization_date', 'naturalisation_date'],
    question: 'On what date did you become a citizen (YYYY-MM-DD)?',
    shape: 'YYYY-MM-DD',
    satisfiedBy: (p) =>
      intakeAnswerIsYes(p.citizen_from_birth ?? p.citizenship_by_birth ?? p.citizen_since_birth) !== false,
  },
  // IRCC's /national-id-doc page (canada-ircc.ts NATIONAL_ID rows) reads
  // these keys. It was left blank because the interview never asked: the
  // number was expected from an uploaded ID card, and a CNIC typed into the
  // correction box was dropped with no key to land on (live E2E 2026-10-19).
  {
    key: 'has_national_id',
    aliases: ['has_national_identity_document'],
    question:
      'Do you have a national identity document, such as a national identity card (for example a CNIC)?',
    satisfiedBy: nationalIdOnFile,
  },
  {
    key: 'national_id_number',
    form: { label: 'National identity document number', group: 'Identity documents' },
    aliases: NATIONAL_ID_NUMBER_KEYS.slice(1),
    question: 'What is the number on your national identity document?',
    shape: 'the number exactly as printed, e.g. 34101-9231766-1',
    when: 'has_national_id',
  },
  {
    key: 'national_id_issue_date',
    form: { label: 'National identity document issue date', group: 'Identity documents' },
    aliases: [
      'national_identity_card_issue_date',
      'national_identity_document_issue_date',
      'national_id_card_issue_date',
      'cnic_issue_date',
      'national_id_date_of_issue',
    ],
    question: 'On what date was your national identity document issued?',
    shape: 'YYYY-MM-DD',
    // Asked whenever the applicant holds one — also when the number came
    // from a scan and the yes/no was never asked.
    satisfiedBy: (p) => !holdsNationalId(p),
  },
  {
    key: 'national_id_country',
    form: { label: 'National identity document country of issue', group: 'Identity documents' },
    aliases: [
      'national_id_issuing_country',
      'national_identity_card_country',
      'national_identity_document_country',
      'national_id_card_country',
    ],
    question: 'Which country issued your national identity document?',
    satisfiedBy: (p) => !holdsNationalId(p),
  },
  {
    key: 'has_other_names',
    aliases: ['used_other_names'],
    question:
      'Have you ever used any other name, such as a maiden name, an alias or a different spelling?',
    satisfiedBy: (p) =>
      ['other_names', 'aliases', 'previous_names'].some((k) => Array.isArray(p[k])),
  },
  // "Yes" needs at least one name in IRCC's table, with its kind (live
  // 2026-10-18: the page will not save without a row).
  {
    key: 'other_names',
    aliases: ['aliases', 'previous_names'],
    question:
      'Which other names have you used? For each: the family name and given name, and whether it is a nickname or alias, your name before marriage, or a previous name.',
    shape:
      'a list, one object per name: {"family_name", "given_name", "kind": "alias" | "name before marriage" | "previous name"}',
    when: 'has_other_names',
    incomplete: otherNamesGap,
  },
  {
    key: 'residence_since',
    aliases: ['living_since', 'resident_since', 'residence_since_birth'],
    question:
      'Since what date have you lived in the country you live in now? If since birth, say so.',
    shape: 'a date YYYY-MM-DD, or the text "since birth"',
  },
  // IRCC's residence row (`#statusResidence_select`) needs the applicant's
  // status where they live. Derived as Citizen only in their own country; a
  // Pakistani or Indian national working in the UAE, Saudi Arabia or Qatar
  // has to be asked (trrt matrix A 66).
  {
    key: 'residence_status',
    aliases: ['status_in_country_of_residence', 'immigration_status'],
    question:
      'What is your immigration status in the country where you live now — worker, student, visitor, permanent resident, citizen, protected person, refugee claimant, foreign national, or something else?',
    shape:
      'one of "Worker", "Student", "Visitor", "Permanent resident", "Citizen", "Protected Person", "Refugee Claimant", "Foreign National", "Other"',
    satisfiedBy: (p) => !livesOutsideCitizenship(p),
  },
  // "Other" opens a required details box (`statusResidenceDetail`, ≤100 characters).
  {
    key: 'residence_status_details',
    aliases: ['residence_status_other'],
    question: 'Please describe your status in the country where you live (in a few words).',
    satisfiedBy: (p) => !(livesOutsideCitizenship(p) && /^other\b/.test(residenceStatusText(p))),
  },
  // Every status but citizen / permanent resident has an end date IRCC asks
  // for (`datesToResidence`, shown even when ongoing; live 2026-10-31).
  {
    key: 'residence_status_valid_until',
    aliases: ['residence_status_expiry', 'residence_permit_expiry'],
    question:
      'On what date does your status there end — the expiry date on your residence or work permit, study permit, visitor visa or other residence document?',
    shape: 'YYYY-MM-DD',
    satisfiedBy: (p) => !statusHasEndDate(p),
  },
  {
    key: 'marital_status',
    aliases: ['civil_status'],
    question:
      'What is your current marital status — married, common-law, single, divorced, separated or widowed?',
  },
  // IRCC's family page asks the date of marriage (or the date a common-law
  // relationship began) — `dateOfDating*`, read from `marriage_date` — and the
  // interview never asked it (live E2E 2026-10-19).
  {
    key: 'marriage_date',
    aliases: ['date_of_marriage', 'wedding_date', 'common_law_since', 'relationship_start_date'],
    question:
      'On what date did you marry your spouse? If you are common-law partners, on what date did you start living together?',
    shape: 'YYYY-MM-DD',
    satisfiedBy: (p) => hasSpouse(p) !== true,
  },
  // Divorced, separated, annulled or widowed: IRCC asks the date the
  // marriage or relationship ended (`endDatePartner`).
  {
    key: 'marriage_end_date',
    aliases: ['divorce_date', 'separation_date', 'annulment_date', 'spouse_date_of_death'],
    question:
      'On what date did your marriage or relationship end — the date of the divorce, separation or annulment, or the date your spouse passed away?',
    shape: 'YYYY-MM-DD',
    satisfiedBy: (p) => !unionEnded(p),
  },
  // Divorced, separated, annulled or widowed (trrt matrix C 15, 18-21): IRCC's
  // family page shows the former or late spouse's date of marriage, names,
  // date of birth and country of birth (live 2026-10-31 for all four; the
  // 2026-10-15 note that divorced / separated / annulled showed only the end
  // date was wrong). A late spouse's existing spouse_* answers count.
  {
    key: 'previous_marriage_date',
    aliases: ['late_spouse_marriage_date', 'former_marriage_date', 'date_of_previous_marriage'],
    question:
      'On what date did you marry your former (or late) spouse — or, for a common-law relationship, start living together? (the full date: day, month and year)',
    shape: 'YYYY-MM-DD',
    satisfiedBy: (p) => !unionEnded(p) || present(p.marriage_date ?? p.date_of_marriage),
  },
  {
    key: 'previous_spouse_name',
    aliases: ['late_spouse_name', 'former_spouse_name'],
    question:
      'What is the full name (given names and family name) of your former spouse or partner — or, if you are widowed, of your late spouse?',
    satisfiedBy: (p) =>
      !unionEnded(p) || (widowed(p) && present(p.spouse_name ?? p.spouse_full_name)),
  },
  {
    key: 'previous_spouse_date_of_birth',
    aliases: ['late_spouse_date_of_birth', 'former_spouse_date_of_birth'],
    question:
      'What is the date of birth of your former (or late) spouse or partner? If you do not know the day or month, the year is enough.',
    shape: 'YYYY-MM-DD',
    satisfiedBy: (p) => !unionEnded(p) || (widowed(p) && present(p.spouse_date_of_birth)),
  },
  {
    key: 'previous_spouse_country_of_birth',
    aliases: ['late_spouse_country_of_birth', 'former_spouse_country_of_birth'],
    question: 'In which country was your former (or late) spouse or partner born?',
    satisfiedBy: (p) => !unionEnded(p) || (widowed(p) && present(p.spouse_country_of_birth)),
  },
  // IRCC asks the spouse's family and given names. Without this key the
  // extractor kept the spouse's birth date, country and occupation from one
  // answer and dropped the name (prod 2026-10-29).
  {
    key: 'spouse_name',
    aliases: ['spouse_full_name', 'partner_name'],
    question: "What is your spouse's full name (given names and family name)?",
    // Also recorded as its two parts, or on a spouse record.
    satisfiedBy: (p) =>
      noSpouse(p) ||
      !!(textOf(p.spouse_family_name) && textOf(p.spouse_given_name)) ||
      !!textOf((p.spouse as { name?: unknown } | null)?.name),
  },
  {
    key: 'spouse_date_of_birth',
    aliases: ['spouse_dob', 'spouse_birth_date'],
    question: "What is your spouse's date of birth?",
    satisfiedBy: noSpouse,
  },
  {
    key: 'spouse_country_of_birth',
    aliases: ['spouse_birth_country'],
    question: 'In which country was your spouse born?',
    satisfiedBy: noSpouse,
  },
  {
    key: 'spouse_occupation',
    question: "What is your spouse's current occupation (for example homemaker or retired)?",
    satisfiedBy: noSpouse,
  },
  {
    key: 'spouse_same_address',
    aliases: ['lives_with_spouse'],
    question: 'Does your spouse live with you at your home address?',
    satisfiedBy: noSpouse,
  },
  // "No" opens the spouse's address (`partnerInfoAddress`).
  {
    key: 'spouse_address',
    aliases: ['spouse_home_address'],
    question: "What is your spouse's full home address — street, city, postal code and country?",
    shape: 'one line: street, city, postal code, country',
    satisfiedBy: (p) =>
      !(hasSpouse(p) === true && isNo(p.spouse_same_address ?? p.lives_with_spouse)),
    incomplete: (p) => addressLineGap(p.spouse_address ?? p.spouse_home_address),
  },
  {
    key: 'spouse_coming_to_canada',
    aliases: ['spouse_accompanying', 'spouse_travelling'],
    question: 'Is your spouse coming to Canada with you on this trip?',
    satisfiedBy: noSpouse,
  },
  // IRCC asks "Do you have children?" outright, and a "Yes" needs each child
  // in its table: name, date of birth and son or daughter. "None live with
  // me" is not "no children".
  {
    key: 'has_children',
    aliases: ['have_children'],
    question:
      'Do you have any children — natural, adopted or step-children — of any age, wherever they live?',
    satisfiedBy: (p) => childrenOf(p).length > 0 || noChildren(p) || Number(p.number_of_children) > 0,
  },
  {
    key: 'children',
    question:
      'For each of your children: full name, date of birth (the year is enough), and whether they are your son, daughter, step-son or step-daughter.',
    shape:
      'the "children" list, one object per child: {"name", "relationship": "son" | "daughter" | "step-son" | "step-daughter", "date_of_birth" (YYYY-MM-DD) or "birth_year"}',
    satisfiedBy: (p) => !hasChildren(p),
    incomplete: childrenGap,
  },
  // IRCC's child entry has a "deceased" box (#firstChildIsDeceased, recorded
  // live) that hides the address and travel questions. Never assumed.
  {
    key: 'children_deceased',
    aliases: ['deceased_children'],
    question:
      'Have any of your children passed away? Name them, or say none.',
    shape: "a list of the children's names; [] for none",
    satisfiedBy: (p) => !hasChildren(p) || everyChildHas(p, ['deceased', 'is_deceased']),
  },
  {
    key: 'children_living_with_you',
    question:
      'Which of your children live with you at your home address? Name them, or say none.',
    shape: 'a list of the children\'s names; [] for none',
    satisfiedBy: (p) =>
      noChildren(p) ||
      everyChildHas(p, ['same_address', 'lives_with_applicant', 'in_home_country']),
  },
  // A child who lives elsewhere needs their own address in IRCC's child
  // entry (`childInfoAddress`), or the entry will not save. Same key and line
  // format as the Forms page; fill-instructions.ts puts it onto each child.
  {
    key: 'children_addresses',
    question:
      "What is the full home address of each child who does not live with you — street, city, postal code and country?",
    shape:
      'text, one child per line as "Name: street, city, postal code, country" (e.g. "Ali Khan: 5 Canal Road, Lahore, 54000, Pakistan")',
    satisfiedBy: (p) => !childAddressGap(p),
    incomplete: childAddressGap,
  },
  {
    key: 'children_accompanying',
    question:
      'Which of your children are coming to Canada with you on this trip? Name them, or say none.',
    shape: 'a list of the children\'s names; [] for none',
    satisfiedBy: (p) =>
      noChildren(p) ||
      everyChildHas(p, ['coming_to_canada', 'accompanying', 'travelling_with_applicant']),
  },
  // Each IRCC child row needs the child's country of birth, or the child is
  // left to the applicant (live E2E 2026-10-19). Same key and line format the
  // Forms page asks, which fill-instructions.ts puts onto each child.
  {
    key: 'children_countries_of_birth',
    aliases: ['children_country_of_birth'],
    question: 'In which country was each of your children born?',
    shape: 'text, one child per line as "Name: Country" (e.g. "Ali Khan: Pakistan"), or just the country when every child was born there',
    satisfiedBy: (p) =>
      !hasChildren(p) || everyChildHas(p, ['country_of_birth', 'birth_country', 'place_of_birth']),
  },
  {
    key: 'parents',
    question:
      "For each of your parents: full name, date of birth (the year is enough), country of birth, current occupation (or that they have passed away, and the date of death — the year is enough), whether they live at your address (and if not, their home address), and whether they are coming to Canada with you.",
    shape:
      'a list, one object per parent: {"name", "relationship": "father" | "mother", "date_of_birth" (YYYY-MM-DD) or "birth_year", "country_of_birth", "occupation", "deceased": true|false, "date_of_death" (YYYY-MM-DD) or "year_of_death" (when deceased), "same_address": true|false, "address" (one line: street, city, postal code, country — when not at your address), "coming_to_canada": true|false}',
    satisfiedBy: (p) =>
      (parentsListed(p) && !parentsGap(p)) ||
      // Only with no parent listed: a listed parent with a gap is asked again.
      (!parentsListed(p) && intakeAnswerIsYes(p.parents_unknown) === true),
    incomplete: parentsGap,
  },
  // IRCC lets an applicant declare "I don't know who my parents are" instead
  // of listing them (#declaringParents, recorded live). Asked only while no
  // parent is recorded, and kept only from a reply to that question.
  {
    key: 'parents_unknown',
    aliases: ['does_not_know_parents', 'parents_not_known'],
    question:
      'If you do not know who your parents are, please say so — IRCC lets you declare that instead of listing them. Otherwise, answer no.',
    satisfiedBy: parentsListed,
    // Only the dedicated question: the main parents question also says
    // "parents", and "I don't know my parents' dates" is not this answer.
    askedBy: /know who (your|my) parents are/i,
  },
  {
    key: 'has_post_secondary_education',
    aliases: ['post_secondary_education'],
    // IRCC's wording: any post-secondary education, finished or not.
    question:
      'Have you had any post-secondary education (including university, college or apprenticeship training)?',
  },
  // "Yes" opens IRCC's education table, which needs at least one school.
  {
    key: 'education_history',
    aliases: ['schools', 'post_secondary_schools'],
    question:
      'For each college, university or training program: the name of the school, its street address, city and country, from and to (month and year, or still studying), the level of study (for example diploma, bachelor’s, master’s or doctorate) and the field of study (for example computer science, business, medicine, law or engineering).',
    shape:
      'a list, one object per school: {"school", "street_address", "city", "country", "from" (YYYY-MM), "to" (YYYY-MM, or "ongoing"), "level", "field_of_study"}; a piece the applicant does not know as "unknown"',
    when: 'has_post_secondary_education',
    incomplete: educationGap,
  },
  {
    key: 'retirement_date',
    aliases: ['retired_since', 'date_of_retirement'],
    question: 'When did you retire? The year and month are enough.',
    shape: 'YYYY-MM-DD, or YYYY-MM when only the month is known',
    when: 'retired',
  },
  // IRCC's work history needs the current job as one row — title, employer,
  // duties, start month and the employer's address — or the page will not
  // save (canada-ircc.ts `currentJob` reads exactly these keys). The intake
  // only asked "employed?", so the row was left to the applicant (live E2E
  // 2026-10-18, business visitor). A self-employed applicant's own business
  // is the employer.
  {
    key: 'job_title',
    form: { label: 'Current job title', group: 'Employment' },
    aliases: ['current_occupation', 'position', 'designation'],
    question:
      'What is your current job title? If you run your own business, say what kind of business and your role in it (for example owner of a textile shop).',
    satisfiedBy: (p) => noCurrentJob(p) || specificOccupation(p),
  },
  {
    key: 'employer_name',
    form: { label: 'Name of employer or business', group: 'Employment' },
    aliases: ['employer', 'company', 'company_name', 'current_employer_name'],
    question:
      'What is the name of your employer? If you are self-employed, what is the name of your own business?',
    satisfiedBy: noCurrentJob,
  },
  {
    key: 'job_duties',
    form: { label: 'Main duties', group: 'Employment' },
    aliases: ['duties', 'responsibilities', 'job_description'],
    question: 'What are your main duties in that job or business?',
    satisfiedBy: noCurrentJob,
  },
  {
    key: 'employment_start_date',
    form: { label: 'Current job since (year and month)', group: 'Employment' },
    aliases: ['employment_since', 'employed_since', 'current_employment_start_date'],
    question: 'In what month and year did you start that job or business?',
    shape: 'YYYY-MM',
    satisfiedBy: noCurrentJob,
  },
  {
    key: 'employer_address',
    form: { label: 'Employer or business address', group: 'Employment' },
    aliases: ['work_address', 'current_employer_address'],
    question:
      "What is the full address of your employer or business — street, city, postal code and country?",
    satisfiedBy: noCurrentJob,
  },
  {
    key: 'work_history',
    form: { label: 'Previous jobs and activities (past 10 years)', group: 'Employment' },
    aliases: ['employment_history', 'previous_jobs', 'previous_employment'],
    question:
      'IRCC needs your work history for the last 10 years with no gaps. Since when have you been in your current situation (if not already said), and before that, what did you do — for each job, study or period without work: from and to (month and year), what it was (the job title — for your own business say what kind, e.g. owner of a brick factory — or student, unemployed…), the employer or school and your main duties, and the street address, city and country (where you lived, for a period without work)?',
    shape:
      'a list, one object per period, oldest first: {"from" (YYYY-MM), "to" (YYYY-MM), "activity", "employer", "duties", "address" (street), "city", "country"}; the current period without work, when its start was not recorded, as not_employed_since (YYYY-MM); to complete a period already recorded, return that period with its "from" and the new pieces; a piece the applicant does not know as "unknown"; a period recorded by mistake, or whose start month changed, as that period with its old "from" and "remove": true',
    satisfiedBy: currentActivityCoversTenYears,
    incomplete: workHistoryGap,
  },
  // ── Travel, biometrics and previous visas (live E2E 2026-10-19: the
  // portal listed each as "not in your VisaAI data"). Keys are the ones
  // canada-ircc.ts reads.
  DECLARATION(
    'travelled_last_5_years',
    'In the past 5 years, have you travelled to any country outside the country you live in?',
    ['has_travel_history', 'travelled_in_last_5_years'],
    {
      // A recorded list (even an empty one) already answers it.
      satisfiedBy: (p) =>
        ['travel_history', 'trips', 'travel_history_countries'].some((k) => Array.isArray(p[k])) ||
        isNo(p.has_travel_history_last_10_years),
    },
  ),
  {
    key: 'travel_history',
    aliases: ['trips'],
    question:
      'For each trip in the past 5 years: which country, the city or place, from and to (month and year), and the purpose of the trip?',
    shape:
      'a list, one object per trip: {"country", "city", "from" (YYYY-MM), "to" (YYYY-MM), "purpose"}',
    when: 'travelled_last_5_years',
  },
  DECLARATION(
    'held_canadian_visa_10_years',
    'Have you held a Canadian visitor visa (temporary resident visa) in the past 10 years?',
    [
      'held_canadian_visitor_visa',
      'canadian_visa_last_10y',
      'held_canadian_visa_last_10_years',
      'had_canadian_visa_10_years',
    ],
  ),
  {
    key: 'travel_by_air',
    aliases: ['travelling_by_air', 'arriving_by_air', 'flying_to_canada'],
    question: 'Will you fly to Canada, or arrive by car, bus, train or boat?',
    shape: 'true when flying, false when arriving by land or sea',
    satisfiedBy: (p) =>
      /\b(air|fly|flying|flight|plane|airline|land|car|bus|train|road|sea|ship|boat|cruise|ferry)\b/i.test(
        textOf(p.travel_mode ?? p.mode_of_travel ?? p.means_of_travel),
      ),
  },
  DECLARATION(
    'biometrics_given',
    'Have you given biometrics (fingerprints and a photo) for a Canadian application in the past 10 years?',
    ['biometrics_given_before', 'has_given_biometrics', 'previous_biometrics'],
    // A recorded date within 10 years answers it; an older one does not
    // (those biometrics have expired), so the question is asked.
    { satisfiedBy: biometricsWithinTenYears },
  ),
  // Biometrics are valid for 10 years from the day they were given; the date
  // decides whether IRCC lets them be re-used for this trip.
  {
    key: 'biometrics_enrollment_date',
    aliases: ['biometrics_date'],
    question: 'On what date did you give those biometrics? The month and year are enough.',
    shape: 'YYYY-MM-DD, or YYYY-MM when only the month is known',
    when: 'biometrics_given',
    satisfiedBy: (p) => present(p.biometrics_valid_until) || present(p.biometrics_expiry_date),
  },
  DECLARATION(
    'military_service',
    'Have you ever served in a military, militia or civil defence unit, or a security organization or police force?',
    ['served_in_military', 'served_army'],
  ),
  // "Yes" opens IRCC's service table, which needs at least one entry (live
  // 2026-10-19: location, country, from, to and details all required).
  {
    key: 'military_service_history',
    aliases: ['military_service_periods'],
    question:
      'For each period of military, militia, civil defence, security or police service: where you were stationed (city or base), the country, from and to (month and year, or still serving), and your unit, rank and duties in a few words.',
    shape:
      'a list, one object per period: {"location", "country", "from" (YYYY-MM), "to" (YYYY-MM, or "ongoing"), "details" (unit, rank and duties, at most 100 characters)}; a piece the applicant does not know as "unknown"',
    when: 'military_service',
    incomplete: militaryServiceGap,
  },
  DECLARATION(
    'immigration_violations',
    'Have you ever stayed in Canada longer than allowed, or studied or worked there without permission?',
    ['overstayed_in_canada', 'remained_beyond_validity', 'canada_status_violation'],
  ),
  declarationDetails(
    'immigration_violations',
    'Please give the details: when and where in Canada you stayed longer than allowed, or studied or worked without permission, for how long, and what happened.',
    ['overstay_details', 'overstayed_or_unauthorized_work_study_details'],
  ),
  // IRCC's visitor visa asks this on its validity page; it was only in the eTA
  // facts, so TRV, business and super visa interviews never asked it and a
  // refusal the applicant volunteered was lost (live E2E 2026-10-18).
  DECLARATION(
    'refused_or_ordered_to_leave',
    'Have you ever been refused a visa or permit, denied entry to, or ordered to leave Canada or any other country?',
    [
      'refused_visa_or_denied_entry',
      'previous_visa_refused',
      'previous_visa_refusal',
      'has_prior_refusal',
      'visa_refused',
      'visa_refusal_history',
    ],
    { form: { label: 'Refused a visa or permit, denied entry or ordered to leave', group: 'Background' } },
  ),
  {
    key: 'refusal_details',
    form: { label: 'Refusal, denied entry or removal details', group: 'Background' },
    aliases: ['previous_visa_refusal_details'],
    shape: 'a list of {country, what_was_refused, month_year (YYYY-MM), where (city or consulate where it happened, if given), reason}, one per refusal',
    // A refusal already recorded in parts is enough to fill IRCC's box.
    satisfiedBy: (p) =>
      present(p.previous_visa_refusal_reason) ||
      (present(p.previous_visa_refusal_country) && present(p.previous_visa_refusal_date)),
    question:
      'For each refusal, denied entry or removal: which country, what was refused (for example a visitor visa), the month and year, and the reason given?',
    when: 'refused_or_ordered_to_leave',
  },
  DECLARATION(
    'committed_crime',
    'Have you ever committed a criminal offence in any country?',
    ['committed_criminal_offence', 'committed_criminal_offense', 'crime_committed'],
  ),
  declarationDetails(
    'committed_crime',
    'Please give the details of each offence: when (month and year), where (city and country), what the offence was, and what happened afterwards.',
    ['criminal_details', 'criminal_conviction_details'],
  ),
  DECLARATION(
    'ever_arrested',
    'Have you ever been arrested for a criminal offence in any country?',
    ['arrested', 'been_arrested'],
  ),
  declarationDetails(
    'ever_arrested',
    'Please give the details of each arrest: when (month and year), where (city and country), what for, and what happened afterwards.',
    ['arrest_details'],
  ),
  DECLARATION(
    'ever_charged',
    'Have you ever been charged with a criminal offence in any country?',
    ['been_charged', 'criminal_charges'],
    { satisfiedBy: (p) => isNo(p.criminal_charges_or_convictions) },
  ),
  declarationDetails(
    'ever_charged',
    'Please give the details of each charge: when (month and year), where (city and country), the offence charged, and the outcome.',
    ['charge_details', 'criminal_charge_details'],
  ),
  DECLARATION(
    'ever_convicted',
    'Have you ever been convicted of a criminal offence in any country?',
    ['been_convicted', 'criminal_conviction', 'criminal_convictions', 'criminal_record'],
    { satisfiedBy: (p) => isNo(p.criminal_charges_or_convictions) },
  ),
  declarationDetails(
    'ever_convicted',
    'Please give the details of each conviction: when (month and year), where (city and country), the offence, and the sentence.',
    ['conviction_details', 'criminal_conviction_details'],
  ),
  DECLARATION(
    'violent_organization_member',
    'Have you ever been a member of, or associated with, a group that has used violence or criminal activity to reach its goals?',
    ['member_of_violent_organization', 'criminal_organization_member', 'violent_organization_membership'],
  ),
  declarationDetails(
    'violent_organization_member',
    'Please give the details: the name of the group, your role in it or link to it, and the dates (from and to).',
    ['organization_membership_details', 'political_organization_membership_details'],
  ),
  DECLARATION(
    'ill_treatment',
    'Have you ever witnessed or taken part in the ill treatment of prisoners or civilians, looting, or the desecration of religious buildings?',
    ['involved_in_ill_treatment', 'witnessed_ill_treatment'],
  ),
  declarationDetails(
    'ill_treatment',
    'Please give the details: what you witnessed or took part in, when (month and year), and where (city and country).',
    ['witnessed_or_participated_in_abuse_details'],
  ),
  // IRCC's /minors-guardian, for a child 16 or under only (live 2026-10-31):
  // with a parent or legal guardian (both or one), or not (alone or with
  // someone else). Written from these explicit answers only.
  {
    key: 'minor_travelling_with_guardian',
    aliases: [],
    question: 'Is the child travelling to Canada with a parent or legal guardian?',
    satisfiedBy: (p) => !sixteenOrUnder(p),
  },
  {
    key: 'minor_guardians_travelling',
    aliases: [],
    question: 'Is the child travelling with both parents or legal guardians, or with one?',
    when: 'minor_travelling_with_guardian',
  },
  {
    key: 'minor_travelling_without_guardian',
    aliases: [],
    question: 'Is the child travelling to Canada alone, or with someone else?',
    // Only after an explicit "No" to the question above.
    satisfiedBy: (p) =>
      !sixteenOrUnder(p) || intakeAnswerIsYes(p.minor_travelling_with_guardian) !== false,
  },
  DECLARATION(
    'medical_exam_last_12_months',
    'Have you had an immigration medical exam for Canada in the last 12 months?',
    ['ircc_medical_exam_last_12_months', 'had_immigration_medical_exam'],
  ),
  // "Yes" makes IRCC ask the exam's IME or UMI number (live 2026-10-18); the
  // portal writes it only in a format IRCC accepts.
  {
    key: 'medical_exam_number',
    aliases: ['ime_number', 'umi_number', 'medical_exam_reference_number', 'medical_number'],
    question:
      "What is your medical exam's IME or UMI number? It is on the information printout or confirmation the panel physician gave you.",
    when: 'medical_exam_last_12_months',
  },
  DECLARATION(
    'tuberculosis',
    'Have you been diagnosed with tuberculosis in the last 2 years?',
    ['tuberculosis_diagnosed', 'tb_diagnosed', 'has_tuberculosis'],
  ),
  // IRCC's follow-ups to a "Yes" (live branch sweep 2026-10-18).
  DECLARATION(
    'tuberculosis_treated_six_months',
    'Were you treated for tuberculosis for at least 6 months?',
    [],
    { when: 'tuberculosis' },
  ),
  DECLARATION(
    'tuberculosis_contact',
    'In the last 5 years, have you been in close contact with someone who has tuberculosis?',
    ['tb_close_contact', 'close_contact_tuberculosis'],
  ),
  DECLARATION(
    'tuberculosis_tested',
    'Since that contact, have you been tested for tuberculosis?',
    ['tb_tested'],
    { when: 'tuberculosis_contact' },
  ),
  DECLARATION(
    'tuberculosis_test_positive',
    'Was the result of that tuberculosis test positive?',
    ['tb_test_positive'],
    { when: 'tuberculosis_tested' },
  ),
  // A positive result opens IRCC's "Have you completed or are you currently
  // undergoing treatment for tuberculosis (minimum of 6 months)?"
  // (fiveYearsTreatment, required) — its wording, as a declaration.
  DECLARATION(
    'tuberculosis_positive_treated',
    'Have you completed, or are you now undergoing, treatment for tuberculosis lasting at least 6 months?',
    ['tb_positive_treated'],
    { when: 'tuberculosis_test_positive' },
  ),
  // IRCC asks an applicant aged 5 or under the same chain over the last 2
  // years instead (contactTwoYears …; tr-rt bundle). Asked of them only.
  DECLARATION(
    'tuberculosis_contact_two_years',
    'In the last 2 years, has the child been in close contact with someone who has tuberculosis?',
    [],
    { satisfiedBy: (p) => !agedFiveOrUnder(p) },
  ),
  DECLARATION(
    'tuberculosis_tested_two_years',
    'Since that contact, has the child been tested for tuberculosis?',
    [],
    { when: 'tuberculosis_contact_two_years' },
  ),
  DECLARATION(
    'tuberculosis_test_positive_two_years',
    "Was the result of the child's tuberculosis test positive?",
    [],
    { when: 'tuberculosis_tested_two_years' },
  ),
  DECLARATION(
    'tuberculosis_positive_treated_two_years',
    'Has the child completed, or is the child now undergoing, treatment for tuberculosis lasting at least 6 months?',
    [],
    { when: 'tuberculosis_test_positive_two_years' },
  ),
  DECLARATION('dialysis', 'Are you receiving dialysis treatment?', ['dialysis_treatment']),
  DECLARATION(
    'addiction',
    'Do you have a drug or alcohol addiction?',
    ['drug_or_alcohol_addiction', 'substance_addiction'],
  ),
  DECLARATION(
    'mental_health_condition',
    'Do you have a mental health condition that requires you to be supervised or receive care?',
    ['mental_health'],
  ),
  DECLARATION('syphilis', 'Have you been diagnosed with syphilis?', ['has_syphilis']),
  // A "Yes" opens IRCC's treatment question (`hasSyphilisTreatment`).
  DECLARATION('syphilis_treated', 'Have you been treated for syphilis?', ['syphilis_treatment'], {
    when: 'syphilis',
  }),
  {
    key: 'native_language',
    aliases: ['mother_tongue', 'first_language'],
    question: 'What is your native language?',
  },
  {
    key: 'official_language_ability',
    aliases: ['english_french_ability'],
    question: 'Can you communicate in English, French, both, or neither?',
  },
  {
    key: 'preferred_contact_language',
    aliases: ['preferred_language'],
    question: 'Would you like IRCC to contact you in English or French?',
    // Only one of the two to choose from.
    satisfiedBy: (p) =>
      /^(english|french)$/i.test(textOf(p.official_language_ability)),
  },
  // IRCC's contact page fills from this (ircc-profile.ts `residentialAddress`
  // reads these keys). It was never asked: the applicant gave it inside
  // another answer and it was dropped, so the page went blank (live E2E
  // 2026-10-18, app dc91b2c8). Same key and aliases as the eTA's question.
  {
    key: 'residential_address',
    form: { label: 'Residential address', group: 'Contact' },
    aliases: ['home_address', 'current_address', 'address'],
    question:
      'What is your full current home address — street, city, district or region, postal code and country?',
    satisfiedBy: (p) =>
      !!textOf(p.residential_address_street ?? p.residential_street ?? p.street_address) &&
      !!textOf(p.residential_address_city ?? p.residential_city ?? p.city_of_residence),
  },
  // IRCC asks whether the mailing address is the home address; it was
  // assumed "Yes" (audit 2026-10-19). "No" reveals the mailing address.
  {
    key: 'mailing_same_as_residential',
    aliases: ['mailing_address_same_as_residential', 'mailing_address_same'],
    question: 'Is your mailing address the same as your home address?',
  },
  {
    key: 'mailing_address',
    aliases: ['postal_address', 'correspondence_address'],
    question:
      'What is your full mailing address — street, city, district or region, postal code and country?',
    // Asked only after a "No" above.
    satisfiedBy: (p) =>
      intakeAnswerIsYes(
        p.mailing_same_as_residential ??
          p.mailing_address_same_as_residential ??
          p.mailing_address_same,
      ) !== false,
  },
  {
    key: 'email',
    aliases: ['applicant_email', 'contact_email', 'email_address'],
    question: 'What email address should IRCC use to contact you?',
  },
  {
    key: 'phone_number',
    aliases: ['telephone', 'phone', 'contact_phone', 'applicant_phone'],
    question:
      'What telephone number should IRCC use to contact you, with the country code (and its extension, if it has one)?',
    shape: 'the number with its country code; an extension after "ext" (e.g. "+1 905 555 0100 ext 12"), never run into the digits',
  },
  {
    key: 'phone_type',
    aliases: ['telephone_type', 'phone_number_type', 'telephone_number_type'],
    question: 'Is that a cell, home or other number?',
  },
  // IRCC's telephone table takes more than one row (matrix C row 62); the
  // portal adds up to two more (canada-ircc.ts `extraPhones`).
  {
    key: 'other_phone_numbers',
    aliases: ['additional_phone_numbers', 'alternate_phone_numbers', 'alternate_phone'],
    question:
      'Do you have another telephone number IRCC could use? Give each with its country code and whether it is a cell, home or other number, or say none.',
    shape: 'a list, one object per number: {"number" (with country code, any extension after "ext"), "type": "cell" | "home" | "other"}; [] for none',
  },
  {
    key: 'inviter_phone',
    aliases: ['host_phone', 'host_telephone'],
    question: "What is your host's telephone number?",
    when: 'family_in_destination',
    // The representative's number, when the representative is the host.
    satisfiedBy: (p) => representativeIsHostWithPhone(p),
  },
  {
    key: 'inviter_phone_type',
    aliases: ['host_phone_type'],
    question: "Is your host's telephone number a cell, home or other number?",
    when: 'family_in_destination',
  },
  {
    key: 'inviter_email',
    aliases: ['host_email'],
    question: "What is your host's email address?",
    when: 'family_in_destination',
  },
  {
    key: 'has_second_inviter',
    aliases: ['second_inviter'],
    question: 'Is a second person also inviting you to Canada?',
    when: 'family_in_destination',
  },
  // IRCC requires each of these once a second inviter is declared (live
  // 2026-10-18): asked only then, and carried onto the Forms page.
  {
    key: 'second_inviter_name',
    aliases: ['second_host_name', 'second_inviter_full_name', 'additional_inviter_name'],
    question: "What is the second inviter's full name?",
    when: 'has_second_inviter',
    form: { label: 'Second inviter — full name', group: 'Host' },
  },
  {
    key: 'second_inviter_relationship',
    aliases: ['second_host_relationship'],
    question:
      'How is the second inviter related to you — family member (say how: son, daughter-in-law…), friend, a conference or an organization?',
    when: 'has_second_inviter',
    form: { label: 'Second inviter — relationship to you', group: 'Host' },
  },
  {
    key: 'second_inviter_address',
    aliases: ['second_host_address', 'second_inviter_home_address'],
    question:
      "What is the second inviter's full home address in Canada, with the postal code?",
    shape: ADDRESS_SHAPE,
    incomplete: canadianAddressIncomplete('second_inviter_address', ['second_host_address', 'second_inviter_home_address']),
    when: 'has_second_inviter',
    form: { label: 'Second inviter — home address', group: 'Host' },
  },
  {
    key: 'second_inviter_phone',
    aliases: ['second_host_phone', 'second_inviter_phone_number', 'second_inviter_telephone'],
    question: "What is the second inviter's telephone number?",
    when: 'has_second_inviter',
    form: { label: 'Second inviter — telephone', group: 'Host' },
  },
  {
    key: 'second_inviter_phone_type',
    aliases: ['second_host_phone_type'],
    question: "Is the second inviter's number a cell, home or other number?",
    when: 'has_second_inviter',
    form: { label: 'Second inviter — telephone type', group: 'Host' },
  },
  {
    key: 'second_inviter_email',
    aliases: ['second_host_email'],
    question: "What is the second inviter's email address?",
    when: 'has_second_inviter',
    form: { label: 'Second inviter — email', group: 'Host' },
  },
  // IRCC /finances asks the money available for the trip in Canadian dollars
  // (live E2E 2026-10-19: never asked, so the field was left blank). A
  // balance in another currency is not converted by the portal.
  {
    key: 'available_funds_cad',
    aliases: ['trip_funds_cad'],
    question:
      'IRCC asks how much money you will have available for this trip, in Canadian dollars. About how many Canadian dollars is that?',
    shape:
      'a whole number of Canadian dollars ("5k" as 5000); do not change available_funds or funds_currency',
    satisfiedBy: (p) =>
      /^\s*(cad|c\$|canadian dollars?)\s*$/i.test(textOf(p.funds_currency ?? p.available_funds_currency)) &&
      present(p.available_funds ?? p.funds_available ?? p.trip_funds),
  },
  // IRCC /finances asks "Is someone else giving you money for this trip?"
  // and, after a Yes, who. Never asked on the visitor or super visa routes,
  // so a pension or savings answer elsewhere was read as someone else paying
  // (audit 2026-10-19). The business route asks the same key in its own
  // words first.
  {
    key: 'trip_expenses_paid_by',
    aliases: ['who_pays_trip', 'travel_expenses_paid_by'],
    question:
      'Who is paying for your trip and your stay in Canada — you (your own savings, salary, pension or business income), or someone else? If someone else, give their name and how they are related to you (for example "my son, Ali Khan").',
    form: { label: 'Trip expenses paid by', group: 'Travel' },
    satisfiedBy: (p) =>
      present(p.financial_support) ||
      present(p.financial_supporter) ||
      present(p.sponsor_name) ||
      intakeAnswerIsYes(p.funds_shared) !== undefined,
  },
]

// ── Parent and Grandparent Super Visa ────────────────────────────────────────
//
// What IRCC decides a super visa on, beyond the IMM 5257 visitor questions
// (registry `ca-super-visa`, requirement codes in brackets): the host child or
// grandchild and their status [host_is_child_or_grandchild,
// host_status_and_age], the host's household and income against the minimum
// necessary income for that family size [host_meets_minimum_necessary_income,
// minimum_necessary_income_table], the co-signer, who may only be the host's
// spouse or common-law partner [co_signer_limited_to_spouse], the private
// medical insurance [private_health_insurance_one_year,
// insurance_policy_conditions] and the immigration medical exam
// [immigration_medical_exam]. Dry run 2026-10-16: none of it was asked.

const SUPER_VISA_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'inviter_name',
    aliases: ['host_name', 'host_full_name', 'inviter_full_name'],
    question:
      'What is the full name of your child or grandchild in Canada who is inviting you (your host)?',
  },
  {
    key: 'inviter_relationship',
    aliases: ['host_relationship', 'relationship_to_host'],
    question: 'How is your host related to you — son, daughter, grandson or granddaughter?',
  },
  {
    key: 'inviter_status',
    aliases: ['host_status', 'host_immigration_status', 'host_citizenship_status'],
    question:
      'Is your host a Canadian citizen, a permanent resident of Canada or a registered Indian?',
  },
  {
    key: 'inviter_date_of_birth',
    aliases: ['host_date_of_birth', 'host_dob', 'inviter_dob'],
    question: "What is your host's date of birth?",
    shape: 'YYYY-MM-DD',
  },
  {
    key: 'inviter_address',
    aliases: ['host_address', 'host_home_address'],
    question: "What is your host's full home address in Canada, with the postal code?",
    shape: ADDRESS_SHAPE,
    incomplete: canadianAddressIncomplete('inviter_address', ['host_address', 'host_home_address']),
  },
  // The visitor host contact and second-inviter questions hang off
  // `family_in_destination`, which this route never asks — so IRCC's
  // /inviter-info number, email and "second inviter" radio went blank. The
  // super visa host is always family in Canada: ask them outright. The
  // second inviter's own details (IRCC_PORTAL_FACTS) follow a yes.
  {
    key: 'inviter_phone',
    aliases: ['host_phone', 'host_telephone'],
    question: "What is your host's telephone number?",
    satisfiedBy: representativeIsHostWithPhone,
  },
  {
    key: 'inviter_phone_type',
    aliases: ['host_phone_type'],
    question: "Is your host's telephone number a cell, home or other number?",
  },
  {
    key: 'inviter_email',
    aliases: ['host_email'],
    question: "What is your host's email address?",
  },
  {
    key: 'has_second_inviter',
    aliases: ['second_inviter'],
    question:
      'Is a second person also inviting you to Canada (for example your host\'s spouse, or another child or grandchild)?',
  },
  {
    key: 'host_household_members',
    aliases: ['host_family_members'],
    question:
      "For the minimum income check and the invitation letter, list everyone counted in your host's family size: your host, their spouse or partner, their dependent children, you, and anyone else applying with you or already sponsored by your host — with each person's full name and date of birth.",
    shape:
      'a list, one object per person: {"name", "date_of_birth" (YYYY-MM-DD), "relationship_to_host"}',
    satisfiedBy: (p) =>
      Array.isArray(p.host_household_members) && p.host_household_members.length > 0,
  },
  {
    key: 'host_annual_income_cad',
    aliases: ['inviter_annual_income_cad', 'host_income_cad', 'host_total_income_cad'],
    question:
      "What was your host's total income, in Canadian dollars, on their most recent Notice of Assessment from the Canada Revenue Agency?",
    shape: 'a number in CAD',
    form: { label: "Host's total income (CAD, latest notice of assessment)", group: 'Host' },
  },
  {
    key: 'host_income_tax_year',
    aliases: ['inviter_income_tax_year', 'host_tax_year'],
    question: 'Which tax year is that income for?',
    shape: 'the year, YYYY',
    form: { label: "Tax year of the host's income", group: 'Host' },
  },
  {
    key: 'has_co_signer',
    aliases: ['co_signer', 'has_cosigner'],
    question:
      "Will your host's spouse or common-law partner co-sign the invitation letter to add their income? Only the host's spouse or common-law partner can co-sign — a sibling or other relative cannot.",
    form: { label: "Host's spouse or partner co-signs the invitation", group: 'Host' },
  },
  {
    key: 'co_signer_name',
    aliases: ['cosigner_name'],
    question: "What is the co-signer's full name?",
    when: 'has_co_signer',
    form: { label: "Co-signer's full name", group: 'Host' },
  },
  {
    key: 'co_signer_relationship',
    aliases: ['cosigner_relationship'],
    question: 'How is the co-signer related to your host (for example their wife or husband)?',
    when: 'has_co_signer',
    form: { label: "Co-signer's relationship to the host", group: 'Host' },
  },
  {
    key: 'co_signer_annual_income_cad',
    aliases: ['cosigner_annual_income_cad', 'co_signer_income_cad'],
    question:
      "What was the co-signer's total income, in Canadian dollars, on their most recent Notice of Assessment?",
    shape: 'a number in CAD',
    when: 'has_co_signer',
    form: { label: "Co-signer's total income (CAD)", group: 'Host' },
  },
  {
    key: 'has_super_visa_insurance',
    aliases: ['has_travel_medical_insurance', 'has_medical_insurance', 'has_health_insurance'],
    question:
      'Have you bought private medical insurance for the super visa — from a Canadian insurer (or an OSFI-authorised one), valid at least one year from your entry, with at least $100,000 of emergency coverage?',
    form: { label: 'Private medical insurance for the super visa', group: 'Insurance' },
  },
  {
    key: 'medical_insurance_provider',
    aliases: ['insurance_provider', 'insurance_company', 'insurer', 'travel_medical_insurance_provider'],
    question: 'Which insurance company issued the policy?',
    when: 'has_super_visa_insurance',
    form: { label: 'Insurance company', group: 'Insurance' },
  },
  {
    key: 'medical_insurance_coverage_cad',
    aliases: ['insurance_coverage_cad', 'insurance_coverage_amount', 'travel_medical_insurance_coverage_cad'],
    question: 'How much emergency medical coverage does the policy give, in Canadian dollars?',
    shape: 'a number in CAD',
    when: 'has_super_visa_insurance',
    form: { label: 'Emergency medical coverage (CAD)', group: 'Insurance' },
  },
  {
    key: 'medical_insurance_months',
    aliases: ['insurance_duration_months', 'insurance_validity_months', 'travel_medical_insurance_duration_months'],
    question: 'For how many months from your entry to Canada is the policy valid?',
    shape: 'a number of months',
    when: 'has_super_visa_insurance',
    form: { label: 'Policy valid for (months from entry)', group: 'Insurance' },
  },
  {
    key: 'medical_insurance_paid',
    aliases: ['insurance_paid', 'insurance_paid_in_full', 'travel_medical_insurance_paid'],
    question:
      'Is the policy paid in full, or in instalments with a deposit paid? (A quote is not accepted.)',
    when: 'has_super_visa_insurance',
    form: { label: 'Policy paid in full or by instalments', group: 'Insurance' },
  },
  {
    key: 'immigration_medical_exam_date',
    aliases: ['ime_date', 'medical_exam_date'],
    question:
      'On what date did you have your immigration medical exam with an IRCC panel physician?',
    shape: 'YYYY-MM-DD',
    when: 'medical_exam_last_12_months',
    form: { label: 'Immigration medical exam date', group: 'Medical exam' },
  },
  {
    key: 'has_property',
    aliases: ['owns_property', 'property_owned', 'home_owned'],
    question: 'Do you own a home, land or other property in your home country?',
  },
  {
    key: 'has_family_in_home_country',
    aliases: ['family_in_home_country', 'family_ties_outside_destination'],
    question:
      'Apart from your family in Canada, who remains in your home country — your spouse, other children, parents or siblings?',
  },
  {
    key: 'available_funds',
    aliases: ['personal_funds', 'savings', 'bank_balance'],
    question:
      'How much money do you have available yourself for this stay (savings or bank balance), and in which currency?',
    shape: 'a number; record the currency under funds_currency',
  },
]

// ── Business visitor ─────────────────────────────────────────────────────────
//
// What IRCC decides a business visit on, beyond the IMM 5257 visitor questions
// (registry `ca-business-visitors`, requirement codes in brackets): what the
// applicant will do and for whom [letters_of_support_and_invitation,
// two_original_invitation_letters], that their pay and place of business stay
// outside Canada [business_and_income_outside_canada,
// not_entering_canadian_labour_market], an event's code [obtain_event_code]
// and after-sales service under a contract [warranty_service_or_contract_documents].
// The visitor host questions hang off `family_in_destination`, so a business
// trip with no family in Canada was never asked who invites them — the
// inviter page went unfilled. Here the inviter is the Canadian contact.

/** The second inviter was described as a company, organization or event. */
function secondInviterIsOrganization(p: Record<string, unknown>): boolean {
  const v = p.second_inviter_relationship ?? p.second_host_relationship;
  return (
    typeof v === 'string' &&
    /\b(organi[sz]ation|company|employer|business partners?|conference|convention|event|trade (fair|show))\b/i.test(v)
  )
}

const BUSINESS_VISITOR_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'business_activity',
    aliases: ['business_activities', 'business_purpose'],
    question:
      'What will you do in Canada on this business trip — for example meetings or negotiations, a conference or trade fair, buying goods or services, after-sales service under a warranty, or training at a Canadian parent company?',
    form: { label: 'Business activity in Canada', group: 'Travel' },
  },
  {
    key: 'canadian_business_name',
    aliases: ['canadian_company_name', 'host_company_name', 'inviting_company_name'],
    question:
      'What is the name of the Canadian company or organization you are visiting, or of the event you are attending?',
    form: { label: 'Canadian company or organization', group: 'Host' },
  },
  {
    key: 'attending_business_event',
    aliases: ['attending_conference', 'attending_trade_fair'],
    question: 'Are you attending a conference, convention or trade fair?',
    form: { label: 'Attending a conference, convention or trade fair', group: 'Travel' },
  },
  {
    key: 'event_code',
    aliases: ['ircc_event_code'],
    question:
      'Did the organizer give you an IRCC event code? If yes, what is it? (Say "no" if there is none.)',
    when: 'attending_business_event',
    form: { label: 'IRCC event code', group: 'Travel' },
  },
  {
    key: 'inviter_name',
    aliases: ['host_name', 'host_full_name', 'inviter_full_name', 'business_contact_name'],
    question:
      'What is the full name of your contact person at that company or event (the person inviting you)?',
  },
  {
    key: 'inviter_address',
    aliases: ['host_address', 'canadian_business_address', 'company_address'],
    question:
      "What is the company's or event's full address in Canada, with the postal code?",
    shape: ADDRESS_SHAPE,
    incomplete: canadianAddressIncomplete('inviter_address', ['host_address', 'canadian_business_address', 'company_address']),
  },
  {
    key: 'inviter_phone',
    aliases: ['host_phone', 'host_telephone', 'business_contact_phone'],
    question: "What is your contact person's telephone number?",
    satisfiedBy: representativeIsHostWithPhone,
  },
  {
    key: 'inviter_phone_type',
    aliases: ['host_phone_type'],
    question: "Is your contact's telephone number a cell, office or other number?",
  },
  {
    key: 'inviter_email',
    aliases: ['host_email', 'business_contact_email'],
    question: "What is your contact person's email address?",
  },
  {
    key: 'has_second_inviter',
    aliases: ['second_inviter'],
    question: 'Is a second person or organization also inviting you to Canada?',
  },
  // IRCC asks a name for an inviter that is an organization or conference
  // (live 2026-10-19, first inviter). Asked only once the second inviter is
  // declared and named as one; until then it counts as answered.
  {
    key: 'second_inviter_organization_name',
    aliases: ['second_inviter_organization', 'second_inviter_company_name', 'second_inviter_company'],
    question:
      'What is the name of the second inviting organization, company or conference?',
    when: 'has_second_inviter',
    satisfiedBy: (p) => !secondInviterIsOrganization(p),
    form: { label: 'Second inviter — organization or conference name', group: 'Host' },
  },
  {
    key: 'paid_by_canadian_source',
    aliases: ['canadian_payment', 'paid_in_canada'],
    question:
      'Will any Canadian company or person pay you a salary, fee or commission for this work? (A business visitor must stay paid by their employer or business outside Canada.)',
    form: { label: 'Paid by a Canadian source for this trip', group: 'Employment' },
  },
  {
    key: 'trip_expenses_paid_by',
    aliases: ['who_pays_trip', 'travel_expenses_paid_by'],
    question:
      'Who pays for your travel and stay — you, your employer, or the Canadian company?',
    form: { label: 'Trip expenses paid by', group: 'Travel' },
  },
]

// ── IRCC eTA form ────────────────────────────────────────────────────────────
//
// What IRCC's online eTA application asks, in its order. Dry run 2026-10-16
// (app a37a534b): the eTA had no entry here, fell back to BASE_FACTS, and the
// interview "completed" after purpose, employment and stay length — none of
// which decide an eTA — while the form's own questions (US status, the CAN+
// branch, passport details, the background declarations) were never asked.
//
// Field names stay generic (passport_number, date_of_birth, …) so a passport
// upload that already wrote them satisfies the question and it is not asked.

/** Unemployed, retired or homemaker: the job questions do not apply. */
function noJob(p: Record<string, unknown>): boolean {
  const occ = textOf(p.occupation ?? p.occupation_category ?? p.employment_status).toLowerCase()
  if (/\b(unemployed|retired|homemaker|housewife|house\s*wife|not employed|none)\b/.test(occ)) return true
  return intakeAnswerIsYes(p.employed) === false && intakeAnswerIsYes(p.is_student) !== true
}

/** Not a national of a CAN+ country (when we know the nationality). */
function notCanPlus(p: Record<string, unknown>): boolean {
  const code = profileNationality(p)
  return !!code && !isEtaConditional(code)
}

/** A US lawful permanent resident does not need an eTA; the rest is moot. */
function isUsLpr(p: Record<string, unknown>): boolean {
  return intakeAnswerIsYes(p.us_permanent_resident ?? p.us_lawful_permanent_resident ?? p.has_us_green_card) === true
}

/**
 * A declaration whose aliases name only PART of its question (a visa refusal
 * alone, a criminal record alone, usually kept from an earlier interview). The
 * eTA mapping writes an alias "yes" as "Yes" but never an alias "no" as "No" —
 * another part may still be yes — so an alias "no" must not count as the
 * answer, or the question is never asked and IRCC's select stays blank.
 */
function wholeQuestionAnswer(key: string, aliases: readonly string[]) {
  return (p: Record<string, unknown>): string | undefined => {
    if (intakeAnswerIsYes(p[key]) !== undefined) return undefined
    if (aliases.some((a) => intakeAnswerIsYes(p[a]) === true)) return undefined
    return 'a yes or no to the whole question (the answer on file covers only part of it)'
  }
}

/**
 * A UCI or an IRCC visa / permit number (8 or 10 digits, or a letter and
 * nine digits), not a description that happens to hold a year.
 */
export function looksLikeIrccNumber(v: unknown): boolean {
  if (typeof v !== 'string' && typeof v !== 'number') return false
  const s = String(v).replace(/[\s-]/g, '')
  return /^\d{8}$|^\d{10}$|^[A-Za-z]\d{9}$/.test(s)
}

/** IRCC's eTA occupation groups (`employmentDetails_occupation`), as shown live 2026-10-18. */
export const ETA_OCCUPATION_GROUPS: readonly string[] = [
  'Art, culture, recreation and sport occupations',
  'Business, finance and administration occupations',
  'Education, law and social, community and government services occupations',
  'Health occupations',
  'Homemaker',
  'Management occupations',
  'Manufacturing and utilities occupations',
  'Military/armed forces',
  'Natural and applied sciences and related occupations',
  'Natural resources, agriculture and related production occupations',
  'Retired',
  'Sales and service occupations',
  'Student',
  'Trades, transport and equipment operators and related occupations',
  'Unemployed',
]

/** The eTA's listed conditions (`doYouHaveOneOfTheseConditions`), bar "None of the above". */
export const ETA_LISTED_CONDITIONS: readonly string[] = [
  'Untreated syphilis',
  'Untreated drug or alcohol addiction',
  'Untreated mental health condition with psychosis',
]

const ETA_REFUSAL_ALIASES = [
  'previous_visa_refused',
  'has_prior_refusal',
  'prior_visa_refusal',
  'visa_refused',
  'refused_visa',
]
const ETA_CRIMINAL_ALIASES = [
  'criminal_record',
  'committed_crime',
  'criminal_charges_or_convictions',
  'has_criminal_record',
]

const sameText = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '') === b.toLowerCase()

/**
 * The occupation group needs no question of its own: the answers already
 * name a status with no job behind it (retired, homemaker, unemployed, a
 * student), or name one of IRCC's groups word for word. A worker is asked:
 * a job title alone does not say which group IRCC files it under, and the
 * group and its five follow-ups are required (audit 2026-10-19).
 */
function etaGroupNamed(p: Record<string, unknown>): boolean {
  if (noJob(p)) return true
  if (intakeAnswerIsYes(p.retired ?? p.is_retired) === true) return true
  const said = [p.occupation, p.occupation_category, p.current_occupation, p.job_title]
    .map(textOf)
    .filter(Boolean)
  if (said.some((s) => ETA_OCCUPATION_GROUPS.some((g) => sameText(s, g)))) return true
  return said.length > 0 && said.every((s) => /^student$/i.test(s.trim()))
}

/**
 * Exported so the eTA portal mapping (apps/api portal-fills/canada-ircc-eta.ts)
 * reads exactly these keys and aliases — the two were built in parallel and
 * disagreed on every background question (dry run 2026-10-17, app 2f1c9cc9).
 */
export const IRCC_ETA_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'applying_on_behalf',
    form: { label: 'Applying on behalf of someone', group: 'Applicant' },
    aliases: ['applying_for_someone_else', 'on_behalf_of_someone'],
    question: 'Are you filling in this eTA application for yourself, or on behalf of someone else (for example a child)?',
    shape: 'false when for themselves, true when on behalf of someone else',
  },
  {
    key: 'travel_document_type',
    form: { label: 'Travel document', group: 'Passport' },
    aliases: ['passport_type'],
    question:
      'What travel document will you use to travel to Canada — a regular passport, a diplomatic/official passport, or another travel document?',
  },
  {
    key: 'passport_country',
    form: { label: 'Country of passport', group: 'Passport' },
    aliases: ['passport_issuing_country', 'passport_country_code', 'issuing_country'],
    question: 'Which country or territory issued your passport?',
  },
  {
    key: 'nationality',
    form: { label: 'Nationality', group: 'Passport' },
    aliases: ['citizenship', 'country_of_citizenship', 'applicant_citizenship', 'applicant_nationality'],
    question: 'What is your nationality, as shown on your passport?',
  },
  {
    key: 'us_permanent_resident',
    form: { label: 'Lawful permanent resident of the United States', group: 'Passport' },
    aliases: ['is_us_permanent_resident', 'us_lawful_permanent_resident', 'has_us_green_card', 'us_green_card'],
    question: 'Are you a lawful permanent resident of the United States (a green card holder)?',
  },
  {
    key: 'travel_by_air',
    form: { label: 'Travelling to Canada by air', group: 'Travel' },
    aliases: ['arriving_by_air', 'flying_to_canada'],
    question: 'Will you fly to Canada, or arrive by car, bus, train or boat?',
    shape: 'true when flying, false when arriving by land or sea',
  },
  {
    key: 'canadian_visa_last_10y',
    form: { label: 'Held a Canadian visitor visa in the past 10 years', group: 'Passport' },
    aliases: ['held_canadian_visa_last_10_years', 'had_canadian_visa_10_years'],
    question: 'Have you held a Canadian visitor visa (temporary resident visa) in the past 10 years?',
    satisfiedBy: (p) => notCanPlus(p) || isUsLpr(p),
  },
  {
    key: 'valid_us_nonimmigrant_visa',
    form: { label: 'Valid U.S. non-immigrant visa', group: 'Passport' },
    aliases: ['has_valid_us_visa', 'valid_us_visa', 'holds_us_visa', 'has_us_visa'],
    question: 'Do you currently hold a valid United States non-immigrant visa (for example a B1/B2)?',
    satisfiedBy: (p) => notCanPlus(p) || isUsLpr(p),
  },
  // IRCC asks the U.S. visa's number and expiry date straight after a "Yes"
  // (live recording 2026-10-18, Mexican persona).
  {
    key: 'us_nonimmigrant_visa_number',
    form: { label: 'U.S. non-immigrant visa number', group: 'Passport' },
    aliases: ['us_visa_number', 'us_nonimmigrant_visa_no'],
    question:
      'What is the number of your U.S. non-immigrant visa, exactly as printed on the visa (the red "Visa Number" in the lower right)?',
    when: 'valid_us_nonimmigrant_visa',
  },
  {
    key: 'us_nonimmigrant_visa_expiry_date',
    form: { label: 'U.S. non-immigrant visa expiry date', group: 'Passport' },
    aliases: ['us_visa_expiry_date', 'us_visa_expiry'],
    question: 'On what date does your U.S. non-immigrant visa expire (YYYY-MM-DD)?',
    when: 'valid_us_nonimmigrant_visa',
  },
  {
    key: 'passport_number',
    form: { label: 'Passport number', group: 'Passport' },
    aliases: ['passport_no', 'document_number'],
    question: 'What is your passport number, exactly as printed?',
  },
  {
    key: 'family_name',
    form: { label: 'Surname(s) / last name(s)', group: 'Passport' },
    aliases: ['surname', 'last_name'],
    question: 'What is your surname (last name), exactly as on your passport?',
  },
  {
    key: 'given_name',
    form: { label: 'Given name(s) / first name(s)', group: 'Passport' },
    aliases: ['given_names', 'first_name'],
    question: 'What are your given names (first names), exactly as on your passport?',
  },
  {
    key: 'date_of_birth',
    form: { label: 'Date of birth', group: 'Passport' },
    aliases: ['dob', 'birth_date'],
    question: 'What is your date of birth (YYYY-MM-DD)?',
  },
  {
    key: 'sex',
    form: { label: 'Gender', group: 'Passport' },
    aliases: ['gender'],
    question: 'What sex is shown on your passport?',
  },
  {
    key: 'country_of_birth',
    form: { label: 'Country/territory of birth', group: 'Passport' },
    aliases: ['birth_country'],
    question: 'In which country were you born?',
    satisfiedBy: (p) => /,\s*\S/.test(textOf(p.place_of_birth)),
  },
  {
    key: 'city_of_birth',
    form: { label: 'City/town of birth', group: 'Passport' },
    aliases: ['place_of_birth', 'birth_city', 'town_of_birth'],
    question: 'In which city or town were you born?',
  },
  {
    key: 'passport_issue_date',
    form: { label: 'Passport date of issue', group: 'Passport' },
    aliases: ['issue_date', 'date_of_issue', 'passport_date_of_issue'],
    question: 'On what date was your passport issued (YYYY-MM-DD)?',
  },
  {
    key: 'passport_expiry_date',
    form: { label: 'Passport date of expiry', group: 'Passport' },
    aliases: ['expiry_date', 'passport_expiry', 'date_of_expiry', 'passport_expiration_date'],
    question: 'On what date does your passport expire (YYYY-MM-DD)?',
  },
  // personalDetails_additionalCitizenship (optional, one country; recorded
  // live 2026-10-19: the nationality list minus the passport's own). The
  // mapping chooses the first other country; a second one is the
  // applicant's to know about, as the form holds only one.
  {
    key: 'other_citizenships',
    form: { label: 'Other citizenships', group: 'Passport' },
    aliases: ['other_citizenship', 'additional_citizenships', 'additional_citizenship'],
    question: 'Are you also a citizen of any other country? If so, which?',
    shape: 'a list of country names, [] when none',
    satisfiedBy: (p) =>
      intakeAnswerIsYes(p.multiple_citizenship ?? p.dual_citizenship ?? p.dual_national) === false,
  },
  {
    key: 'previous_canada_application',
    form: { label: 'Applied for or obtained a Canadian visa, eTA or permit before', group: 'Personal details' },
    aliases: ['previously_applied_to_canada', 'previous_canadian_visa'],
    question:
      'Have you ever applied for or obtained a visa, an eTA or a permit to visit, live, work or study in Canada?',
    // `previous_canadian_visa` may hold a visa number rather than a yes/no:
    // that is a "yes" (the mapping reads it so). Anything else that is not a
    // yes/no left IRCC's select blank (audit 2026-10-19).
    incomplete: (p) =>
      ['previous_canada_application', 'previously_applied_to_canada', 'previous_canadian_visa'].some(
        (k) => intakeAnswerIsYes(p[k]) !== undefined || looksLikeIrccNumber(p[k]),
      )
        ? undefined
        : 'a yes or no',
  },
  {
    key: 'uci',
    form: { label: 'Unique client identifier (UCI) / previous Canadian visa number', group: 'Personal details' },
    aliases: ['unique_client_identifier', 'previous_canadian_visa_number', 'client_id'],
    question:
      'What is your unique client identifier (UCI) or the number of your previous Canadian visa or permit? It is optional: say "I don\'t know" if you cannot find it.',
    when: 'previous_canada_application',
  },
  {
    key: 'marital_status',
    form: { label: 'Marital status', group: 'Personal details' },
    aliases: ['civil_status'],
    question: 'What is your current marital status — single, married, common-law, divorced, separated, widowed or annulled marriage?',
  },
  {
    key: 'occupation',
    form: { label: 'Occupation', group: 'Employment' },
    aliases: ['occupation_category', 'current_occupation'],
    question:
      'What is your occupation — for example employed, self-employed, student, homemaker, retired or unemployed?',
  },
  {
    key: 'job_title',
    form: { label: 'Job title', group: 'Employment' },
    aliases: ['position', 'job', 'designation'],
    question: 'What is your job title?',
    satisfiedBy: noJob,
  },
  // IRCC's required occupation select is a list of groups; a job title alone
  // often matches none of them with confidence, which left the group and its
  // five required follow-ups blank (audit 2026-10-19). Asked of workers.
  {
    key: 'eta_occupation_group',
    form: { label: 'Occupation group (IRCC list)', group: 'Employment' },
    aliases: ['occupation_group'],
    question: `IRCC asks you to choose an occupation group. Which one fits your current work best: ${ETA_OCCUPATION_GROUPS.join('; ')}?`,
    shape: 'exactly one of the listed group names, word for word',
    satisfiedBy: etaGroupNamed,
  },
  {
    key: 'employer_name',
    form: { label: 'Name of employer or school', group: 'Employment' },
    aliases: ['employer', 'company_name', 'school_name'],
    question: 'What is the name of your employer, business or school?',
    satisfiedBy: noJob,
  },
  {
    key: 'employment_country',
    form: { label: 'Country/territory of employment', group: 'Employment' },
    aliases: ['employer_country', 'work_country'],
    question: 'In which country is that job, business or school?',
    satisfiedBy: noJob,
  },
  {
    key: 'employment_city',
    form: { label: 'City/town of employment', group: 'Employment' },
    aliases: ['employer_city', 'work_city'],
    question: 'In which city or town?',
    satisfiedBy: noJob,
  },
  {
    key: 'employment_since_year',
    form: { label: 'Since what year', group: 'Employment' },
    aliases: ['employed_since', 'employment_start_year', 'working_since'],
    question: 'Since what year have you held that job or studied there?',
    satisfiedBy: noJob,
  },
  {
    key: 'email',
    form: { label: 'Email address', group: 'Contact' },
    aliases: ['applicant_email', 'contact_email', 'email_address'],
    question: 'What email address should IRCC send the eTA decision to?',
  },
  {
    key: 'preferred_contact_language',
    form: { label: 'Preferred language of contact', group: 'Contact' },
    aliases: ['preferred_language'],
    question: 'Would you like IRCC to contact you in English or French?',
  },
  {
    key: 'residential_address',
    form: { label: 'Residential address', group: 'Contact' },
    aliases: ['home_address', 'current_address', 'address'],
    question:
      'What is your full home address — street, city, district or region, postal code and country?',
  },
  {
    key: 'travel_date_known',
    form: { label: 'Knows when they will travel to Canada', group: 'Travel' },
    aliases: ['knows_travel_date'],
    question: 'Do you already know when you will travel to Canada?',
    satisfiedBy: (p) => present(p.planned_entry_date ?? p.intended_arrival_date ?? p.arrival_date),
  },
  {
    ...PLANNED_ENTRY,
    question: 'On what date will you arrive in Canada (YYYY-MM-DD)?',
    when: 'travel_date_known',
  },
  // IRCC requires the hour and minute (and a time zone) once the travel date
  // is known (live 2026-10-18).
  {
    key: 'planned_entry_time',
    form: { label: 'Time of arrival', group: 'Travel' },
    aliases: ['arrival_time', 'flight_arrival_time'],
    question:
      'At what time does your flight land in Canada, in local time at the Canadian airport (24-hour HH:MM)? Say "I don\'t know" if you have no flight yet.',
    shape: 'HH:MM, 24-hour, local time where the flight lands',
    when: 'travel_date_known',
  },
  // The time zone is required with the time (live 2026-10-19, 160 options).
  // The time above is local time where the flight lands, so its zone is the
  // Canadian airport's — asked by the city, which the applicant knows, and
  // turned into IRCC's zone name by the mapping (canada-ircc-eta.ts). Not
  // asked without a time: there is nothing for a zone to qualify.
  {
    key: 'planned_entry_timezone',
    form: { label: 'Time zone of arrival', group: 'Travel' },
    aliases: ['arrival_timezone', 'arrival_city_canada', 'arrival_airport'],
    question:
      'In which Canadian city or airport does your flight land (for example Toronto Pearson, Vancouver or Montreal)?',
    shape: 'the Canadian city or airport, or the time zone (for example "Eastern Time")',
    when: 'travel_date_known',
    satisfiedBy: (p) => {
      const t = textOf(p.planned_entry_time ?? p.arrival_time ?? p.flight_arrival_time)
      return !t || !/\d{1,2}\s*[:h.]\s*\d{2}/.test(t)
    },
  },
  DECLARATION(
    'refused_visa_or_denied_entry',
    'Have you ever been refused a visa or permit, denied entry to, or ordered to leave Canada or any other country?',
    ETA_REFUSAL_ALIASES,
    {
      form: { label: 'Refused a visa or permit, denied entry or ordered to leave', group: 'Background' },
      incomplete: wholeQuestionAnswer('refused_visa_or_denied_entry', ETA_REFUSAL_ALIASES),
    },
  ),
  // The details box IRCC shows after a "Yes" (live 2026-10-18). Same key and
  // shape as the visitor-visa interview, so one formatter writes both.
  {
    key: 'refusal_details',
    form: { label: 'Refusal, denied entry or removal details', group: 'Background' },
    aliases: ['previous_visa_refusal_details'],
    shape: 'a list of {country, what_was_refused, month_year (YYYY-MM), where (city or consulate where it happened, if given), reason}, one per refusal',
    satisfiedBy: (p) =>
      present(p.previous_visa_refusal_reason) ||
      (present(p.previous_visa_refusal_country) && present(p.previous_visa_refusal_date)),
    question:
      'For each refusal, denied entry or order to leave: which country, what was refused (for example a visitor visa), the month and year, and the reason given?',
    when: 'refused_visa_or_denied_entry',
  },
  DECLARATION(
    'criminal_offence',
    'Have you ever committed, been arrested for, been charged with or convicted of any criminal offence in any country?',
    ETA_CRIMINAL_ALIASES,
    {
      form: { label: 'Criminal offence in any country', group: 'Background' },
      incomplete: wholeQuestionAnswer('criminal_offence', ETA_CRIMINAL_ALIASES),
    },
  ),
  {
    key: 'criminal_offence_details',
    form: { label: 'Arrest, charge or conviction details', group: 'Background' },
    aliases: ['criminal_details', 'criminal_offence_anywhere_details'],
    shape: 'a list of {city, country, month_year (YYYY-MM), offence, sentence}, one per arrest, charge or conviction',
    question:
      'For each arrest, charge or conviction: where (city and country), when (month and year), what the offence was, and the sentence?',
    when: 'criminal_offence',
  },
  DECLARATION(
    'tuberculosis_last_2_years',
    'In the past two years, were you diagnosed with tuberculosis, or have you been in close contact with someone who has tuberculosis?',
    ['tb_last_2_years', 'tuberculosis_diagnosis_or_contact'],
    { form: { label: 'Tuberculosis diagnosis or close contact in the past two years', group: 'Background' } },
  ),
  DECLARATION(
    'tuberculosis_health_care_worker',
    'Is that contact with tuberculosis the result of being a health care worker?',
    ['tb_health_care_worker'],
    {
      askedBy: /health[- ]?care worker/i,
      when: 'tuberculosis_last_2_years',
      form: { label: 'Tuberculosis contact as a health care worker', group: 'Background' },
    },
  ),
  // IRCC asks this only after a "Yes" to the health-care-worker question
  // (live 2026-10-18); a "No" there ends the tuberculosis questions.
  DECLARATION(
    'tuberculosis_ever_diagnosed',
    'Have you ever been diagnosed with tuberculosis?',
    ['tb_ever_diagnosed', 'ever_diagnosed_with_tuberculosis'],
    {
      askedBy: /ever (been )?diagnosed/i,
      when: 'tuberculosis_health_care_worker',
      form: { label: 'Ever diagnosed with tuberculosis', group: 'Background' },
    },
  ),
  DECLARATION(
    'eta_medical_conditions',
    'Do you have any of these conditions: untreated syphilis, untreated drug or alcohol addiction, or an untreated mental health condition with psychosis?',
    ['has_listed_medical_conditions'],
    { form: { label: 'Untreated syphilis, addiction or mental health condition with psychosis', group: 'Background' } },
  ),
  // IRCC's select names ONE condition; a "yes" alone chooses none of them and
  // left the declaration blank (audit 2026-10-19).
  {
    key: 'eta_medical_condition',
    form: { label: 'Which listed health condition', group: 'Background' },
    aliases: ['listed_medical_condition'],
    question: `Which one: ${ETA_LISTED_CONDITIONS.map((c) => c.toLowerCase()).join(', or ')}?`,
    shape: `exactly one of ${ETA_LISTED_CONDITIONS.map((c) => `"${c}"`).join(', ')}`,
    when: 'eta_medical_conditions',
  },
]

/** A spouse or common-law partner who is not a Canadian citizen or PR and comes along. */
const spouseCounts = (p: Record<string, unknown>) =>
  hasSpouse(p) === true &&
  intakeAnswerIsYes(p.spouse_canadian_citizen_or_pr) !== true &&
  intakeAnswerIsYes(p.spouse_coming_to_canada) !== false

/** The spouse's own language, education and work answers do not apply. */
const spouseNotCounted = (p: Record<string, unknown>) => hasSpouse(p) === false || (hasSpouse(p) === true && !spouseCounts(p))

/**
 * What IRCC's Express Entry profile asks (permanent residence, not a visit).
 * Source, read 2026-10-19 (page dated 2026-10-16):
 * https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents.html
 * — passport, language test results, Canadian education or an educational
 * credential assessment (ECA), proof of work experience, a written job offer,
 * a certificate of qualification in a trade, proof of funds and a provincial
 * nomination. The profile itself asks the details off those documents.
 *
 * Approval-neutral: these collect the profile's answers. VisaAI computes no
 * Comprehensive Ranking System score and predicts no invitation.
 */
export const IRCC_EE_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'family_name',
    form: { label: 'Family name', group: 'Personal details' },
    aliases: ['surname', 'last_name'],
    question: 'What is your family name (surname), exactly as on your passport?',
  },
  {
    key: 'given_name',
    form: { label: 'Given name(s)', group: 'Personal details' },
    aliases: ['given_names', 'first_name'],
    question: 'What are your given names, exactly as on your passport?',
  },
  {
    key: 'date_of_birth',
    form: { label: 'Date of birth', group: 'Personal details' },
    aliases: ['dob', 'birth_date'],
    question: 'What is your date of birth (YYYY-MM-DD)?',
  },
  {
    key: 'sex',
    form: { label: 'Sex', group: 'Personal details' },
    aliases: ['gender'],
    question: 'What sex is shown on your passport?',
  },
  {
    key: 'country_of_birth',
    form: { label: 'Country of birth', group: 'Personal details' },
    aliases: ['birth_country'],
    question: 'In which country were you born?',
  },
  {
    key: 'city_of_birth',
    form: { label: 'City of birth', group: 'Personal details' },
    aliases: ['place_of_birth', 'birth_city'],
    question: 'In which city or town were you born?',
  },
  {
    key: 'nationality',
    form: { label: 'Country of citizenship', group: 'Personal details' },
    aliases: ['citizenship', 'country_of_citizenship', 'applicant_citizenship', 'applicant_nationality'],
    question: 'Which country are you a citizen of?',
  },
  {
    key: 'country_of_residence',
    form: { label: 'Current country of residence', group: 'Personal details' },
    aliases: ['current_country_of_residence', 'residence_country'],
    question: 'Which country do you live in now, and what is your status there (citizen, permanent resident, worker, student, visitor)?',
  },
  {
    key: 'passport_number',
    form: { label: 'Passport number', group: 'Passport' },
    aliases: ['passport_no'],
    question: 'What is your passport number, exactly as printed?',
  },
  {
    key: 'passport_expiry_date',
    form: { label: 'Passport expiry date', group: 'Passport' },
    aliases: ['passport_expiry', 'passport_expiration_date'],
    question: 'When does your passport expire (YYYY-MM-DD)?',
  },
  {
    key: 'marital_status',
    form: { label: 'Marital status', group: 'Family' },
    aliases: ['civil_status'],
    question: 'What is your marital status: single, married, common-law, separated, divorced, widowed or annulled marriage?',
  },
  {
    key: 'spouse_canadian_citizen_or_pr',
    form: { label: 'Spouse or partner is a Canadian citizen or permanent resident', group: 'Family' },
    aliases: ['spouse_is_canadian', 'spouse_canadian_status'],
    question: 'Is your spouse or common-law partner a Canadian citizen or permanent resident?',
    satisfiedBy: noSpouse,
  },
  {
    key: 'spouse_coming_to_canada',
    form: { label: 'Spouse or partner will come with you to Canada', group: 'Family' },
    aliases: ['spouse_accompanying'],
    question: 'Will your spouse or common-law partner come with you to Canada?',
    satisfiedBy: (p) => noSpouse(p) || intakeAnswerIsYes(p.spouse_canadian_citizen_or_pr) === true,
  },
  {
    key: 'family_members_count',
    form: { label: 'Family members (you, your spouse or partner, dependent children)', group: 'Family' },
    aliases: ['family_size', 'number_of_family_members'],
    question: 'How many family members are in your application, counting yourself, your spouse or partner and your dependent children (even those not coming)?',
  },
  {
    key: 'language_test_type',
    form: { label: 'Language test', group: 'Language' },
    aliases: ['english_test_type', 'language_test', 'french_test_type'],
    question: 'Which approved language test did you take: IELTS General Training, CELPIP-General, PTE Core, TEF Canada or TCF Canada?',
  },
  {
    key: 'language_test_date',
    form: { label: 'Date of test', group: 'Language' },
    aliases: ['ielts_test_date', 'celpip_test_date'],
    question: 'On what date did you take the test (YYYY-MM-DD)? Results must be less than 2 years old when you apply.',
  },
  {
    key: 'language_test_result_date',
    form: { label: 'Date of test result', group: 'Language' },
    aliases: ['language_result_date'],
    question: 'On what date were your results issued (YYYY-MM-DD)?',
  },
  {
    key: 'language_test_certificate_number',
    form: { label: 'Test certificate or registration number', group: 'Language' },
    aliases: ['ielts_trf_number', 'trf_number', 'celpip_registration_number', 'language_test_registration_number'],
    question: 'What is the certificate number on your results (IELTS Test Report Form number, CELPIP registration number, PTE score report code, TEF/TCF certificate number)?',
  },
  {
    key: 'language_test_scores',
    form: { label: 'Scores: listening, reading, writing, speaking', group: 'Language' },
    aliases: ['ielts_scores', 'celpip_scores', 'language_scores'],
    question: 'What are your scores for listening, reading, writing and speaking, exactly as on your results?',
    shape: '{ listening, reading, writing, speaking }',
  },
  {
    key: 'second_language_test',
    form: { label: 'Results in the other official language', group: 'Language' },
    aliases: ['has_second_language_test'],
    question: 'Do you also have test results in the other official language (French if your first test was English, or English)? If yes, which test, date and scores?',
  },
  {
    key: 'highest_education_level',
    form: { label: 'Highest level of education', group: 'Education' },
    aliases: ['education_level', 'highest_education'],
    question: 'What is your highest completed level of education (secondary, one-year program, two-year program, bachelor’s, two or more credentials, master’s, PhD)?',
  },
  {
    key: 'has_canadian_education',
    form: { label: 'Education completed in Canada', group: 'Education' },
    aliases: ['canadian_education', 'studied_in_canada'],
    question: 'Did you complete any post-secondary education in Canada? If yes, what level and how long was the program?',
  },
  {
    key: 'has_eca',
    form: { label: 'Educational credential assessment (ECA)', group: 'Education' },
    aliases: ['has_educational_credential_assessment', 'eca'],
    question: 'Do you have an educational credential assessment (ECA) report for immigration for your education from outside Canada?',
  },
  {
    key: 'eca_organization',
    form: { label: 'ECA organization', group: 'Education' },
    aliases: ['eca_issuer', 'eca_body'],
    question: 'Which organization issued your ECA (for example WES, ICAS, IQAS, CES, ICES, MCC, PEBC)?',
    when: 'has_eca',
  },
  {
    key: 'eca_number',
    form: { label: 'ECA reference number', group: 'Education' },
    aliases: ['eca_reference_number', 'wes_reference_number'],
    question: 'What is the reference number on your ECA report?',
    when: 'has_eca',
  },
  {
    key: 'eca_issue_date',
    form: { label: 'ECA issue date', group: 'Education' },
    aliases: ['eca_date'],
    question: 'On what date was your ECA report issued (YYYY-MM-DD)? It must be less than 5 years old when you apply.',
    when: 'has_eca',
  },
  {
    key: 'work_history',
    form: { label: 'Work experience in the past 10 years', group: 'Work' },
    aliases: ['employment_history', 'work_experience'],
    question:
      'List each job of the past 10 years: job title, employer, country, start and end dates, hours per week, and the main duties (so the right NOC code can be chosen).',
    shape: 'list of { job_title, employer, country, start_date, end_date, hours_per_week, noc_code, duties }',
  },
  {
    key: 'canadian_work_experience',
    form: { label: 'Skilled work experience in Canada', group: 'Work' },
    aliases: ['has_canadian_work_experience', 'worked_in_canada'],
    question: 'Have you worked in Canada with authorization (a work permit) in a skilled job? If yes, for how long?',
  },
  {
    key: 'has_job_offer',
    form: { label: 'Valid job offer in Canada', group: 'Job offer' },
    aliases: ['job_offer', 'canadian_job_offer'],
    question: 'Do you have a written job offer from an employer in Canada?',
  },
  {
    key: 'job_offer_details',
    form: { label: 'Job offer: employer, NOC, LMIA', group: 'Job offer' },
    aliases: ['job_offer_noc', 'job_offer_lmia'],
    question: 'Who is the employer, what is the job title and NOC code, and is it supported by an LMIA or LMIA-exempt?',
    when: 'has_job_offer',
  },
  {
    key: 'has_trade_certificate',
    form: { label: 'Certificate of qualification in a trade', group: 'Work' },
    aliases: ['certificate_of_qualification'],
    question: 'Do you have a certificate of qualification in a trade, issued by a Canadian province or territory?',
  },
  {
    key: 'has_provincial_nomination',
    form: { label: 'Provincial or territorial nomination', group: 'Nomination' },
    aliases: ['provincial_nomination', 'pnp_nomination'],
    question: 'Do you have a nomination from a Canadian province or territory (Provincial Nominee Program)? If yes, which one?',
  },
  {
    key: 'settlement_funds_cad',
    form: { label: 'Funds available to settle in Canada (CAD)', group: 'Funds' },
    // Not `available_funds` / `proof_of_funds`: those hold a visitor's
    // amount in any currency, or a document, and would show as CAD here.
    aliases: ['settlement_funds'],
    question:
      'How much money (in Canadian dollars) do you have available to settle in Canada, not borrowed? (Not needed under the Canadian Experience Class or with a valid job offer — say so if that is you.)',
  },
  {
    key: 'sibling_in_canada',
    form: { label: 'Brother or sister in Canada (citizen or PR, 18+)', group: 'Family' },
    aliases: ['has_sibling_in_canada'],
    question:
      'Do you (or your spouse or partner) have a brother or sister living in Canada who is a citizen or permanent resident and at least 18?',
  },
  {
    key: 'spouse_language_test',
    form: { label: 'Spouse or partner: language test results', group: 'Spouse' },
    aliases: ['spouse_language_scores'],
    question: 'Does your spouse or partner have language test results? If yes, which test, date and scores?',
    satisfiedBy: spouseNotCounted,
  },
  {
    key: 'spouse_education_level',
    form: { label: 'Spouse or partner: highest level of education', group: 'Spouse' },
    aliases: ['spouse_highest_education'],
    question: 'What is your spouse or partner’s highest completed level of education?',
    satisfiedBy: spouseNotCounted,
  },
  {
    key: 'spouse_canadian_work_experience',
    form: { label: 'Spouse or partner: skilled work experience in Canada', group: 'Spouse' },
    aliases: [],
    question: 'Has your spouse or partner worked in Canada in a skilled job? If yes, for how long?',
    satisfiedBy: spouseNotCounted,
  },
  {
    key: 'preferred_provinces',
    form: { label: 'Provinces or territories you want to live in', group: 'Preferences' },
    aliases: ['intended_province', 'province_of_destination'],
    question: 'Which Canadian provinces or territories would you like to live in?',
  },
  {
    key: 'previous_canada_application',
    form: { label: 'Applied to IRCC before', group: 'Background' },
    aliases: ['applied_to_canada_before', 'previous_ircc_application'],
    question: 'Have you applied to IRCC before (any visa, permit or profile)? If yes, what is your UCI (client ID)?',
  },
  {
    key: 'email',
    form: { label: 'Email', group: 'Contact' },
    aliases: ['email_address'],
    question: 'What email address should IRCC use to contact you?',
  },
]

// ── Canada spousal sponsorship (permanent residence) ─────────────────────────
//
// Filed on IRCC's Permanent Residence Portal as two applications: the
// sponsor's (IMM 1344, IMM 5532 Part A, PDFs the sponsor signs) and the
// principal applicant's (IMM 0008, IMM 5669, IMM 5406 online, IMM 5532 Part B).
// Sources read 2026-10-19: guide 5525, checklist IMM 5533, the forms above.
// https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5525-sponsor-your-spouse-common-law-partner-conjugal-partner-dependent-child-complete-guide.html
//
// The principal applicant's own facts keep the keys the other IRCC routes
// use, so documents and the Forms page answer them the same way. The sponsor
// is the applicant's spouse here, so the visitor routes' spouse_* questions
// are not asked: the sponsor_* facts carry that person.

/** The specs of `keys`, in that order, taken from an existing route's list. */
function pickFacts(from: readonly IntakeFactSpec[], keys: readonly string[]): IntakeFactSpec[] {
  return keys.map((k) => {
    const spec = from.find((f) => f.key === k)
    if (!spec) throw new Error(`intake fact ${k} is not defined`)
    return spec
  })
}

const relationshipTypeOf = (p: Record<string, unknown>) =>
  textOf(
    p.relationship_type ?? p.sponsor_relationship_to_applicant ?? p.sponsorship_relationship,
  ).toLowerCase()
const isConjugal = (p: Record<string, unknown>) => /conjugal/.test(relationshipTypeOf(p))
const isMarried = (p: Record<string, unknown>) =>
  /spouse|married|marriage|husband|wife/.test(relationshipTypeOf(p)) ||
  (/married/.test(textOf(p.marital_status).toLowerCase()) &&
    !/never|un-?married/.test(textOf(p.marital_status).toLowerCase()))
const isDependentChild = (p: Record<string, unknown>) => /child/.test(relationshipTypeOf(p))
/** A partner relationship (not a dependent child). */
const notPartner = (p: Record<string, unknown>) => isDependentChild(p)

/**
 * IMM 1344's sponsor eligibility assessment. Asked as one question (the
 * sponsor reads the list and says which apply, or none) and kept only when
 * it was asked: each is a signed declaration and is never inferred.
 */
export const SPONSOR_ELIGIBILITY_BARS: readonly string[] = [
  'sponsor became a permanent resident after being sponsored as a spouse or partner less than 5 years ago',
  'sponsor sponsored a previous spouse or partner who became a permanent resident less than 3 years ago',
  'sponsor has an earlier application for this same person with no final decision',
  'sponsor receives social assistance for a reason other than a disability',
  'sponsor is an undischarged bankrupt',
  'someone the sponsor sponsored or co-signed for received social assistance during the undertaking',
  'sponsor has been ordered to leave Canada',
  'sponsor is late on an immigration loan, performance bond or other immigration payment',
  'sponsor is in jail, prison or a penitentiary',
  'sponsor was convicted of a sexual offence, a violent offence, or an offence that hurt a relative',
  'sponsor is behind on court-ordered support payments',
  'sponsor is subject of an application to revoke citizenship, or of a report on inadmissibility',
  'sponsor is charged with an offence punishable by 10 years or more',
]

/**
 * Every spousal question is on the Forms page (askOnForm), so each needs a
 * form label: a declaration or a reused visitor spec without one takes its
 * question. Copies, so the shared specs other routes use are unchanged.
 */
function onForm(specs: readonly IntakeFactSpec[]): IntakeFactSpec[] {
  return specs.map((s) => (s.form ? s : { ...s, form: { label: s.question, group: 'Background' } }))
}

export const IRCC_SPOUSAL_FACTS: readonly IntakeFactSpec[] = onForm([
  // ── The relationship (decides every other question)
  {
    key: 'relationship_type',
    form: { label: 'You are the sponsor’s', group: 'Relationship' },
    aliases: ['sponsor_relationship_to_applicant', 'sponsorship_relationship'],
    question:
      'Who is being sponsored: the sponsor’s spouse (married), common-law partner (lived together 12 months in a row), conjugal partner (together at least 1 year but unable to marry or live together), or dependent child?',
    shape: 'one of "spouse", "common-law partner", "conjugal partner", "dependent child"',
  },
  {
    key: 'application_class',
    form: { label: 'Application class', group: 'Relationship' },
    aliases: ['sponsorship_class'],
    question:
      'Where does the person being sponsored live now: outside Canada, or in Canada living with the sponsor?',
    shape: '"family class (outside Canada)" or "spouse or common-law partner in Canada class"',
  },
  ...pickFacts(IRCC_PORTAL_FACTS, ['marital_status', 'marriage_date']),
  {
    key: 'conjugal_relationship_start_date',
    form: { label: 'Date the conjugal relationship began', group: 'Relationship' },
    // Not relationship_start_date: that is an alias of marriage_date.
    aliases: ['conjugal_since'],
    question: 'On what date did your conjugal relationship begin (YYYY-MM-DD)?',
    satisfiedBy: (p) => !isConjugal(p),
  },
  {
    key: 'first_met_date',
    form: { label: 'Date you first met in person', group: 'Relationship' },
    aliases: ['date_first_met', 'met_in_person_date'],
    question: 'On what date did you and your sponsor first meet in person (YYYY-MM-DD)?',
    satisfiedBy: notPartner,
  },
  {
    key: 'first_met_place',
    form: { label: 'Where you first met in person', group: 'Relationship' },
    aliases: ['place_first_met'],
    question: 'Where did you first meet in person (city and country), and how did it come about? Did anyone introduce you?',
    satisfiedBy: notPartner,
  },
  {
    key: 'contact_before_meeting',
    form: { label: 'Contact before meeting in person', group: 'Relationship' },
    aliases: ['online_contact_before_meeting'],
    question:
      'Were you in contact before you met in person? If yes: who made first contact, on what date, and how (online, phone, through family)?',
    satisfiedBy: notPartner,
  },
  {
    key: 'living_together',
    form: { label: 'Living together now', group: 'Relationship' },
    aliases: ['currently_living_together', 'cohabiting'],
    question: 'Do you and your sponsor live together now?',
    satisfiedBy: notPartner,
  },
  {
    key: 'cohabitation_periods',
    form: { label: 'Periods you have lived together', group: 'Relationship' },
    aliases: ['lived_together_periods'],
    question:
      'For each period you have lived together: from and to (YYYY-MM) and the address (city and country). If you have never lived together, say why.',
    shape: 'a list of {"from" (YYYY-MM), "to" (YYYY-MM or "present"), "address"}, or a string saying why not',
    satisfiedBy: (p) => notPartner(p) || (isMarried(p) && isNo(p.living_together)),
  },
  {
    key: 'visits',
    form: { label: 'Visits while apart', group: 'Relationship' },
    aliases: ['visits_together', 'in_person_visits'],
    question:
      'Since your relationship began, list each time you saw each other in person while living apart: dates (from and to), who visited whom, where, and whether you stayed together. If there were none, say why.',
    shape: 'a list of {"from", "to", "visitor", "place", "stayed_together": true|false}, or a string saying why none',
    satisfiedBy: (p) => notPartner(p) || intakeAnswerIsYes(p.living_together) === true,
  },
  {
    key: 'communication_while_apart',
    form: { label: 'How and how often you communicate', group: 'Relationship' },
    aliases: ['communication_frequency'],
    question: 'When you are apart, how do you keep in touch (calls, video, messages) and how often? Which languages do you speak together?',
    satisfiedBy: (p) => notPartner(p) || intakeAnswerIsYes(p.living_together) === true,
  },
  {
    key: 'marriage_arranged',
    form: { label: 'Arranged marriage', group: 'Relationship' },
    aliases: ['arranged_marriage'],
    question: 'Was your marriage arranged? If yes: by whom, and when and where was it arranged?',
    satisfiedBy: (p) => !isMarried(p),
  },
  {
    key: 'relationship_ceremonies',
    form: { label: 'Engagement, wedding and other ceremonies', group: 'Relationship' },
    aliases: ['wedding_details', 'marriage_ceremony'],
    question:
      'List your engagement, wedding, reception or similar events: date, place, about how many guests, and whether both of your parents attended. If you had none, say why.',
    shape: 'a list of {"event", "date", "place", "guests", "parents_attended"}, or a string saying why none',
    satisfiedBy: notPartner,
  },
  {
    key: 'relationship_known_to',
    form: { label: 'Family and friends who know about the relationship', group: 'Relationship' },
    aliases: ['family_aware_of_relationship'],
    question:
      'Do your families and close friends know about your relationship, and have they met your sponsor? If not, why?',
    satisfiedBy: notPartner,
  },
  {
    key: 'children_together',
    form: { label: 'Children together', group: 'Relationship' },
    aliases: ['have_children_together', 'children_with_sponsor'],
    question: 'Do you and your sponsor have children together, or is either of you expecting a baby (due date)?',
    satisfiedBy: notPartner,
  },
  DECLARATION(
    'applicant_previous_relationship',
    'Have you ever been married or in a common-law relationship before this one?',
    ['previously_married', 'has_previous_relationship'],
  ),
  {
    key: 'previous_relationships',
    form: { label: 'Your previous marriages or common-law relationships', group: 'Relationship' },
    aliases: ['previous_marriages', 'former_spouses'],
    question:
      'For each earlier marriage or common-law relationship: the person’s full name and date of birth, married or common-law, from and to (YYYY-MM-DD), and how it ended (divorce, annulment, death, separation).',
    shape: 'a list of {"name", "date_of_birth", "type", "from", "to", "how_ended"}',
    when: 'applicant_previous_relationship',
  },
  DECLARATION(
    'applicant_previously_sponsored',
    'Has anyone ever sponsored you, or applied to sponsor you, to come to Canada before (whatever the outcome)?',
    ['previously_sponsored'],
  ),
  declarationDetails(
    'applicant_previously_sponsored',
    'Who was the sponsor (full name and date of birth), when was it, and what happened?',
    ['previous_sponsorship_details'],
  ),

  // ── The sponsor
  {
    key: 'sponsor_family_name',
    form: { label: 'Sponsor: family name', group: 'Sponsor' },
    aliases: ['sponsor_surname', 'sponsor_last_name'],
    question: 'What is your sponsor’s family name (surname), exactly as on their passport or Canadian document?',
  },
  {
    key: 'sponsor_given_name',
    form: { label: 'Sponsor: given name(s)', group: 'Sponsor' },
    aliases: ['sponsor_first_name', 'sponsor_given_names'],
    question: 'What are your sponsor’s given names?',
  },
  {
    key: 'sponsor_date_of_birth',
    form: { label: 'Sponsor: date of birth', group: 'Sponsor' },
    aliases: ['sponsor_dob'],
    question: 'What is your sponsor’s date of birth (YYYY-MM-DD)?',
  },
  {
    key: 'sponsor_country_of_birth',
    form: { label: 'Sponsor: country and city of birth', group: 'Sponsor' },
    aliases: ['sponsor_place_of_birth'],
    question: 'In which city and country was your sponsor born?',
  },
  {
    key: 'sponsor_status',
    form: { label: 'Sponsor: status in Canada', group: 'Sponsor' },
    aliases: ['sponsor_canadian_status', 'sponsor_immigration_status'],
    question:
      'Is your sponsor a Canadian citizen (born Canadian, or naturalized), a permanent resident of Canada, or registered under the Indian Act?',
    shape:
      'one of "Canadian citizen by birth", "Canadian citizen (naturalized)", "permanent resident", "registered Indian"',
  },
  {
    key: 'sponsor_status_date',
    form: { label: 'Sponsor: date became a permanent resident or citizen', group: 'Sponsor' },
    aliases: ['sponsor_landing_date', 'sponsor_citizenship_date'],
    question:
      'On what date did your sponsor become a permanent resident (or a citizen, if not born Canadian)? Their UCI (client ID) too, if they know it.',
    // A citizen by birth has no date of becoming one.
    satisfiedBy: (p) =>
      /by birth|born/.test(
        textOf(p.sponsor_status ?? p.sponsor_canadian_status ?? p.sponsor_immigration_status).toLowerCase(),
      ),
  },
  {
    key: 'sponsor_residential_address',
    form: { label: 'Sponsor: home address', group: 'Sponsor' },
    aliases: ['sponsor_address', 'sponsor_home_address'],
    question:
      'What is your sponsor’s home address (street number and name, city, province, postal code)? Do they live in Canada now, and will they live in Quebec?',
    // A sponsor lives in Canada (a citizen abroad is the rare exception and
    // can answer "unknown" for the postal code).
    incomplete: canadianAddressIncomplete('sponsor_residential_address', ['sponsor_address', 'sponsor_home_address']),
  },
  {
    key: 'sponsor_phone',
    form: { label: 'Sponsor: phone', group: 'Sponsor' },
    aliases: ['sponsor_phone_number'],
    question: 'What is your sponsor’s phone number?',
  },
  {
    // Its own fact: asked together with the phone, the answer was stored as
    // one "phone; email" string (live E2E 2026-10-19).
    key: 'sponsor_email',
    form: { label: 'Sponsor: email', group: 'Sponsor' },
    aliases: ['sponsor_email_address'],
    question: 'What is your sponsor’s email address?',
  },
  {
    key: 'sponsor_employment_history',
    form: { label: 'Sponsor: jobs in the past 5 years', group: 'Sponsor' },
    aliases: ['sponsor_work_history'],
    question:
      'List your sponsor’s jobs for the past 5 years with no gaps: from and to (YYYY-MM), employer, job title, city. Any period without work: what they did and how they supported themselves.',
    shape: 'a list of {"from", "to", "employer", "job_title", "city"}',
  },
  {
    key: 'sponsor_address_history',
    form: { label: 'Sponsor: addresses in the past 5 years', group: 'Sponsor' },
    aliases: ['sponsor_previous_addresses'],
    question: 'List every address your sponsor has lived at in the past 5 years (from and to, street, city, country), with no gaps.',
    shape: 'a list of {"from", "to", "address"}',
  },
  DECLARATION(
    'sponsor_previous_relationship',
    'Has your sponsor been married or in a common-law relationship before you?',
    ['sponsor_previously_married'],
  ),
  {
    key: 'sponsor_previous_relationships',
    form: { label: 'Sponsor: previous marriages or common-law relationships', group: 'Sponsor' },
    aliases: ['sponsor_previous_marriages'],
    question:
      'For each of your sponsor’s earlier relationships: the person’s full name and date of birth, married or common-law, from and to, and how it ended.',
    shape: 'a list of {"name", "date_of_birth", "type", "from", "to", "how_ended"}',
    when: 'sponsor_previous_relationship',
  },
  DECLARATION(
    'sponsor_previous_undertakings',
    'Has your sponsor ever sponsored, or co-signed to sponsor, anyone else to come to Canada?',
    ['sponsor_sponsored_before'],
  ),
  declarationDetails(
    'sponsor_previous_undertakings',
    'Who did they sponsor (full name, date of birth), as sponsor or co-signer, and when?',
    ['sponsor_previous_undertaking_details'],
  ),
  {
    key: 'sponsor_eligibility_bars',
    form: { label: 'Sponsor eligibility (IMM 1344)', group: 'Sponsor' },
    question: `Please ask your sponsor to read this list: do any of these apply to them? ${SPONSOR_ELIGIBILITY_BARS.map((b, i) => `(${i + 1}) ${b.replace(/^sponsor /, '')}`).join('; ')}. Answer "none" or name each that applies.`,
    shape: '"none", or a list of the items that apply, in the sponsor’s own words',
    // A signed declaration: kept only from a reply to this question.
    // The whole list, not a question that named one bar: a "none" to that
    // would be stored for all of them.
    askedBy: /^(?=[\s\S]*social assistance)(?=[\s\S]*bankrupt)(?=[\s\S]*ordered to leave)(?=[\s\S]*support payments)/i,
  },

  // ── The principal applicant (IMM 0008, IMM 5669, IMM 5406)
  ...pickFacts(IRCC_EE_FACTS, [
    'family_name',
    'given_name',
    'date_of_birth',
    'city_of_birth',
    'nationality',
    'country_of_residence',
    'passport_number',
    'passport_expiry_date',
    'family_members_count',
    'highest_education_level',
    'preferred_provinces',
    'previous_canada_application',
  ]),
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'country_of_birth',
    'sex',
    'has_other_names',
    'other_names',
    'multiple_citizenship',
    'other_citizenships',
    'has_national_id',
    'national_id_number',
    'has_children',
    'children',
    'parents',
    'has_post_secondary_education',
    'education_history',
    'job_title',
    'employer_name',
    'work_history',
    'native_language',
    'official_language_ability',
    'preferred_contact_language',
    'residential_address',
    'mailing_same_as_residential',
    'mailing_address',
    'email',
    'phone_number',
  ]),
  {
    key: 'siblings',
    form: { label: 'Brothers and sisters', group: 'Family' },
    aliases: ['brothers_and_sisters'],
    question:
      'List your brothers and sisters (half and step included): full name, whether brother or sister, date of birth, country of birth, marital status and the city and country where they live. Say "none" if you have none.',
    shape:
      'a list of {"name", "relationship": "brother" | "sister" | "half-brother" | "half-sister" | "step-brother" | "step-sister", "date_of_birth" (YYYY-MM-DD), "country_of_birth", "marital_status", "address" ("City, Country")}, or "none"',
  },
  // IMM 5562 (your travels) asks the past 10 years; the visitor routes' trip
  // list covers 5, so it is not reused for it.
  DECLARATION(
    'has_travel_history_last_10_years',
    'In the past 10 years, have you travelled outside the country where you live (any trip, for any reason)?',
    ['travelled_last_10_years'],
  ),
  {
    key: 'travel_history_10_years',
    form: { label: 'Trips in the past 10 years', group: 'Background' },
    aliases: ['trips_10_years'],
    question:
      'For each trip in the past 10 years, most recent first: from and to (exact dates if you have them), the city and country, how long you stayed (for example "6 days") and the purpose.',
    shape:
      'a list of {"from" (YYYY-MM-DD or YYYY-MM), "to", "city", "country", "length", "purpose"}',
    when: 'has_travel_history_last_10_years',
  },
  {
    key: 'address_history',
    form: { label: 'Addresses in the past 10 years', group: 'Background' },
    aliases: ['previous_addresses', 'residential_history'],
    question:
      'List every address you have lived at for the past 10 years (or since age 18), with no gaps: from and to (YYYY-MM), street, city, province or state, postal code and country.',
    shape: 'a list of {"from", "to", "street", "city", "province", "postal_code", "country"}',
  },
  {
    key: 'organization_memberships',
    form: { label: 'Organizations (political, social, student, union, professional)', group: 'Background' },
    aliases: ['memberships'],
    question:
      'Have you been a member of, or supported, any political, social, youth, student, trade-union or professional organization? For each: name, type, your role, city and country, from and to. Say "none" if none.',
  },
  {
    key: 'government_positions',
    form: { label: 'Government positions held', group: 'Background' },
    aliases: ['government_service'],
    question:
      'Have you held any government position (civil servant, judge, police, security, elected office)? For each: country, department, position, from and to. Say "none" if none.',
  },
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'military_service',
    'military_service_history',
    'refused_or_ordered_to_leave',
    'refusal_details',
    'ever_charged',
    'ever_charged_details',
    'ever_convicted',
    'ever_convicted_details',
    'violent_organization_member',
    'violent_organization_member_details',
  ]),
  DECLARATION(
    'refugee_claim_made',
    'Have you ever made a claim for refugee protection, in Canada or anywhere else (including with the UNHCR)?',
    ['claimed_refugee_status'],
  ),
  declarationDetails(
    'refugee_claim_made',
    'Where and when did you make the claim, and what was the outcome?',
    ['refugee_claim_details'],
  ),
  DECLARATION(
    'ever_detained',
    'Have you ever been detained, put in jail or imprisoned?',
    ['been_detained', 'ever_imprisoned'],
  ),
  declarationDetails(
    'ever_detained',
    'When and where were you detained, for how long, and why?',
    ['detention_details'],
  ),
  DECLARATION(
    'war_crimes_involvement',
    'Have you ever been involved in an act of genocide, a war crime or a crime against humanity?',
    ['genocide_or_war_crimes'],
  ),
  DECLARATION(
    'advocated_violence',
    'Have you ever used, planned or advocated the use of armed struggle or violence to reach political, religious or social objectives?',
    ['armed_struggle'],
  ),
  // Not criminal_organization_member: that is an alias of
  // violent_organization_member, and IMM 5669 asks the two apart.
  DECLARATION(
    'criminal_pattern_organization_member',
    'Have you ever been a member of an organization that is or was engaged in an activity that is part of a pattern of criminal activity?',
    ['member_criminal_organization'],
  ),
  DECLARATION(
    'serious_medical_condition',
    'Have you ever had any serious disease or physical or mental disorder?',
    ['serious_disease'],
  ),
  declarationDetails(
    'serious_medical_condition',
    'What was the condition, and when?',
    ['serious_medical_condition_info'],
  ),
])

// ── Canada study permit (outside Canada) ─────────────────────────────────────
//
// Since 2025-03-25 a study permit from outside Canada is applied for in the
// IRCC secure account (GCKey), on IMM 1294 with IMM 5645 (family) — no longer
// on the IRCC Portal (tr-rt), whose /purpose page now hides "study permit"
// for any new application. Sources read 2026-10-20:
// https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/portal-application-process-study.html
// https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents.html
// https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents/provincial-attestation-letter.html
//
// Identity, family, education, work and the background declarations keep the
// keys the other IRCC routes use. The trip questions (purpose, travel dates,
// who invites them, money "for this trip") are not asked: IMM 1294 asks the
// study instead.

const studyProvinceOf = (p: Record<string, unknown>) =>
  textOf(p.study_province ?? p.province_of_study ?? p.school_province).toLowerCase()
const studiesInQuebec = (p: Record<string, unknown>) => /qu[eé]bec|\bqc\b/.test(studyProvinceOf(p))

/** A "YYYY-MM-DD" answer as a UTC date, or null (other shapes are ambiguous). */
function isoDay(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(textOf(v).trim())
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}

/** Age in whole years on the day studies start (or today), or null. */
function ageAtStudyStart(p: Record<string, unknown>): number | null {
  const dob = isoDay(p.date_of_birth ?? p.dob ?? p.birth_date)
  if (!dob) return null
  const on = isoDay(p.study_start_date ?? p.program_start_date) ?? new Date()
  let age = on.getUTCFullYear() - dob.getUTCFullYear()
  const m = on.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/**
 * A PAL/TAL was answered "yes" (a letter in hand), not an exception. "No" or
 * an exception ("master's at a public university", "CAQ") has no number.
 */
const hasAttestationLetter = (p: Record<string, unknown>) =>
  /^\s*(yes|true)\b/i.test(
    textOf(p.has_attestation_letter ?? p.has_pal ?? p.has_tal ?? p.pal_or_tal ?? p.provincial_attestation_letter_available),
  )

/**
 * A shared spec with extra aliases: the Forms generator's own keys for the
 * same question, so carryRouteFacts sees the field and adds no duplicate
 * (live E2E 2026-10-20: "refused_visa_or_ordered_to_leave" beside
 * "refused_or_ordered_to_leave"). A copy: other routes' specs are unchanged.
 */
const withAliases = (spec: IntakeFactSpec, extra: readonly string[]): IntakeFactSpec => ({
  ...spec,
  aliases: [...(spec.aliases ?? []), ...extra],
})

export const IRCC_STUDY_FACTS: readonly IntakeFactSpec[] = onForm([
  // ── The study (IMM 1294 "Details of intended study in Canada")
  {
    key: 'study_school_name',
    form: { label: 'Name of school (designated learning institution)', group: 'Study in Canada' },
    // Not school_name: that is an alias of employer_name (a current school).
    aliases: ['dli_name', 'institution_name', 'college_name', 'university_name'],
    question: 'Which school accepted you? Give its name exactly as on your letter of acceptance.',
  },
  {
    key: 'dli_number',
    form: { label: 'DLI number', group: 'Study in Canada' },
    aliases: ['designated_learning_institution_number', 'dli', 'institution_id'],
    question:
      'What is the school’s designated learning institution (DLI) number? It is on your letter of acceptance and starts with the letter O.',
    shape: 'the DLI number as printed, for example "O19395677252"',
  },
  {
    key: 'study_program',
    form: { label: 'Program name', group: 'Study in Canada' },
    aliases: ['program_name', 'program_of_study', 'course_name'],
    question: 'What is the name of your program, as on your letter of acceptance?',
  },
  {
    key: 'study_level',
    form: { label: 'Level of study', group: 'Study in Canada' },
    aliases: ['level_of_study', 'program_level'],
    question:
      'What level is the program: primary or secondary school, college certificate or diploma, post-graduate certificate or diploma, bachelor’s, master’s, doctorate, or language training (ESL/FSL)?',
  },
  {
    key: 'study_field',
    form: { label: 'Field of study', group: 'Study in Canada' },
    aliases: ['field_of_study', 'study_area'],
    question: 'What is the field of study (for example business, computer science, engineering, health)?',
  },
  {
    key: 'study_province',
    form: { label: 'Province or territory of the school', group: 'Study in Canada' },
    aliases: ['province_of_study', 'school_province'],
    question: 'In which province or territory is the school?',
  },
  {
    key: 'study_city',
    form: { label: 'City of the school', group: 'Study in Canada' },
    aliases: ['city_of_study', 'school_city'],
    question: 'In which city or town is the campus you will attend?',
  },
  {
    key: 'school_address',
    form: { label: 'Address of the school', group: 'Study in Canada' },
    aliases: ['campus_address', 'dli_address', 'study_school_address'],
    question: 'What is the street address of the campus, as on your letter of acceptance?',
  },
  {
    key: 'student_id_number',
    form: { label: 'Student ID number', group: 'Study in Canada' },
    aliases: ['student_number', 'student_id'],
    question: 'Did the school give you a student ID number? If yes, what is it; if not, say "none".',
  },
  {
    key: 'study_start_date',
    form: { label: 'Study start date', group: 'Study in Canada' },
    aliases: ['program_start_date', 'studies_start_date'],
    question: 'On what date does your program start (YYYY-MM-DD), as on your letter of acceptance?',
  },
  {
    key: 'study_end_date',
    form: { label: 'Study end date', group: 'Study in Canada' },
    aliases: ['program_end_date', 'studies_end_date', 'expected_completion_date'],
    question: 'On what date does your program end (YYYY-MM-DD)?',
  },
  {
    key: 'has_attestation_letter',
    form: { label: 'Provincial or territorial attestation letter (PAL/TAL)', group: 'Study in Canada' },
    aliases: ['has_pal', 'has_tal', 'pal_or_tal', 'provincial_attestation_letter_available'],
    question:
      'Do you have a provincial or territorial attestation letter (PAL or TAL) from your school’s province? Most students need one. If you do not, which exception applies to you (for example a master’s or doctoral degree at a public school, an exchange student, or a CAQ for Quebec)?',
    shape: '"yes", or "no" with the exception in the applicant’s words',
  },
  {
    key: 'attestation_letter_number',
    form: { label: 'PAL/TAL document number', group: 'Study in Canada' },
    aliases: ['pal_number', 'tal_number', 'pal_document_number', 'provincial_attestation_letter_number'],
    question: 'What is the document number on your attestation letter?',
    satisfiedBy: (p) => !hasAttestationLetter(p),
  },
  {
    key: 'attestation_letter_expiry_date',
    form: { label: 'PAL/TAL expiry date', group: 'Study in Canada' },
    aliases: ['pal_expiry_date', 'tal_expiry_date', 'provincial_attestation_letter_expiry_date'],
    question: 'When does your attestation letter expire (YYYY-MM-DD)?',
    satisfiedBy: (p) => !hasAttestationLetter(p),
  },
  {
    key: 'caq_number',
    form: { label: 'Quebec acceptance certificate (CAQ) number', group: 'Study in Canada' },
    aliases: ['caq', 'quebec_acceptance_certificate_number'],
    question:
      'You will study in Quebec, which needs a Quebec acceptance certificate (CAQ). What is its number and expiry date? If you have applied but not received it, say so.',
    satisfiedBy: (p) => !studiesInQuebec(p),
  },
  {
    key: 'tuition_cad',
    form: { label: 'Tuition (first year, CAD)', group: 'Study costs and funds' },
    aliases: ['tuition_fee_cad', 'tuition_fees', 'tuition', 'tuition_amount', 'tuition_cost_cad'],
    question: 'How much is your tuition for the first year, in Canadian dollars, as on your letter of acceptance?',
    shape: 'a whole number of Canadian dollars',
  },
  {
    key: 'tuition_paid_cad',
    form: { label: 'Tuition already paid (CAD)', group: 'Study costs and funds' },
    aliases: ['tuition_deposit_cad'],
    question: 'How much of that tuition have you already paid, in Canadian dollars? Say 0 if none yet.',
    shape: 'a whole number of Canadian dollars',
  },
  {
    key: 'room_and_board_cad',
    form: { label: 'Room and board (CAD per year)', group: 'Study costs and funds' },
    aliases: ['accommodation_cost_cad', 'living_costs_cad', 'room_and_board_cost_cad'],
    question: 'How much will you spend on housing and food for a year, in Canadian dollars?',
    shape: 'a whole number of Canadian dollars',
  },
  {
    key: 'study_funds_available_cad',
    form: { label: 'Funds available for your stay (CAD)', group: 'Study costs and funds' },
    // Not gic_amount_cad: a GIC is one part of the funds, not the total.
    aliases: ['funds_for_study_cad', 'funds_available_for_stay_cad'],
    question:
      'How much money will you have for your studies and living costs, in Canadian dollars (savings, a GIC, a scholarship, family support)? IRCC asks for at least one year of living costs on top of tuition and travel.',
    shape: 'a whole number of Canadian dollars',
  },
  {
    key: 'study_expenses_paid_by',
    form: { label: 'Who pays your expenses', group: 'Study costs and funds' },
    aliases: ['study_funded_by', 'sponsor_of_studies'],
    question: 'Who will pay your expenses: you, your parents, a scholarship or another person or organization? If someone else, who?',
  },
  {
    key: 'custodian',
    form: { label: 'Custodian in Canada (minor)', group: 'Study in Canada' },
    aliases: ['custodian_name', 'custodian_details'],
    question:
      'A student under 17 who travels without a parent needs a custodian in Canada. Who is your custodian (full name, address and phone in Canada), or will a parent come with you?',
    satisfiedBy: (p) => {
      const age = ageAtStudyStart(p)
      return age === null || age >= 17
    },
  },
  // The secure account's eligibility questionnaire (live 2026-10-20) asks
  // these before it builds the document checklist; the answers change the
  // checklist (an exchange student needs no PAL, a co-op needs a work permit).
  {
    key: 'exchange_student',
    form: { label: 'Exchange student', group: 'Study in Canada' },
    aliases: ['is_exchange_student'],
    question: 'Are you coming as an exchange student under an agreement between your school and the Canadian school?',
  },
  {
    key: 'work_essential_to_studies',
    form: { label: 'Work (co-op or internship) is an essential part of the program', group: 'Study in Canada' },
    aliases: ['co_op_program', 'has_coop', 'coop_work_placement'],
    question: 'Is work — a co-op placement or an internship — an essential, required part of your program?',
  },
  {
    key: 'government_scholarship',
    form: { label: 'Commonwealth scholarship, full Canadian aid bursary or Canadian aid program', group: 'Study costs and funds' },
    aliases: ['commonwealth_scholarship', 'cida_bursary'],
    question:
      'Do you hold a Commonwealth scholarship, a full bursary from Canada’s international development agency (including Francophonie scholarships), or are you part of a Canadian aid program for developing countries?',
  },
  {
    // The questionnaire asks two questions this one answers when it is "no"
    // (live 2026-10-20): "a spouse, common-law partner or child of certain
    // skilled worker or full-time international student that has or will
    // have status in Canada" and "accompanying a family member that has
    // status in Canada, or has recently been approved to come".
    key: 'family_member_status_in_canada',
    form: { label: 'Spouse, partner or parent with status in Canada (worker, student, resident) or recently approved', group: 'Family' },
    aliases: ['accompanying_family_member_with_status', 'family_member_worker_or_student_in_canada'],
    question:
      'Does your spouse, common-law partner or a parent have status in Canada — as a worker, a student, a permanent resident or a citizen — or have they recently been approved to come to Canada? If yes, who, and what status?',
  },
  {
    key: 'family_member_canadian_status',
    form: { label: 'Family member (18+) who is a Canadian citizen or permanent resident', group: 'Family' },
    aliases: ['family_member_canadian_citizen_or_pr', 'relative_in_canada'],
    question: 'Do you have a family member aged 18 or older who is a Canadian citizen or permanent resident?',
  },
  {
    key: 'designated_country_six_months',
    form: { label: 'Lived in or visited a medical-exam designated country for 6+ months in a row in the past year', group: 'Medical' },
    aliases: ['lived_in_designated_country'],
    question:
      'In the past year, did you live in or visit, for 6 months or more in a row, a country on IRCC’s list of countries that require a medical exam (for example Pakistan, India, Nigeria, the Philippines or China)? If unsure, name the countries.',
  },
  {
    key: 'previous_countries_of_residence',
    form: { label: 'Countries lived in for 6+ months in the past 5 years', group: 'Personal details' },
    aliases: ['previous_residence_countries'],
    question:
      'In the past 5 years, have you lived for more than 6 months in a country other than your citizenship country or where you live now? For each: country, your status there, from and to. Say "none" if none.',
    shape: 'a list of {"country", "status", "from", "to"}, or "none"',
  },

  // ── The applicant (IMM 1294 personal details, IMM 5645 family)
  ...pickFacts(IRCC_EE_FACTS, [
    'family_name',
    'given_name',
    'date_of_birth',
    'city_of_birth',
    'nationality',
    'country_of_residence',
    'passport_number',
    'passport_expiry_date',
    'previous_canada_application',
  ]),
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'country_of_birth',
    'sex',
    'has_other_names',
    'other_names',
    'multiple_citizenship',
    'other_citizenships',
    'has_national_id',
    'national_id_number',
    'marital_status',
    'marriage_date',
  ]),
  {
    // IMM 1294 asks the spouse's family and given names; no other IRCC route
    // asked them (the TRV fills them from its own Forms questions).
    key: 'spouse_name',
    form: { label: 'Spouse or common-law partner: family and given names', group: 'Family' },
    aliases: ['spouse_full_name', 'partner_name'],
    question: 'What is your spouse’s or common-law partner’s full name (family name and given names)?',
    satisfiedBy: noSpouse,
  },
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'spouse_date_of_birth',
    'spouse_country_of_birth',
    'spouse_occupation',
    'spouse_coming_to_canada',
    'has_children',
    'children',
    'children_accompanying',
    'parents',
    'has_post_secondary_education',
    'education_history',
    'job_title',
    'employer_name',
    'work_history',
    'native_language',
    'official_language_ability',
    'preferred_contact_language',
    'residential_address',
    'mailing_same_as_residential',
    'mailing_address',
    'email',
    'phone_number',
  ]),
  // Its own spec (IMM 5645 wording): the spousal one asks IMM 5406's details.
  {
    key: 'siblings',
    form: { label: 'Brothers and sisters', group: 'Family' },
    aliases: ['brothers_and_sisters'],
    question:
      'List your brothers and sisters (half and step included): full name, date of birth, country of birth, marital status and current address. Say "none" if you have none.',
    shape: 'a list of {"name", "date_of_birth", "country_of_birth", "marital_status", "address"}, or "none"',
  },
  ...pickFacts(IRCC_VISITOR_FACTS, [
    'us_permanent_resident',
    'us_green_card_number',
    'us_green_card_expiry_date',
    'uses_representative',
    'representative_name',
    'representative_paid',
    'representative_relationship',
    'representative_contact',
    'representative_address',
  ]),
  ...pickFacts(IRCC_PORTAL_FACTS, ['biometrics_given', 'medical_exam_last_12_months']),

  // ── Background (IMM 1294 questions 1-6), word for word from the TRV route
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'tuberculosis_contact',
    'immigration_violations',
    'immigration_violations_details',
  ]),
  withAliases(pickFacts(IRCC_PORTAL_FACTS, ['refused_or_ordered_to_leave'])[0], ['refused_visa_or_ordered_to_leave']),
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'refusal_details',
    // The secure account asks ONE question: "committed, been arrested for,
    // been charged with, or convicted of any criminal offence" (live
    // 2026-10-20). Its "No" needs a "no" to all four parts.
    'committed_crime',
    'committed_crime_details',
    'ever_arrested',
    'ever_arrested_details',
    'ever_charged',
    'ever_charged_details',
    'ever_convicted',
    'ever_convicted_details',
    'military_service',
    'military_service_history',
    'violent_organization_member',
    'violent_organization_member_details',
    'ill_treatment',
    'ill_treatment_details',
  ]),
  DECLARATION(
    'health_services_disorder',
    'Do you have any physical or mental disorder that would require social or health services, other than medication, during your stay in Canada?',
    ['physical_or_mental_disorder'],
    // A declaration: kept only from a reply to this question, never from a
    // medical-exam or TB answer.
    { askedBy: /social or health services/i },
  ),
  declarationDetails(
    'health_services_disorder',
    'What is the disorder, and what services would you need?',
    ['health_services_disorder_info'],
  ),
])

// ── Canada work permit, applied for from outside Canada (IMM 1295) ──────────
//
// Filed in the IRCC secure account: "Apply to come to Canada", the
// eligibility questionnaire, then IMM 1295 and the personalised checklist
// (read 2026-10-29):
// https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside/apply.html
// https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1295.html
//
// The intended work is asked under its own keys: job_title, employer_name and
// job_duties are the CURRENT job (IMM 1295 "Employment"), has_job_offer is
// Express Entry's. Identity, family, education, work history and the
// background declarations reuse the study permit's specs word for word. The
// trip questions and every study question are not asked. VisaAI never
// decides the permit type, an LMIA exemption or eligibility: it records what
// the applicant's documents say.

/**
 * The first non-empty answer among the keys, as text. A number counts: the
 * extractor stores the model's JSON as-is, so an LMIA number can arrive as
 * 1234567 (review 2026-10-29: textOf alone re-asked it on every turn).
 */
const workFactText = (p: Record<string, unknown>, keys: readonly string[]): string => {
  for (const k of keys) {
    const v = p[k]
    const t = typeof v === 'number' && Number.isFinite(v) ? String(v) : textOf(v)
    if (t) return t
  }
  return ''
}
/** "open_work_permit", "spousal-owp": underscores and hyphens read as spaces. */
const workPermitTypeOf = (p: Record<string, unknown>) =>
  workFactText(p, ['work_permit_type', 'work_permit_category', 'type_of_work_permit'])
    .toLowerCase()
    .replace(/[_-]+/g, ' ')

/** The work permit kinds the interview and the registry checklist branch on. */
export type WorkPermitKind = 'lmia' | 'lmia_exempt' | 'open'

/**
 * The applicant's work permit kind, read from their own answer
 * (`work_permit_type` or an alias). Undefined when the answer is missing or
 * names none of the three ("other", "start-up visa"), so a checklist rule on
 * it stays unknown ("may be required") rather than a guessed answer.
 *
 * - open: "open", "OWP", "spousal open work permit";
 * - lmia_exempt: "LMIA-exempt", "IMP", "international mobility", "offer of employment";
 * - lmia: "LMIA", "labour market", and the Seasonal Agricultural Worker
 *   Program, which is an LMIA stream.
 *
 * The interview (IRCC_WORK_FACTS) and the registry rule facts
 * (apps/api profile-to-rule-facts.ts) both read this, so they cannot disagree.
 * VisaAI never decides the kind: it records what the applicant's documents say.
 */
export function workPermitKindOf(p: Record<string, unknown> | null | undefined): WorkPermitKind | undefined {
  const t = workPermitTypeOf(p ?? {})
  if (/\bopen\b|\bowp\b/.test(t)) return 'open'
  if (/exempt|\bimp\b|international mobility|offer of employment/.test(t)) return 'lmia_exempt'
  if (/lmia|labour market|\bsawp\b|seasonal agricultur/.test(t)) return 'lmia'
  return undefined
}

/** The Seasonal Agricultural Worker Program, as the applicant named it. */
export function isSeasonalAgriculturalWorker(p: Record<string, unknown> | null | undefined): boolean {
  return /\bsawp\b|seasonal agricultur/.test(workPermitTypeOf(p ?? {}))
}

/**
 * Whether the work is in Quebec, from the province answer (`work_location_province`
 * or an alias). Undefined when no province was given.
 */
export function worksInQuebecOf(p: Record<string, unknown> | null | undefined): boolean | undefined {
  const t = workFactText(p ?? {}, ['work_location_province', 'province_of_work', 'work_province']).toLowerCase()
  if (!t) return undefined
  return /qu[eé]bec|\bqc\b/.test(t)
}

/**
 * Whose family member an open-work-permit applicant is (`principal_relationship`):
 * a worker's or a student's. Undefined when the answer names neither, or both.
 */
export function workPermitPrincipalOf(p: Record<string, unknown> | null | undefined): 'worker' | 'student' | undefined {
  const rel = principalRelationshipOf(p ?? {})
  const worker = /work|employ/.test(rel)
  const student = /student|stud(y|ies)/.test(rel)
  if (worker === student) return undefined
  return worker ? 'worker' : 'student'
}

/** An open work permit: no employer, job or LMIA questions (IMM 1295: leave 2-6 blank). */
const isOpenWorkPermit = (p: Record<string, unknown>) => workPermitKindOf(p) === 'open'
/** Employer-specific and LMIA-exempt: the offer of employment number (A + 7 digits). */
const isLmiaExempt = (p: Record<string, unknown>) => workPermitKindOf(p) === 'lmia_exempt'
/** Employer-specific with a positive LMIA: the 7-digit LMIA number. */
const isLmiaPermit = (p: Record<string, unknown>) => workPermitKindOf(p) === 'lmia'
const worksInQuebec = (p: Record<string, unknown>) => worksInQuebecOf(p) === true
/**
 * IMM 1295 leaves the number blank for some categories (a foreign mission's
 * employee needs neither): "none" or "not required" is an answer, not a gap.
 */
const NO_WORK_NUMBER = /^(none|n\/?a|not (required|needed|applicable)|no(t)? (lmia|offer)( number)?)$/i
const principalRelationshipOf = (p: Record<string, unknown>) =>
  textOf(p.principal_relationship ?? p.relationship_to_principal).toLowerCase()
const principalIsWorker = (p: Record<string, unknown>) => /work|employ/.test(principalRelationshipOf(p))
const principalIsStudent = (p: Record<string, unknown>) => /student|stud(y|ies)/.test(principalRelationshipOf(p))

export const IRCC_WORK_FACTS: readonly IntakeFactSpec[] = onForm([
  // ── The intended work (IMM 1295 "Details of intended work in Canada")
  {
    key: 'work_permit_type',
    form: { label: 'Type of work permit', group: 'Work in Canada' },
    aliases: ['work_permit_category', 'type_of_work_permit', 'work_permit_program'],
    question:
      'Which kind of work permit are you applying for, as your employer’s or IRCC’s documents describe it: employer-specific with an LMIA, employer-specific LMIA-exempt (your employer gave you an offer of employment number starting with A), an open work permit (for example as the spouse or partner of a worker or student in Canada), or another category? If unsure, say what documents you have.',
    shape: 'one of "lmia", "lmia_exempt", "open", "other", "sawp", "start_up", as the applicant’s documents say',
  },
  DECLARATION(
    'public_policy_or_special_measure',
    'Will you be coming to Canada under an active public policy or special measure announced by IRCC? If yes, which one?',
    ['public_policy', 'special_measure'],
    // The questionnaire's own question: kept only from a reply to it.
    { askedBy: /public policy or special measure/i },
  ),
  {
    key: 'work_employer_name',
    form: { label: 'Name of employer', group: 'Work in Canada' },
    aliases: ['canada_employer_name', 'lmia_employer_name', 'employer_name_in_canada', 'canadian_employer_name'],
    question: 'What is the name of the employer in Canada, exactly as on your LMIA or your offer of employment?',
    satisfiedBy: isOpenWorkPermit,
  },
  {
    key: 'work_employer_address',
    form: { label: 'Employer address', group: 'Work in Canada' },
    aliases: ['canada_employer_address', 'employer_address_in_canada', 'canadian_employer_address'],
    question: 'What is the employer’s full address in Canada (street, city, province)?',
    satisfiedBy: isOpenWorkPermit,
  },
  {
    key: 'work_location_province',
    form: { label: 'Province or territory of work', group: 'Work in Canada' },
    aliases: ['province_of_work', 'work_province'],
    question: 'In which province or territory will you work?',
    satisfiedBy: isOpenWorkPermit,
  },
  {
    key: 'work_location_address',
    form: { label: 'Address where you will work', group: 'Work in Canada' },
    aliases: ['work_address_in_canada'],
    question: 'What is the address where you will work (street, city, province)? Say "same" if it is the employer’s address.',
    satisfiedBy: isOpenWorkPermit,
  },
  {
    key: 'work_job_title',
    form: { label: 'Job title', group: 'Work in Canada' },
    aliases: ['intended_job_title', 'canada_job_title', 'job_title_in_canada'],
    question: 'What is your job title in Canada, as on your job offer?',
    satisfiedBy: isOpenWorkPermit,
  },
  {
    key: 'work_job_duties',
    form: { label: 'Brief description of duties', group: 'Work in Canada' },
    aliases: ['intended_job_duties', 'canada_job_duties', 'job_duties_in_canada'],
    question: 'Briefly, what will your duties be in that job?',
    satisfiedBy: isOpenWorkPermit,
  },
  {
    key: 'work_start_date',
    form: { label: 'Duration of expected employment: from', group: 'Work in Canada' },
    aliases: ['intended_work_start_date', 'employment_start_date_in_canada'],
    question:
      'On what date will your work start (YYYY-MM-DD), as on your LMIA or offer of employment? For an open work permit, the date you plan to start.',
  },
  {
    key: 'work_end_date',
    form: { label: 'Duration of expected employment: to', group: 'Work in Canada' },
    aliases: ['intended_work_end_date', 'employment_end_date_in_canada'],
    // The job's end date as on the LMIA or offer is the answer even when the
    // passport expires first: IRCC caps the permit itself. No gap here, or a
    // passport expiring first blocked the interview for good (review 2026-10-29).
    question:
      'On what date will your work end (YYYY-MM-DD), as on your LMIA or offer of employment? IRCC will not issue a permit past your passport’s expiry, so renew the passport first if it expires sooner.',
  },
  {
    key: 'lmia_number',
    form: { label: 'LMIA number', group: 'Work in Canada' },
    aliases: ['lmia_file_number'],
    question: 'What is the 7-digit LMIA number on your employer’s positive LMIA?',
    shape: 'the 7 digits as printed',
    satisfiedBy: (p) => !isLmiaPermit(p),
    incomplete: (p) =>
      /^\d{7}$/.test(workFactText(p, ['lmia_number', 'lmia_file_number']).replace(/[\s-]/g, '')) ||
      NO_WORK_NUMBER.test(workFactText(p, ['lmia_number', 'lmia_file_number']))
        ? undefined
        : 'the 7-digit LMIA number exactly as on the LMIA',
  },
  {
    key: 'offer_of_employment_number',
    form: { label: 'Offer of employment number', group: 'Work in Canada' },
    aliases: ['employment_offer_number', 'oe_number'],
    question:
      'What is the offer of employment number your employer gave you from IRCC’s Employer Portal? It starts with A followed by 7 digits.',
    shape: 'the number as printed, for example "A1234567"',
    satisfiedBy: (p) => !isLmiaExempt(p),
    incomplete: (p) =>
      /^A\d{7}$/i.test(workFactText(p, ['offer_of_employment_number', 'employment_offer_number', 'oe_number']).replace(/[\s-]/g, '')) ||
      NO_WORK_NUMBER.test(workFactText(p, ['offer_of_employment_number', 'employment_offer_number', 'oe_number']))
        ? undefined
        : 'the offer of employment number: the letter A followed by 7 digits',
  },
  // Two more questions on the questionnaire's work screen (recorded live
  // 2026-10-30). Answered only from the applicant's own reply.
  {
    key: 'work_permit_exempt_category',
    form: { label: 'Work in a category that needs no work permit', group: 'Work in Canada' },
    aliases: ['work_permit_exempt'],
    question:
      'Will your work in Canada be in a category that needs no work permit — for example an athlete or coach, a business visitor, clergy, a crew member, an emergency service provider, an examiner, an expert witness, a foreign government officer or representative, a health-care student, a judge or referee, military personnel, a news reporter or film crew, a performing artist or a public speaker? Most workers answer no.',
  },
  {
    key: 'recent_canadian_graduate',
    form: { label: 'Recent graduate of a Canadian post-secondary school (full-time, 8+ months)', group: 'Work in Canada' },
    aliases: ['recent_canadian_post_secondary_graduate'],
    question:
      'Have you recently graduated from a full-time program of at least eight months at a participating Canadian post-secondary school?',
  },
  {
    // The secure account's questionnaire asks it right after the job offer
    // (recorded live 2026-10-30): 7318 temporary < 1 year, 7319 temporary
    // >= 1 year, 7948 permanent. The work dates alone cannot answer it — a
    // permanent job can carry an LMIA end date — so it is asked.
    key: 'job_offer_status',
    form: { label: 'Job offer: permanent or temporary', group: 'Work in Canada' },
    aliases: ['job_offer_term'],
    question: 'Is your job offer permanent or temporary? Answer as your job offer or LMIA describes the position.',
    shape: '"permanent" or "temporary", in the applicant’s words',
    satisfiedBy: (p) => !isLmiaPermit(p) && !isLmiaExempt(p),
  },
  {
    key: 'work_caq_number',
    form: { label: 'Quebec acceptance certificate (CAQ) for work', group: 'Work in Canada' },
    // Not the study route's caq_number spec; an earlier answer under that key still counts.
    aliases: ['caq_number', 'work_caq'],
    question:
      'You will work in Quebec in a job that needs an LMIA, which also needs a Quebec acceptance certificate (CAQ). What is its number? If you have applied but not received it, say so.',
    satisfiedBy: (p) => !(worksInQuebec(p) && isLmiaPermit(p)),
  },
  {
    // A fact, not a declaration: it only decides whether a medical exam applies.
    key: 'public_health_occupation',
    form: { label: 'Job where public health must be protected', group: 'Medical' },
    aliases: ['public_health_job'],
    question:
      'Will your job in Canada be in health care, a clinical laboratory, child care, a school, in-home caregiving, domestic work, or agriculture?',
  },
  {
    key: 'work_funds_available_cad',
    form: { label: 'Funds to support yourself and family until your first pay (CAD)', group: 'Work in Canada' },
    aliases: ['funds_until_first_pay_cad', 'funds_available_for_stay'],
    question:
      'How much money will you have to support yourself and any family coming with you until your first pay, in Canadian dollars?',
    shape: 'a whole number of Canadian dollars',
  },

  // ── An open work permit as a family member (only when the permit is open)
  {
    key: 'principal_relationship',
    form: { label: 'You are the family member of', group: 'Open work permit' },
    aliases: ['relationship_to_principal'],
    question:
      'Whose family member are you applying as: the spouse or common-law partner of a worker, of a student, or a dependent child of a worker?',
    satisfiedBy: (p) => !isOpenWorkPermit(p),
  },
  {
    key: 'principal_name',
    form: { label: 'Family member’s name and UCI or permit number', group: 'Open work permit' },
    aliases: ['principal_full_name'],
    question: 'What is their full name, and their UCI or permit number if you have it?',
    satisfiedBy: (p) => !isOpenWorkPermit(p),
  },
  {
    key: 'principal_status_in_canada',
    form: { label: 'Family member’s permit in Canada and its expiry', group: 'Open work permit' },
    aliases: ['principal_permit', 'principal_permit_expiry_date'],
    question:
      'Does that person hold, or have approval for, a work permit or a study permit in Canada? Which one, and until what date?',
    satisfiedBy: (p) => !isOpenWorkPermit(p),
  },
  {
    key: 'principal_job_title_and_noc',
    form: { label: 'Family member’s job title and NOC (TEER)', group: 'Open work permit' },
    aliases: ['principal_noc', 'principal_job_title'],
    question: 'What is their job title and NOC code (or TEER), as on their employer’s letter or job offer?',
    satisfiedBy: (p) => !isOpenWorkPermit(p) || !principalIsWorker(p),
  },
  {
    key: 'principal_study_program',
    form: { label: 'Family member’s program, level and school', group: 'Open work permit' },
    aliases: ['principal_program'],
    question: 'What program and level are they studying, and at which school?',
    satisfiedBy: (p) => !isOpenWorkPermit(p) || !principalIsStudent(p),
  },

  // ── The applicant (IMM 1295 personal details, IMM 5645 family)
  ...pickFacts(IRCC_EE_FACTS, [
    'family_name',
    'given_name',
    'date_of_birth',
    'city_of_birth',
    'nationality',
    'country_of_residence',
    'passport_number',
    'passport_expiry_date',
    'previous_canada_application',
  ]),
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'country_of_birth',
    'sex',
    'has_other_names',
    'other_names',
    'multiple_citizenship',
    'other_citizenships',
    'has_national_id',
    'national_id_number',
    'marital_status',
    'marriage_date',
  ]),
  ...pickFacts(IRCC_STUDY_FACTS, ['spouse_name']),
  // IMM 1295 question 11: earlier marriages or common-law relationships.
  DECLARATION(
    'applicant_previous_relationship',
    'Have you ever been married or in a common-law relationship before (other than with your current spouse or partner)?',
    ['previously_married', 'has_previous_relationship'],
  ),
  ...pickFacts(IRCC_SPOUSAL_FACTS, ['previous_relationships']),
  ...pickFacts(IRCC_STUDY_FACTS, ['previous_countries_of_residence']),
  ...pickFacts(IRCC_PORTAL_FACTS, [
    'spouse_date_of_birth',
    'spouse_country_of_birth',
    'spouse_occupation',
    'spouse_coming_to_canada',
    'has_children',
    'children',
    'children_accompanying',
    'parents',
    'has_post_secondary_education',
    'education_history',
    'job_title',
    'employer_name',
    'work_history',
    'native_language',
    'official_language_ability',
    'preferred_contact_language',
    'residential_address',
    'mailing_same_as_residential',
    'mailing_address',
    'email',
    'phone_number',
  ]),
  ...pickFacts(IRCC_STUDY_FACTS, ['siblings']),
  {
    // IMM 1295 asks only whether a designated test was taken; Express
    // Entry's spec assumes one was.
    key: 'language_test_type',
    form: { label: 'Language test from a designated testing agency', group: 'Language' },
    aliases: ['english_test_type', 'language_test', 'french_test_type'],
    question:
      'Have you taken a language test from a designated testing agency (for example IELTS, CELPIP, PTE Core, TEF Canada or TCF Canada)? If yes, which one; if not, say no.',
  },
  ...pickFacts(IRCC_VISITOR_FACTS, [
    'us_permanent_resident',
    'us_green_card_number',
    'us_green_card_expiry_date',
    'uses_representative',
    'representative_name',
    'representative_paid',
    'representative_relationship',
    'representative_contact',
    'representative_address',
  ]),
  ...pickFacts(IRCC_PORTAL_FACTS, ['biometrics_given', 'medical_exam_last_12_months']),
  ...pickFacts(IRCC_STUDY_FACTS, [
    'designated_country_six_months',
    'family_member_status_in_canada',
    'family_member_canadian_status',
  ]),

  // ── Background (IMM 1295 questions 1-6): the study permit's block, word for word
  ...pickFacts(IRCC_STUDY_FACTS, [
    'tuberculosis_contact',
    'immigration_violations',
    'immigration_violations_details',
    'refused_or_ordered_to_leave',
    'refusal_details',
    'committed_crime',
    'committed_crime_details',
    'ever_arrested',
    'ever_arrested_details',
    'ever_charged',
    'ever_charged_details',
    'ever_convicted',
    'ever_convicted_details',
    'military_service',
    'military_service_history',
    'violent_organization_member',
    'violent_organization_member_details',
    'ill_treatment',
    'ill_treatment_details',
    'health_services_disorder',
    'health_services_disorder_details',
  ]),
])

interface RouteFacts {
  country: string
  /** Registry visa types this applies to. Empty = every route to `country`. */
  visaaiIds: readonly string[]
  facts: readonly IntakeFactSpec[]
  /**
   * Base facts this route does NOT ask. The eTA form has no departure date
   * or length of stay, so requiring one would hold its interview open on a
   * question the government never asks.
   */
  omitBase?: readonly string[]
  /**
   * Generated form fields this route's official form does not have. The
   * form generator writes a typical visitor form; on a permanent-residence
   * route it added an arrival date, a length of stay and settlement funds as
   * empty fields for the applicant to "fill" (live E2E 2026-10-19), and on a
   * work permit filled them from the work dates (2026-10-30). They are
   * dropped filled or not; a value a person typed (applicant/consultant) and
   * a key the route itself asks (its specs and aliases) always stay.
   */
  omitFormFields?: RegExp
  /**
   * Put the route's unanswered questions on the Forms page as empty fields.
   * Without it, an applicant who skipped the interview saw only what the
   * generator guessed: 9 relationship fields instead of 35, and none of the
   * sponsor eligibility or background declarations (live E2E 2026-10-19).
   * The tr-rt routes do this their own way (finalize-fields step 13).
   */
  askOnForm?: boolean
}

/**
 * A planned trip: an intended arrival or departure, a length of stay. Anchored
 * on intent, so a real PR question ("date of arrival in Canada" for an
 * applicant already here, a travel-history row's departure) is kept.
 */
const TRIP_FORM_FIELD =
  /^(intended|planned|expected)_.*(arrival|departure|entry|exit)|duration_of_stay|length_of_stay|stay_duration|stay_days|intended_stay/

// ── tr-rt wave 2a (coverage audit 2026-10-31, matrix A 68 and 83) ────────────

/** One earlier residence row lacks something IRCC's residence dialog asks. */
function earlierResidenceGap(p: Record<string, unknown>): string | undefined {
  const v = p.previous_countries_of_residence ?? p.previous_residence_countries
  if (!Array.isArray(v)) return undefined
  for (const r of v) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const missing = (['country', 'status', 'from', 'to'] as const).filter((k) => !present(o[k]))
    if (missing.length)
      return `${textOf(o.country) || 'a country'} is missing: ${missing.join(', ')}`
  }
  return undefined
}

/**
 * tr-rt's Medical_Required_Countries (bundle LOV 2026-10-31) as ISO alpha-2.
 * The IRCC fill keeps the exact IRCC codes (canada-ircc.ts); this copy only
 * decides whether intake asks work_in_public_health_job.
 */
export const TRRT_MEDICAL_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  'AF', 'AM', 'AO', 'AZ', 'BA', 'BD', 'BF', 'BI', 'BJ', 'BN', 'BO', 'BR', 'BT', 'BW', 'BY',
  'CD', 'CF', 'CG', 'CI', 'CM', 'CN', 'CV', 'DJ', 'DO', 'DZ', 'EC', 'ER', 'ET', 'FJ', 'FM',
  'GA', 'GE', 'GH', 'GL', 'GM', 'GN', 'GQ', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HT', 'ID',
  'IN', 'IQ', 'KE', 'KG', 'KH', 'KI', 'KM', 'KP', 'KR', 'KZ', 'LA', 'LK', 'LR', 'LS', 'LT',
  'LV', 'LY', 'MA', 'MD', 'MG', 'MH', 'ML', 'MM', 'MN', 'MO', 'MP', 'MR', 'MV', 'MW', 'MY',
  'MZ', 'NA', 'NE', 'NG', 'NI', 'NP', 'NR', 'PA', 'PE', 'PG', 'PH', 'PK', 'PW', 'PY', 'QA',
  'RO', 'RU', 'RW', 'SB', 'SD', 'SG', 'SL', 'SN', 'SO', 'SS', 'ST', 'SV', 'SZ', 'TD', 'TG',
  'TH', 'TJ', 'TL', 'TM', 'TN', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UZ', 'VN', 'VU', 'XK', 'YE',
  'ZA', 'ZM', 'ZW',
])

const DAY = 24 * 60 * 60 * 1000

/** A residence span that makes IRCC ask workMedicalJobs (to within the year, 180+ days, country off the list). */
function medicalJobSpan(country: unknown, from: unknown, to: unknown, now: number): boolean {
  const code = nationalityCode(country)
  if (!code || TRRT_MEDICAL_REQUIRED_COUNTRIES.has(code)) return false
  const t = Date.parse(`${textOf(to).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t) || t < now - 366 * DAY) return false
  const f = Date.parse(`${textOf(from).slice(0, 10)}T00:00:00Z`)
  // An unknown start: ask (the question costs one answer; a missed one is left blank).
  return Number.isNaN(f) || (t - f) / DAY >= 178
}

/**
 * Whether IRCC's medical page will ask workMedicalJobs: "No" to a recent
 * medical exam and a residence row of the kind above — the current one for a
 * visitor / worker / student status abroad (its end date is the To date), or
 * an earlier one.
 */
export function trrtAsksMedicalJobs(p: Record<string, unknown>): boolean {
  const exam = p.medical_exam_last_12_months ?? p.ircc_medical_exam_last_12_months ?? p.had_immigration_medical_exam
  if (intakeAnswerIsYes(exam) !== false) return false
  const now = Date.now()
  if (
    statusHasEndDate(p) &&
    medicalJobSpan(
      residenceCountryCode(p),
      p.residence_since ?? p.living_since,
      p.residence_status_valid_until ?? p.residence_status_expiry ?? p.residence_permit_expiry,
      now,
    )
  )
    return true
  const rows = p.previous_countries_of_residence ?? p.previous_residence_countries
  return (
    Array.isArray(rows) &&
    rows.some((r) => {
      if (!r || typeof r !== 'object') return false
      const o = r as Record<string, unknown>
      return medicalJobSpan(o.country, o.from ?? o.since ?? o.start, o.to ?? o.until ?? o.end, now)
    })
  )
}

/**
 * IRCC's residence table also takes the countries lived in during the past
 * 5 years. The past rows are never written (their end-date controls were not
 * recorded live); the answers go into the applicant's note.
 */
const TRRT_EARLIER_RESIDENCE_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'lived_elsewhere_last_5_years',
    aliases: ['lived_in_other_country_last_5_years'],
    form: { label: 'Lived in another country for 6+ months in the past 5 years', group: 'Personal details' },
    question:
      'In the past 5 years, have you lived for more than 6 months in any country other than the one you live in now?',
  },
  {
    key: 'previous_countries_of_residence',
    aliases: ['previous_residence_countries'],
    question:
      'For each country you lived in during the past 5 years: the country, your status there (citizen, permanent resident, worker, student, visitor or other), and the dates you lived there, from and to.',
    shape: 'a list of {"country", "status", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}',
    when: 'lived_elsewhere_last_5_years',
    incomplete: earlierResidenceGap,
  },
  // IRCC's medical page asks workMedicalJobs after "No" to a recent medical
  // exam when a residence row the fill writes ended less than a year ago,
  // lasted 180+ days and is outside tr-rt's Medical_Required_Countries
  // (bundle 2026-10-31; live: shown with residence rows written). The fill
  // writes only this explicit answer.
  {
    key: 'work_in_public_health_job',
    aliases: ['public_health_occupation', 'public_health_job'],
    form: { label: 'Intend to work in a job where public health must be protected', group: 'Medical' },
    question:
      'Do you intend to work in Canada in a job where public health must be protected — for example health care, a clinical laboratory, child care, a primary or secondary school, in-home caregiving or agriculture?',
    satisfiedBy: (p) => !trrtAsksMedicalJobs(p),
  },
]

/** A host in Canada is known (the visited family member or an inviter). */
function hasHostInCanada(p: Record<string, unknown>): boolean {
  if (intakeAnswerIsYes(p.family_in_destination) === true) return true
  const host = p.inviter ?? p.host ?? p.host_in_canada
  if (host && typeof host === 'object') return true
  return [p.inviter_name, p.host_name, p.host_full_name, p.inviter_full_name, p.family_member_name].some(present)
}

/**
 * A tourist with no host: IRCC's invitation page asks who they will visit or
 * where they will stay. The accommodation is asked so the note can name it.
 */
const TRV_NO_HOST_FACTS: readonly IntakeFactSpec[] = [
  {
    key: 'accommodation_provider_name',
    aliases: ['accommodation_name', 'hotel_name'],
    form: { label: 'Where you will stay in Canada (hotel or place name)', group: 'Travel' },
    question: 'Where will you stay in Canada — the name of the hotel or other place?',
    satisfiedBy: hasHostInCanada,
  },
  {
    key: 'accommodation_address',
    aliases: ['hotel_address'],
    form: { label: 'Address where you will stay in Canada', group: 'Travel' },
    question: 'What is the full address of the place where you will stay, with the postal code?',
    satisfiedBy: hasHostInCanada,
  },
]

/** The Green Card details tr-rt never asks (see us_green_card_number). */
const TRRT_NOT_ASKED = new Set(['us_green_card_number', 'us_green_card_expiry_date'])
/** IRCC_VISITOR_FACTS as the tr-rt routes ask them. */
const TRRT_VISITOR_FACTS: readonly IntakeFactSpec[] = IRCC_VISITOR_FACTS.filter(
  (s) => !TRRT_NOT_ASKED.has(s.key),
)

/**
 * Route configuration. Canada's visitor routes share the IMM 5257 temporary
 * resident application, so they share its questions. The business visitor
 * adds who invites them and what they will do; the super visa adds its
 * own eligibility questions straight after the visitor ones, before the long
 * tail of portal questions — they decide the application.
 */
export const ROUTE_FACTS: readonly RouteFacts[] = [
  {
    country: 'CA',
    visaaiIds: ['ca-visitor-visa-temporary-resident-visa'],
    facts: [...TRRT_VISITOR_FACTS, ...IRCC_PORTAL_FACTS, ...TRRT_EARLIER_RESIDENCE_FACTS, ...TRV_NO_HOST_FACTS],
  },
  {
    country: 'CA',
    visaaiIds: ['ca-business-visitors'],
    facts: [...TRRT_VISITOR_FACTS, ...BUSINESS_VISITOR_FACTS, ...IRCC_PORTAL_FACTS, ...TRRT_EARLIER_RESIDENCE_FACTS],
  },
  {
    country: 'CA',
    visaaiIds: ['ca-super-visa'],
    facts: [...TRRT_VISITOR_FACTS, ...SUPER_VISA_FACTS, ...IRCC_PORTAL_FACTS, ...TRRT_EARLIER_RESIDENCE_FACTS],
  },
  {
    country: 'CA',
    visaaiIds: [CA_ETA_VISAAI_ID],
    facts: IRCC_ETA_FACTS,
    omitBase: ['duration_of_stay_days'],
  },
  {
    // Permanent residence: there is no trip, so no purpose of visit and no
    // arrival or departure date (2026-10-19 it was asked both, as a visitor).
    country: 'CA',
    visaaiIds: [CA_EE_VISAAI_ID],
    facts: IRCC_EE_FACTS,
    omitBase: ['purpose_of_visit', 'duration_of_stay_days'],
    omitFormFields: TRIP_FORM_FIELD,
  },
  {
    // Permanent residence for a spouse, partner or dependent child: no trip.
    // Until 2026-10-19 the route had no entry and was asked a visitor's
    // purpose of trip and travel dates.
    country: 'CA',
    visaaiIds: [CA_SPOUSAL_VISAAI_ID],
    facts: IRCC_SPOUSAL_FACTS,
    omitBase: ['purpose_of_visit', 'duration_of_stay_days'],
    // No trip, and no settlement funds or applicant income: a sponsored
    // spouse is not asked them (the sponsor's income is, as sponsor_*).
    omitFormFields: new RegExp(
      `${TRIP_FORM_FIELD.source}|^(?!.*sponsor).*(settlement_funds|funds_available|available_funds|personal_funds)|^(applicant_)?(annual|monthly|employment)_income|^(applicant_)?bank_balance|^financial_(assets|liabilities)`,
    ),
    askOnForm: true,
  },
  {
    // A study permit from outside Canada (IMM 1294). Until 2026-10-20 the
    // route had no entry and was asked a visitor's purpose of trip and
    // travel dates; the study start and end dates replace them.
    country: 'CA',
    visaaiIds: [CA_STUDY_VISAAI_ID],
    facts: IRCC_STUDY_FACTS,
    omitBase: ['purpose_of_visit', 'duration_of_stay_days'],
    // No trip, and no money "for this trip": IMM 1294 asks tuition and funds
    // for the stay instead (study_funds_available_cad).
    omitFormFields: new RegExp(`${TRIP_FORM_FIELD.source}|^(trip_funds|available_funds|funds_available|funds_currency)`),
    askOnForm: true,
  },  {
    // A work permit from outside Canada (IMM 1295, IRCC secure account).
    // Until 2026-10-29 the route had no entry and was asked a visitor's
    // purpose of trip and travel dates; the work start and end dates
    // replace them.
    country: 'CA',
    visaaiIds: [CA_WORK_VISAAI_ID],
    facts: IRCC_WORK_FACTS,
    omitBase: ['purpose_of_visit', 'duration_of_stay_days'],
    // No trip and no money "for this trip". The funds to live on until the
    // first pay are asked as work_funds_available_cad. IMM 1295 has no purpose
    // of visit and no travel dates: the generator still wrote them, filled
    // with the work dates, beside the work questions (live E2E 2026-10-30).
    omitFormFields: new RegExp(
      `${TRIP_FORM_FIELD.source}|^(trip_funds|funds_currency|currency_of_funds)|^purpose_of_(visit|travel|trip)$|^intended_duration`,
    ),
    askOnForm: true,
  },
]

/** Is a generated form field one this route's official form does not have? */
export function routeOmitsFormField(ctx: IntakeRouteContext, key: string): boolean {
  const country = ctx.country?.trim().toUpperCase() ?? ''
  const visaaiId = ctx.visaaiId?.trim() ?? ''
  return ROUTE_FACTS.some(
    (r) =>
      r.country === country &&
      r.visaaiIds.includes(visaaiId) &&
      !!r.omitFormFields?.test(key),
  )
}

/**
 * The route's questions still unanswered, for the Forms page — only on a
 * route that puts them there (askOnForm), and only those the official form
 * asks (`form`). Conditional ones follow missingIntakeFacts: a "details"
 * question appears once its parent is answered yes.
 */
export function unansweredFormFacts(
  profile: Record<string, unknown> | null | undefined,
  ctx: IntakeRouteContext,
): IntakeFactSpec[] {
  const country = ctx.country?.trim().toUpperCase() ?? ''
  const visaaiId = ctx.visaaiId?.trim() ?? ''
  const asks = ROUTE_FACTS.some(
    (r) => r.country === country && r.visaaiIds.includes(visaaiId) && r.askOnForm,
  )
  if (!asks) return []
  return missingIntakeFacts(profile, ctx).filter((s) => !!s.form)
}

/**
 * The keys and labels of the questions a route puts on its Forms page
 * (askOnForm), for the form generator: told them, it writes the route's own
 * key instead of one of its own (employer_name for the Canadian employer
 * beside work_employer_name, live E2E 2026-10-30). Empty on other routes, so
 * the visitor routes' generated keys (and the fills that read them) do not
 * change.
 */
export function routeFormQuestionKeys(
  ctx: IntakeRouteContext,
): { key: string; label: string }[] {
  const country = ctx.country?.trim().toUpperCase() ?? ''
  const visaaiId = ctx.visaaiId?.trim() ?? ''
  const asks = ROUTE_FACTS.some(
    (r) => r.country === country && r.visaaiIds.includes(visaaiId) && r.askOnForm,
  )
  if (!asks) return []
  return intakeFactSpecs(ctx)
    .filter((s) => !!s.form)
    .map((s) => ({ key: s.key, label: s.form!.label }))
}

/** Every fact the route asks for, conditional ones included. */
export function intakeFactSpecs(ctx: IntakeRouteContext = {}): IntakeFactSpec[] {
  const country = ctx.country?.trim().toUpperCase() ?? ''
  const visaaiId = ctx.visaaiId?.trim() ?? ''
  const routes = ROUTE_FACTS.filter(
    (r) =>
      r.country === country &&
      (r.visaaiIds.length === 0 || r.visaaiIds.includes(visaaiId)),
  )
  const extra = routes.flatMap((r) => r.facts)
  const omit = new Set(routes.flatMap((r) => r.omitBase ?? []))

  const out: IntakeFactSpec[] = BASE_FACTS.filter((f) => !omit.has(f.key))
  for (const f of extra) {
    if (!out.some((o) => o.key === f.key)) out.push(f)
  }
  return out
}

function isSatisfied(profile: Record<string, unknown>, spec: IntakeFactSpec): boolean {
  if (present(readIntakeFact(profile, spec)) && !spec.incomplete?.(profile)) return true
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

/** What the recorded answer to `spec` still lacks, or undefined. */
export function intakeFactGap(
  profile: Record<string, unknown> | null | undefined,
  spec: IntakeFactSpec,
): string | undefined {
  const p = profile ?? {}
  if (!present(readIntakeFact(p, spec))) return undefined
  return spec.incomplete?.(p)
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
