import {
  answeredFormFacts,
  CA_SPOUSAL_VISAAI_ID,
  intakeAnswerIsYes,
  isBusinessVisitorRoute,
  intakeFactSpecs,
  routeFormQuestionKeys,
  routeOmitsFormField,
  unansweredFormFacts,
  superVisaInsuranceCheck,
  trrtAsksMedicalJobs,
  type PrefilledFormField,
} from '@visaai/types';
import {
  choosePolicy,
  policyDate,
  readPolicy,
  type InsurancePolicy,
} from '../../../shared/profile/insurance-policy';
import {
  comparableValue,
  isApplicantEmploymentKey,
  isOccupationKey,
  isRetiredProfile,
  otherPartyValueSet,
  type OtherPartyDocument,
} from './applicant-guards';
import { namesMatch } from './subject-attribution';
import { overlayTripEdits, TRIP_ROW_FIELD } from './trip-rows';
import { nameParts } from '../../../automation/portal-fills/ircc-profile';
import { FACT_KEY_SYNONYMS } from '../../../shared/profile/canonical-fact-keys';
import {
  GREEN_CARD_NOTE,
  inviterAnswers,
  secondInviterAnswers,
  sixteenOrUnder,
} from '../../../automation/portal-fills/canada-ircc';
import { businessPurposePhrase } from '../../../automation/portal-fills/canada-ircc-business-visitor';
import { composePurposeOfVisit } from '../../../shared/profile/purpose-description';
import {
  findByName,
  peopleInProfile,
  personName,
} from '../../../shared/profile/family-members';
import {
  DEPARTURE_KEY,
  DURATION_KEY,
  ENTRY_KEY,
  isoDayMs,
} from '../../../shared/stay-duration';

/**
 * Deterministic pass over the LLM's fields. The generator is told the rules;
 * this enforces the ones a wrong answer would put on a government form:
 *
 *  1. Applicant employment/income never carries a value from somebody else's
 *     document, and a retired applicant has no current job.
 *  2. Duration of stay is derived from the planned dates when both exist.
 *  3. Sex, passport type and national ID come from the identity documents.
 *  4. An empty travel history with a recorded "no travel" reads "None".
 *  5. Contact details from an account that is not the applicant's are flagged.
 *  6. Purpose of visit is a description with the trip's dates, not a phrase.
 *  7. Family members' details follow the person's NAME, not the row number.
 *  8. The route's own form questions (IMM 5257: US status, previous travel to
 *     Canada, representative) answered in intake are on the form.
 *  9. The family section carries what the profile holds from the birth and
 *     marriage certificates and the spouse's ID: every child with DOB,
 *     relationship and country of birth, the spouse's DOB, the marriage date
 *     — and a document consistency flag puts the marriage date up for review.
 * 10. The host's date of birth is the host's: from the intake, else the
 *     host's own document, and never the applicant's own date of birth.
 * 11. Insurance fields describe the policy that covers the stay, of however
 *     many were uploaded.
 * 12. Empty fields the profile answers under a known key are filled.
 * 13. On IRCC's visitor application (TRV, business visitor, super visa) the
 *     portal questions the interview would have asked are on the form even
 *     when unanswered, as empty fields for the applicant to fill.
 * 13b. On a route that asks on the form (spousal sponsorship) its unanswered
 *     interview questions are empty fields for the applicant to fill.
 * 14. Fields the route's form does not have (a trip on a permanent
 *     residence route) are dropped, filled or not, unless a person typed the
 *     value or the route itself asks that key.
 */
export interface FinalizeContext {
  applicantName: string | null;
  profile: Record<string, unknown>;
  /** Applicant documents only, merged. */
  documentFields: Record<string, unknown>;
  /** Applicant documents only, by document type. */
  documentFieldsByType: Record<string, Record<string, unknown>>;
  otherPartyDocuments: OtherPartyDocument[];
  accountProfile: Record<string, unknown>;
  /** Destination + registry visa type: selects the route's own form questions. */
  route?: { country?: string | null; visaaiId?: string | null };
  /** Each uploaded insurance policy's extracted fields, one entry per document. */
  insurancePolicies?: Array<Record<string, unknown>>;
}

const PAST_JOB = /^(applicant_)?(previous_|most_recent_|last_)/;

export function finalizeFields(
  input: PrefilledFormField[],
  ctx: FinalizeContext,
): PrefilledFormField[] {
  const fields = input.map((x) => ({ ...x }));
  guardEmployment(fields, ctx);
  deriveDuration(fields, ctx);
  fillIdentity(fields, ctx);
  fillTravelHistory(fields, ctx);
  flagForeignContact(fields, ctx);
  composePurpose(fields, ctx);
  reconcileFamilyMembers(fields, ctx);
  carryRouteFacts(fields, ctx);
  fillFamilySection(fields, ctx);
  fillHostDateOfBirth(fields, ctx);
  fillInsurance(fields, ctx);
  fillVisitDates(fields, ctx);
  fillFromProfile(fields, ctx);
  fillSpouseNameParts(fields, ctx);
  fillTripRows(fields, ctx);
  askRouteQuestions(fields, ctx);
  askIrccQuestions(fields, ctx);
  return dropFieldsNotOnRouteForm(fields, ctx);
}

// ── 12b. the couple's visits ─────────────────────────────────────────────────

const VISIT_DATE_FIELD =
  /^(?:relationship_)?visit_(\d+)_(start|end|from|to)(?:_date)?$/;

/**
 * Spousal sponsorship: the generator split the interview's visits into rows
 * but left every date empty — the answers are months ("2023-12") and its
 * rule is YYYY-MM-DD (live E2E 2026-10-20). The month is what the applicant
 * gave; it fills the row, it is never padded to an invented day.
 */
function fillVisitDates(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const visits = records(
    ctx.profile.visits ?? ctx.profile.visits_together ?? ctx.profile.in_person_visits,
  );
  if (visits.length === 0) return;
  for (const f of fields) {
    const m = VISIT_DATE_FIELD.exec(f.key);
    if (!m || f.value.trim()) continue;
    const visit = visits[Number(m[1]) - 1];
    if (!visit) continue;
    const start = m[2] === 'start' || m[2] === 'from';
    const v = profileText(start ? visit.from ?? visit.start : visit.to ?? visit.end);
    // A date only ("present" is no end date to type).
    if (!/^\d{4}-\d{2}/.test(v)) continue;
    f.value = v;
    f.source = 'profile';
  }
}

// ── 13b. the route's own unanswered questions ───────────────────────────────

/** A key as the generator may spell it: no `applicant_` prefix. */
const routeKey = (k: string) => k.replace(/^applicant_/, '');

/** Generator spellings the specs' aliases do not carry. */
const KEY_SYNONYMS: Record<string, string[]> = {
  phone_number: ['telephone_number', 'mobile_number', 'phone', 'contact_phone', 'telephone'],
  email: ['email_address', 'contact_email'],
  city_of_birth: ['place_of_birth', 'birth_place'],
};

export const ROUTE_UNANSWERED_NOTE =
  'IRCC asks this question. Please answer it here so it is ready when you complete the application.';

/**
 * A route that sets `askOnForm` (spousal sponsorship) gets each question its
 * interview asks and the profile has not answered, as an empty field — unless
 * the form already holds it under the key, an alias or the same label.
 */
function askRouteQuestions(fields: PrefilledFormField[], ctx: FinalizeContext) {
  if (!ctx.route) return;
  // An answer typed on the Forms page counts like the profile's: a "Yes"
  // there opens its details question (Forms saves never reach the profile).
  const answers: Record<string, unknown> = { ...ctx.profile };
  for (const f of fields) {
    if (f.value.trim() && answers[f.key] === undefined) answers[f.key] = f.value;
  }
  const onForm = new Set(fields.map((f) => routeKey(f.key)));
  for (const spec of unansweredFormFacts(answers, ctx.route)) {
    const keys = [spec.key, ...(spec.aliases ?? []), ...(KEY_SYNONYMS[spec.key] ?? [])];
    const label = spec.form!.label.trim().toLowerCase();
    if (
      keys.some((k) => onForm.has(routeKey(k))) ||
      fields.some((f) => (f.label ?? '').trim().toLowerCase() === label)
    )
      continue;
    fields.push({
      key: spec.key,
      label: spec.form!.label,
      value: '',
      group: spec.form!.group,
      source: 'inferred',
      note: ROUTE_UNANSWERED_NOTE,
    });
  }
}

// ── 14. fields the route's form does not have ───────────────────────────────

function dropFieldsNotOnRouteForm(
  fields: PrefilledFormField[],
  ctx: FinalizeContext,
): PrefilledFormField[] {
  if (!ctx.route) return fields;
  const route = ctx.route;
  // The generator fills a field the route's form lacks (a work permit's
  // "intended date of entry" from the work dates, live E2E 2026-10-30): it
  // goes too. A value a person typed stays, and so does any key the route
  // itself asks (a spec key or alias: study's funds_available_for_stay_cad
  // matches its own omit pattern, and step 13b already counted it).
  const asked = new Set(
    intakeFactSpecs(route).flatMap((s) => [s.key, ...(s.aliases ?? [])]),
  );
  // An EMPTY row for one of the route's own questions that does not apply
  // to this applicant (an LMIA job's offer number, an open permit's family
  // questions, a "details" row under a "No"): the generator adds them from
  // the key list it is given (#302); the interview would not ask them, so
  // the Forms page does not either (live E2E 2026-10-30). Only on a route
  // that asks on the form; a typed row always stays.
  const notApplicable = inapplicableRouteKeys(fields, ctx);
  return fields.filter(
    (f) =>
      !(
        notApplicable.has(f.key) &&
        f.value.trim() === '' &&
        f.source !== 'applicant' &&
        f.source !== 'consultant'
      ) &&
      (asked.has(f.key) ||
        !routeOmitsFormField(route, f.key) ||
        (f.value.trim() !== '' &&
          (f.source === 'applicant' || f.source === 'consultant'))),
  );
}

/** Route question keys (and aliases) the route would not ask this applicant. */
function inapplicableRouteKeys(
  fields: PrefilledFormField[],
  ctx: FinalizeContext,
): Set<string> {
  const out = new Set<string>();
  if (!ctx.route || routeFormQuestionKeys(ctx.route).length === 0) return out;
  // The same answers step 13b reads: the profile plus values on the form.
  const answers: Record<string, unknown> = { ...ctx.profile };
  for (const f of fields) {
    if (f.value.trim() && answers[f.key] === undefined) answers[f.key] = f.value;
  }
  const stillAsked = new Set(
    unansweredFormFacts(answers, ctx.route).flatMap((s) => [s.key, ...(s.aliases ?? [])]),
  );
  for (const spec of intakeFactSpecs(ctx.route)) {
    if (!spec.form) continue;
    for (const k of [spec.key, ...(spec.aliases ?? [])])
      if (!stillAsked.has(k)) out.add(k);
  }
  return out;
}

// ── 1. employment ────────────────────────────────────────────────────────────

function guardEmployment(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const foreign = otherPartyValueSet(ctx.otherPartyDocuments);
  const own = new Set<string>();
  for (const v of Object.values(ctx.profile)) own.add(comparableValue(v));
  for (const v of Object.values(ctx.documentFields))
    own.add(comparableValue(v));
  own.delete('');
  const retired = isRetiredProfile(ctx.profile);

  for (const field of fields) {
    if (!isApplicantEmploymentKey(field.key)) continue;
    const c = comparableValue(field.value);

    if (retired && isOccupationKey(field.key)) {
      if (field.value !== 'Retired') {
        field.value = 'Retired';
        field.source = 'profile';
      }
      continue;
    }

    if (c && foreign.has(c) && !own.has(c)) {
      field.value = '';
      field.needsReview = true;
      field.note =
        "Removed: this value came from a sponsor's or host's document, not the applicant's.";
      continue;
    }

    if (retired && !PAST_JOB.test(field.key) && field.value) {
      field.value = '';
      field.needsReview = true;
      field.note = /income|salary/.test(field.key)
        ? 'Applicant is retired — enter pension or other personal income, if any.'
        : 'Applicant is retired — no current employment.';
    }
  }
}

// ── 2. duration ──────────────────────────────────────────────────────────────

function findDate(
  fields: PrefilledFormField[],
  profile: Record<string, unknown>,
  re: RegExp,
): { t: number; raw: string } | null {
  for (const f of fields) {
    const t = re.test(f.key) ? isoDayMs(f.value) : null;
    if (t !== null) return { t, raw: f.value.trim().slice(0, 10) };
  }
  for (const [k, v] of Object.entries(profile)) {
    const t = re.test(k) ? isoDayMs(v) : null;
    if (t !== null) return { t, raw: String(v).trim().slice(0, 10) };
  }
  return null;
}

// Same inclusive convention as the letters (shared/stay-duration.ts).
function deriveDuration(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const entry = findDate(fields, ctx.profile, ENTRY_KEY);
  const exit = findDate(fields, ctx.profile, DEPARTURE_KEY);
  if (!entry || !exit || exit.t < entry.t) return;
  const nights = Math.round((exit.t - entry.t) / 86_400_000);
  const days = nights + 1;

  if (!fields.some((f) => DURATION_KEY.test(f.key))) {
    fields.push({
      key: 'duration_of_stay_days',
      label: 'Duration of stay (days)',
      value: String(days),
      group: 'Travel',
      source: 'inferred',
      note: `Derived from planned dates ${entry.raw} → ${exit.raw} (${days} days, ${nights} nights).`,
    });
    return;
  }

  for (const field of fields) {
    if (!DURATION_KEY.test(field.key)) continue;
    const stated = field.value.trim();
    if (stated === String(days)) continue;
    field.value = String(days);
    field.source = 'inferred';
    field.needsReview = true;
    field.note =
      `Derived from planned dates ${entry.raw} → ${exit.raw} (${days} days, ${nights} nights)` +
      (stated ? `; the profile said ${stated}.` : '.');
  }
}

// ── 3. identity ──────────────────────────────────────────────────────────────

function allApplicantDocs(
  ctx: FinalizeContext,
): Array<[string, Record<string, unknown>]> {
  return [
    ...Object.entries(ctx.documentFieldsByType),
    ['*', ctx.documentFields],
  ];
}

function mrzOf(fields: Record<string, unknown>): string[] | null {
  for (const [k, v] of Object.entries(fields)) {
    if (!/mrz|machine_readable/i.test(k) || typeof v !== 'string') continue;
    const lines = v
      .split(/[\r\n]+/)
      .map((l) => l.replace(/\s/g, '').toUpperCase())
      .filter((l) => l.length >= 30);
    if (lines.length >= 2) return lines;
  }
  return null;
}

function normalizeSex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (s === 'M' || s === 'MALE') return 'Male';
  if (s === 'F' || s === 'FEMALE') return 'Female';
  if (s === 'X' || s === '<') return s === 'X' ? 'Another gender (X)' : null;
  return null;
}

function normalizePassportType(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (s === 'P' || s === 'PP' || s === 'P<' || /^(ORDINARY|REGULAR)/.test(s))
    return 'Regular';
  if (s === 'PD' || /^DIPLOMATIC/.test(s)) return 'Diplomatic';
  if (s === 'PO' || /^OFFICIAL/.test(s)) return 'Official';
  if (s === 'PS' || /^SERVICE/.test(s)) return 'Service';
  return null;
}

function findSex(ctx: FinalizeContext): string | null {
  for (const [, doc] of allApplicantDocs(ctx)) {
    for (const k of ['sex', 'gender', 'Sex', 'Gender']) {
      const s = normalizeSex(doc[k]);
      if (s) return s;
    }
    const mrz = mrzOf(doc);
    if (mrz) {
      const s = normalizeSex(mrz[1].charAt(20));
      if (s) return s;
    }
  }
  return null;
}

function findPassportType(ctx: FinalizeContext): string | null {
  for (const [, doc] of allApplicantDocs(ctx)) {
    for (const k of [
      'passport_type',
      'passport_type_code',
      'document_type_code',
      'type_code',
      'DocumentCode',
      'document_code',
    ]) {
      const t = normalizePassportType(doc[k]);
      if (t) return t;
    }
    const mrz = mrzOf(doc);
    if (mrz) {
      const code = mrz[0].slice(0, 2).replace(/</g, '');
      const t = normalizePassportType(code || 'P');
      if (t) return t;
    }
  }
  return null;
}

const NATIONAL_ID_KEYS =
  /^(national_id(entity)?(_number|_no)?|identity_(card_)?number|id_number|cnic(_number)?|nic(_number)?|nin|personal_number|DocumentNumber|document_number)$/;
const ID_DOC_TYPE = /national_id|identity_card|id_card|cnic|nic\b|^document$/;
const CNIC = /\b\d{5}[-\s]?\d{7}[-\s]?\d\b/;

const NATIONALITY_KEYS = [
  'nationality',
  'citizenship',
  'country_of_citizenship',
  'applicant_citizenship',
  'applicant_nationality',
];

/** Pakistan as a nationality value: the country, its ISO code or the demonym. */
const PAKISTAN = /^(pak|pk|pakistan|pakistani|islamic republic of pakistan)$/i;

/**
 * Whether the applicant is a Pakistani national: their own answer, the
 * account's nationality, or what their passport / ID says (typed field or
 * MRZ). A CNIC is a Pakistani document; nobody else holds one.
 */
function applicantIsPakistani(ctx: FinalizeContext): boolean {
  const said = (v: unknown) => typeof v === 'string' && PAKISTAN.test(v.trim());
  for (const k of NATIONALITY_KEYS) {
    if (said(ctx.profile[k]) || said(ctx.accountProfile[k])) return true;
  }
  for (const [, doc] of allApplicantDocs(ctx)) {
    if (NATIONALITY_KEYS.some((k) => said(doc[k]))) return true;
    const mrz = mrzOf(doc);
    if (!mrz) continue;
    // Nationality on line 2: TD3 (passport, 44 chars) at 10-12, TD1 (ID
    // card, 30 chars) at 15-17.
    const code =
      mrz[1].length >= 44 ? mrz[1].slice(10, 13) : mrz[1].slice(15, 18);
    if (code.replace(/</g, '') === 'PAK') return true;
  }
  return false;
}

function findNationalId(ctx: FinalizeContext): string | null {
  for (const k of [
    'national_id_number',
    'national_id',
    'cnic',
    'cnic_number',
  ]) {
    const v = ctx.profile[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // Only an identity document's identity-number field is the national ID.
  // The CNIC shape used to be matched against EVERY field of every document:
  // an Indian bank statement's account_number 5010012345678 became the
  // "national ID" 50100-1234567-8, and IRCC was told the applicant holds one
  // (audit 2026-10-18). A passport's bare DocumentNumber is the passport
  // number, so it never qualifies either.
  const pakistani = applicantIsPakistani(ctx);
  for (const [type, doc] of Object.entries(ctx.documentFieldsByType)) {
    if (!ID_DOC_TYPE.test(type)) continue;
    for (const [k, v] of Object.entries(doc)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      if (!NATIONAL_ID_KEYS.test(k)) continue;
      const s = String(v).trim();
      // A Pakistani's CNIC inside a longer OCR string ("CNIC 12345-…"):
      // the number exactly as printed — no separators invented.
      if (pakistani) {
        const m = CNIC.exec(s);
        if (m) return m[0];
      }
      // Other countries' numbers carry their own punctuation (Brazil CPF
      // 123.456.789-09, Hong Kong A1234567(8)): count digits, not runs.
      if (s.replace(/\D/g, '').length >= 5) return s;
    }
  }
  return null;
}

const SEX_KEY = /^(applicant_)?(sex|gender)$/;
const PASSPORT_TYPE_KEY = /^passport_(type|document_type)$/;
const NATIONAL_ID_FIELD =
  /^(national_id(entity)?(_card|_document)?(_number)?|national_identity_(card_|document_)?number|identity_document_number|cnic(_number)?)$/;

function fillOne(
  fields: PrefilledFormField[],
  keyRe: RegExp,
  value: string | null,
  fallback: { key: string; label: string; group: string },
) {
  if (!value) return;
  const existing = fields.filter((f) => keyRe.test(f.key));
  if (existing.length === 0) {
    fields.push({ ...fallback, value, source: 'document' });
    return;
  }
  for (const f of existing) {
    if (f.value.trim()) continue;
    f.value = value;
    f.source = 'document';
  }
}

function fillIdentity(fields: PrefilledFormField[], ctx: FinalizeContext) {
  fillOne(fields, SEX_KEY, findSex(ctx), {
    key: 'sex',
    label: 'Sex',
    group: 'Personal',
  });
  fillOne(fields, PASSPORT_TYPE_KEY, findPassportType(ctx), {
    key: 'passport_type',
    label: 'Passport type',
    group: 'Passport',
  });
  fillOne(fields, NATIONAL_ID_FIELD, findNationalId(ctx), {
    key: 'national_id_number',
    label: 'National identity document number',
    group: 'Identity documents',
  });
}

// ── 4. travel history ────────────────────────────────────────────────────────

const TRAVEL_HISTORY_KEY =
  /^(travel_history(_countries)?|countries_visited(_[a-z0-9_]+)?|previous_travel(_countries)?|past_travel(_countries)?)$/;

function fillTravelHistory(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const recorded =
    ctx.profile.travel_history_countries ?? ctx.profile.travel_history;
  const noTravel =
    (Array.isArray(recorded) && recorded.length === 0) ||
    ctx.profile.has_travel_history === false ||
    ctx.profile.no_travel_history === true ||
    intakeAnswerIsYes(ctx.profile.travelled_last_5_years) === false;
  if (!noTravel) return;
  for (const f of fields) {
    if (TRAVEL_HISTORY_KEY.test(f.key) && !f.value.trim()) {
      f.value = 'None';
      f.source = 'profile';
    }
  }
}

// ── 4b. one Forms-page row per recorded trip ─────────────────────────────────

const TRIP_ROW_PARTS: Array<[string, string, string[]]> = [
  ['country', 'country', ['country', 'destination', 'country_visited']],
  ['city', 'city', ['city', 'location', 'place', 'cities']],
  ['from', 'start date', ['from', 'from_date', 'start_date', 'departure_date', 'start']],
  ['to', 'end date', ['to', 'to_date', 'end_date', 'return_date', 'end']],
  ['purpose', 'purpose', ['purpose', 'reason', 'purpose_of_travel']],
];
/** A place the interview recorded as not known is no place. */
const NO_PLACE = /^(unknown|n\/?a|none|not sure|-)$/i;

function tripPart(trip: Record<string, unknown>, keys: string[], part: string) {
  for (const k of keys) {
    const v = trip[k];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    let t = String(v).trim();
    if (!t) continue;
    if (part === 'city' && NO_PLACE.test(t)) return '';
    if ((part === 'from' || part === 'to') && /^\d{4}-\d{2}/.test(t))
      t = t.slice(0, 7);
    return t;
  }
  return '';
}

/**
 * Prod 2026-10-29 (Canada visitor visa): the interview recorded nine trips in
 * `travel_history`, the form generator transcribed only the last two, and the
 * Forms page showed two — the applicant and consultant review a travel
 * history missing seven trips. The rows are the recorded list, one per trip,
 * laid out here rather than left to the model. A person's edit stays on its
 * own trip (trip-rows.ts), whatever row number that trip now has.
 */
function fillTripRows(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const recorded = ctx.profile.travel_history ?? ctx.profile.travel_history_countries;
  const trips = records(recorded);
  if (trips.length === 0) return;
  const rows = fields.filter((f) => TRIP_ROW_FIELD.test(f.key));
  const onRoute = IRCC_TR_RT_ROUTES.has(ctx.route?.visaaiId?.trim() ?? '');
  if (rows.length === 0 && !onRoute) return;
  const at = rows.length ? fields.indexOf(rows[0]) : fields.length;
  const group = rows[0]?.group ?? 'Travel';
  const built: PrefilledFormField[] = [];
  trips.forEach((trip, i) => {
    for (const [part, label, keys] of TRIP_ROW_PARTS) {
      const value = tripPart(trip, keys, part);
      const f: PrefilledFormField = {
        key: `travel_history_${i + 1}_${part}`,
        label: `Travel history ${i + 1} ${label}`,
        value,
        group,
        ...(value ? { source: 'profile' as const } : {}),
      };
      // Not flagged when empty: the IRCC fill reads the recorded trips, not
      // these rows (a country-only trip is placed in its country there).
      built.push(f);
    }
  });
  const kept = fields.filter((f) => !TRIP_ROW_FIELD.test(f.key));
  kept.splice(Math.min(at, kept.length), 0, ...built);
  // A person's edits follow their trip onto the rebuilt rows.
  fields.splice(0, fields.length, ...overlayTripEdits(kept, rows));
}

// ── 5. contact ownership ─────────────────────────────────────────────────────

function flagForeignContact(
  fields: PrefilledFormField[],
  ctx: FinalizeContext,
) {
  const owner = ctx.accountProfile.full_name;
  if (typeof owner !== 'string' || !owner.trim() || !ctx.applicantName) return;
  if (namesMatch(ctx.applicantName, owner)) return;

  const pairs: Array<[RegExp, unknown, string, string[]]> = [
    [
      /email/,
      ctx.accountProfile.email,
      'email address',
      ['email', 'email_address', 'applicant_email', 'contact_email'],
    ],
    [
      /phone|telephone|mobile/,
      ctx.accountProfile.phone,
      'phone number',
      ['phone', 'phone_number', 'telephone_number', 'mobile_number'],
    ],
  ];
  // Spousal sponsorship: the sponsor usually IS the account holder, so their
  // own contact details matching the account are expected, not a mix-up.
  const sponsorIsHolderExpected =
    ctx.route?.visaaiId?.trim() === CA_SPOUSAL_VISAAI_ID;
  for (const f of fields) {
    if (sponsorIsHolderExpected && f.key.startsWith('sponsor_')) continue;
    for (const [re, accountValue, what, ownKeys] of pairs) {
      if (!re.test(f.key) || !f.value.trim()) continue;
      if (comparableValue(f.value) !== comparableValue(accountValue)) continue;
      // The applicant gave their own in the interview: use it. Live E2E
      // 2026-10-18: the draft took the account holder's email although the
      // profile held the applicant's.
      // Only the applicant's own contact field is rewritten. Anyone else's
      // (representative, host, family member…) may well BE the account
      // holder, so it keeps the flag below for a human to decide.
      const own = (ownKeys.includes(f.key) ? ownKeys : [])
        .map((k) => ctx.profile[k])
        .find(
          (v): v is string =>
            typeof v === 'string' &&
            !!v.trim() &&
            comparableValue(v) !== comparableValue(accountValue),
        );
      if (own) {
        f.value = own.trim();
        f.source = 'profile';
        continue;
      }
      f.needsReview = true;
      f.note = `This is the account holder's (${owner.trim()}) ${what}, not the applicant's — confirm it is where the applicant should be contacted.`;
    }
  }
}

// ── 6. purpose of visit ─────────────────────────────────────────────────────

const PURPOSE_FIELD =
  /^(purpose_of_(visit|travel|trip)|purpose|visit_purpose|trip_purpose|reason_for_visit)$/;

/**
 * IRCC's purpose box expects a description with the dates (dry run
 * 2026-10-14, #51): the generator copied the intake's "Family visit". The
 * dates on the form win over the profile's — they are the reviewed copy.
 */
function composePurpose(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const stayFacts: Record<string, unknown> = { ...ctx.profile };
  const entry = findDate(fields, {}, ENTRY_KEY);
  const exit = findDate(fields, {}, DEPARTURE_KEY);
  if (entry) stayFacts.planned_entry_date = entry.raw;
  if (exit) stayFacts.planned_departure_date = exit.raw;

  // On the business route a thin purpose ("Business", or the generator's
  // "Other") is written as the portal writes it: the company and the
  // activity (live E2E 2026-10-18 read "Other … visiting John Test").
  const business = isBusinessVisitorRoute(ctx.route?.visaaiId)
    ? businessPurposePhrase(ctx.profile)
    : undefined;

  for (const field of fields) {
    if (!PURPOSE_FIELD.test(field.key) || !field.value.trim()) continue;
    const thin = field.value.trim().split(/\s+/).length <= 3;
    const composed = composePurposeOfVisit(
      stayFacts,
      business && thin ? business : field.value,
    );
    if (!composed || composed === field.value.trim()) continue;
    field.value = composed;
    field.source = 'inferred';
    field.needsReview = true;
    field.note =
      'Written out with the planned dates and the length of stay they give — check the wording before it is submitted.';
  }
}

// ── 7. family members ───────────────────────────────────────────────────────

const PERSON_FIELD =
  // `dependent_child_1_*` is how the generator names Express Entry's
  // dependants (prod 2026-10-19); without it a second child row was added.
  /^((?:eldest_|youngest_|other_)?(?:(?:dependent|dependant)_)?(?:son|daughter|child|sibling|brother|sister|family_member|dependant|dependent|relative))_(\d+)_(.+)$/;
const NAME_ATTR = /^(name|full_name|given_name|first_name)$/;

/**
 * The generator numbers people (`child_1_*`, `child_2_*`) in whatever order it
 * likes and has swapped two sons' occupations (#35). Each numbered group is
 * tied to a profile person by NAME, and any attribute the profile records for
 * that person overrides what the generator put in the group.
 */
function reconcileFamilyMembers(
  fields: PrefilledFormField[],
  ctx: FinalizeContext,
) {
  const people = peopleInProfile(ctx.profile);
  if (people.length === 0) return;

  const groups = new Map<string, Map<string, PrefilledFormField>>();
  for (const field of fields) {
    const m = PERSON_FIELD.exec(field.key);
    if (!m) continue;
    const id = `${m[1]}_${m[2]}`;
    const attrs = groups.get(id) ?? new Map<string, PrefilledFormField>();
    attrs.set(m[3], field);
    groups.set(id, attrs);
  }

  for (const attrs of groups.values()) {
    const nameField = [...attrs.entries()].find(([a]) =>
      NAME_ATTR.test(a),
    )?.[1];
    if (!nameField?.value.trim()) continue;
    const person = findByName(people, nameField.value);
    if (!person) continue;
    for (const [attr, field] of attrs) {
      if (NAME_ATTR.test(attr)) continue;
      const truth = person[attr];
      if (typeof truth !== 'string' && typeof truth !== 'number') continue;
      const want = String(truth).trim();
      if (!want || comparableValue(want) === comparableValue(field.value))
        continue;
      field.value = want;
      field.source = 'profile';
      field.needsReview = true;
      field.note = `Matched to ${nameField.value.trim()} by name from the intake answers.`;
    }
  }
}

// ── 9. family section from documents ────────────────────────────────────────

const SPOUSE_DOB_FIELD =
  /^(spouse|partner|husband|wife)_(date_of_birth|dob|birth_date)$/;
const SPOUSE_COB_FIELD = /^(spouse|partner|husband|wife)_country_of_birth$/;
const MARRIAGE_DATE_FIELD =
  /^(marriage_date|date_of_marriage|date_of_current_marriage|current_marriage_date|marriage_date_of_current_spouse)$/;

/** Attributes IRCC's family pages ask per child, with the profile keys that hold them. */
/** What intake stores when no name was given. */
const PLACEHOLDER_NAME = /^(?:|unknown|n\/?a|none|not (?:provided|given|known)|tbd|-+)$/i;

const CHILD_FORM_ATTRS: Array<[string, string, string[]]> = [
  ['date_of_birth', 'date of birth', ['date_of_birth', 'dob', 'birth_date']],
  ['relationship', 'relationship', ['relationship', 'relation']],
  ['sex', 'sex', ['sex', 'gender']],
  [
    'country_of_birth',
    'country of birth',
    ['country_of_birth', 'birth_country'],
  ],
  ['given_name', 'given name(s)', ['given_name', 'given_names', 'first_name']],
  ['family_name', 'family name', ['family_name', 'surname', 'last_name']],
];

function profileText(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

function profileChildren(profile: Record<string, unknown>) {
  const out: Array<Record<string, unknown>> = [];
  for (const key of ['children', 'children_details']) {
    const list = profile[key];
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const name = personName(c as Record<string, unknown>);
        if (name) out.push(c as Record<string, unknown>);
      }
    }
  }
  return out;
}

function fillFamilySection(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const p = ctx.profile;
  const fill = (re: RegExp, value: string, key: string, label: string) => {
    if (!value) return;
    const existing = fields.filter((f) => re.test(f.key));
    if (existing.length === 0) {
      fields.push({ key, label, value, group: 'Family', source: 'profile' });
      return;
    }
    for (const f of existing) {
      if (f.value.trim()) continue;
      f.value = value;
      f.source = 'profile';
    }
  };

  fill(
    SPOUSE_DOB_FIELD,
    profileText(p.spouse_date_of_birth),
    'spouse_date_of_birth',
    'Spouse date of birth',
  );
  fill(
    SPOUSE_COB_FIELD,
    profileText(p.spouse_country_of_birth),
    'spouse_country_of_birth',
    'Spouse country of birth',
  );
  fill(
    MARRIAGE_DATE_FIELD,
    profileText(p.marriage_date),
    'marriage_date',
    'Date of marriage',
  );

  const flags = Array.isArray(p.document_consistency_flags)
    ? (p.document_consistency_flags as Array<{
        field?: string;
        message?: string;
      }>)
    : [];
  const marriageFlag = flags.find((x) => x?.field === 'marriage_date');
  if (marriageFlag?.message) {
    for (const f of fields) {
      if (!MARRIAGE_DATE_FIELD.test(f.key)) continue;
      f.needsReview = true;
      f.note = marriageFlag.message;
    }
  }

  // Children: complete the rows the generator wrote (matched BY NAME) and
  // add a row for every child it left out.
  const children = profileChildren(p);
  if (children.length === 0) return;

  const groups = new Map<
    string,
    { prefix: string; n: number; name: string; attrs: Set<string> }
  >();
  let maxChild = 0;
  for (const field of fields) {
    const m = PERSON_FIELD.exec(field.key);
    if (!m) continue;
    const prefix = m[1];
    const n = Number(m[2]);
    if (/child|son|daughter/.test(prefix)) maxChild = Math.max(maxChild, n);
    const id = `${prefix}_${n}`;
    const g = groups.get(id) ?? {
      prefix,
      n,
      name: '',
      attrs: new Set<string>(),
    };
    g.attrs.add(m[3]);
    if (NAME_ATTR.test(m[3]) && field.value.trim()) g.name = field.value.trim();
    groups.set(id, g);
  }
  const named = [...groups.values()].filter((g) => g.name);
  // A child the generator wrote without a name can only be matched by
  // position, the same way a nameless child in the profile is.
  const unnamedChildren = [...groups.values()]
    .filter((g) => !g.name && /child|son|daughter/.test(g.prefix))
    .sort((x, y) => x.n - y.n);

  for (const child of children) {
    // Intake stores "Unknown" when the applicant gave no name; that is not
    // a name to match on or to print (Express Entry E2E, prod 2026-10-19:
    // "Unknown — relationship" beside the generator's own child_1 rows).
    const raw = personName(child).trim();
    const name = PLACEHOLDER_NAME.test(raw) ? '' : raw;
    const group = name
      ? named.find((g) => findByName([{ name: g.name }], name) !== null)
      : unnamedChildren.shift();
    const prefix = group ? `${group.prefix}_${group.n}` : `child_${++maxChild}`;
    const label = group?.name || name || `Child ${group ? group.n : maxChild}`;
    if (!group && name) {
      fields.push({
        key: `${prefix}_name`,
        label: `Child ${maxChild} — name`,
        value: name,
        group: 'Family',
        source: 'profile',
      });
    }
    for (const [attr, what, keys] of CHILD_FORM_ATTRS) {
      if (group && [attr, ...keys].some((k) => group.attrs.has(k))) continue;
      const value = keys.map((k) => profileText(child[k])).find(Boolean);
      if (!value) continue;
      fields.push({
        key: `${prefix}_${attr}`,
        label: `${label} — ${what}`,
        value,
        group: 'Family',
        source: 'profile',
      });
    }
  }
}

// ── 8. route form questions ─────────────────────────────────────────────────

/**
 * IMM 5257 asks passport type, US status, previous travel to Canada and the
 * representative's details (#50). Intake now collects them; the generator is
 * free-form and may leave them out. Each answered one is added as a field
 * under its canonical key when no field already carries it. Configuration
 * lives in @visaai/types intake-requirements, so a route without it gets
 * nothing added.
 */
function carryRouteFacts(fields: PrefilledFormField[], ctx: FinalizeContext) {
  if (!ctx.route) return;
  for (const { spec, value } of answeredFormFacts(ctx.profile, ctx.route)) {
    const keys = new Set([spec.key, ...(spec.aliases ?? [])]);
    const display = displayAnswer(value) || displayRecords(value);
    const held = fields.find((f) => keys.has(f.key));
    if (held) {
      // The generator's own key for the question, left EMPTY: it becomes the
      // canonical field with the answer, as the label match below does — not
      // a blank row hiding the profile's answer.
      if (
        display &&
        held.key !== spec.key &&
        String(held.value ?? '').trim() === '' &&
        held.source !== 'applicant' &&
        held.source !== 'consultant' &&
        !fields.some((f) => f.key === spec.key)
      ) {
        held.key = spec.key;
        held.value = display;
        held.source = 'profile';
      }
      continue;
    }
    if (!display) continue;
    // The generator may carry the same question under a key of its own. An
    // answered one stays; an EMPTY one becomes the canonical field, so the
    // answer shows and a correction lands on the key the fill reads. A field
    // a person cleared stays cleared.
    const label = spec.form!.label.trim().toLowerCase();
    const same = fields.find(
      (f) => (f.label ?? '').trim().toLowerCase() === label,
    );
    if (same) {
      if (
        String(same.value ?? '').trim() === '' &&
        same.source !== 'applicant' &&
        same.source !== 'consultant'
      ) {
        same.key = spec.key;
        same.value = display;
        same.source = 'profile';
      }
      continue;
    }
    fields.push({
      key: spec.key,
      label: spec.form!.label,
      value: display,
      group: spec.form!.group,
      source: 'profile',
    });
  }
}

/**
 * A list of records (the work history's periods) as one line per record —
 * "from: 2014-01; to: 2018-06; activity: Teacher" — so a fact the portal
 * assistant cannot write still reaches the Forms page for the applicant.
 */
function displayRecords(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return v
    .filter(
      (r): r is Record<string, unknown> =>
        !!r && typeof r === 'object' && !Array.isArray(r),
    )
    .map((r) =>
      Object.entries(r)
        .map(([k, x]) => [k, displayAnswer(x)] as const)
        .filter(([, x]) => x)
        .map(([k, x]) => `${k}: ${x}`)
        .join('; '),
    )
    .filter(Boolean)
    .join('\n');
}

function displayAnswer(v: unknown): string {
  // A number is an amount or a count, never a yes/no: Express Entry's
  // settlement funds (23500) rendered as "Yes" (prod 2026-10-19).
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const yes = intakeAnswerIsYes(v);
  if (typeof v === 'boolean' || (yes !== undefined && typeof v !== 'string')) {
    return yes ? 'Yes' : 'No';
  }
  if (typeof v === 'string') {
    if (yes !== undefined && /^(y|n|yes|no|true|false)$/i.test(v.trim())) {
      return yes ? 'Yes' : 'No';
    }
    return v.trim();
  }
  return '';
}

// ── 10. host date of birth ──────────────────────────────────────────────────

const HOST_DOB_FIELD = /^(host|inviter)_(date_of_birth|dob|birth_date)$/;
const HOST_ID_DOC =
  /passport|host_status|citizenship|permanent_resident|pr_card|identity|birth_certificate/;

function isoDay(v: unknown): string | null {
  const t = isoDayMs(v);
  return t === null ? policyDate(v) : new Date(t).toISOString().slice(0, 10);
}

function hostName(p: Record<string, unknown>): string | null {
  for (const k of [
    'inviter_name',
    'host_name',
    'host_full_name',
    'inviter_full_name',
  ]) {
    const v = profileText(p[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Prod 2026-10-16 (super visa, app 61f16bb5): host_date_of_birth came out as
 * 1968-10-09 — the applicant's own date of birth — from a household list
 * whose extraction paired the host's name with his mother's date. A super
 * visa host is the applicant's child or grandchild, so their date of birth is
 * never the applicant's.
 */
function fillHostDateOfBirth(
  fields: PrefilledFormField[],
  ctx: FinalizeContext,
) {
  const targets = fields.filter((f) => HOST_DOB_FIELD.test(f.key));
  if (targets.length === 0) return;
  const applicantDob =
    isoDay(ctx.profile.date_of_birth) ??
    isoDay(ctx.documentFields.date_of_birth);

  let truth: { value: string; source: PrefilledFormField['source'] } | null =
    null;
  for (const k of [
    'inviter_date_of_birth',
    'host_date_of_birth',
    'host_dob',
    'inviter_dob',
  ]) {
    const d = isoDay(ctx.profile[k]);
    if (d && d !== applicantDob) {
      truth = { value: d, source: 'profile' };
      break;
    }
  }
  if (!truth) {
    const host = hostName(ctx.profile);
    const docs = ctx.otherPartyDocuments
      .filter((d) => {
        const holder = d.holderName;
        return (
          !!host &&
          !!holder &&
          (namesMatch(holder, host) || namesMatch(host, holder))
        );
      })
      .sort(
        (a, b) =>
          Number(HOST_ID_DOC.test(b.documentType)) -
          Number(HOST_ID_DOC.test(a.documentType)),
      );
    for (const d of docs) {
      const dob = isoDay(d.fields.date_of_birth);
      if (dob && dob !== applicantDob) {
        truth = { value: dob, source: 'document' };
        break;
      }
    }
  }

  for (const f of targets) {
    const current = isoDay(f.value);
    if (truth) {
      if (current === truth.value) continue;
      f.value = truth.value;
      f.source = truth.source;
      if (current) {
        f.needsReview = true;
        f.note = `Corrected: ${current} is not the host's date of birth.`;
      }
    } else if (current && current === applicantDob) {
      f.value = '';
      f.needsReview = true;
      f.note =
        "Removed: this was the applicant's own date of birth. Enter the host's date of birth.";
    }
  }
}

// ── 11. insurance ───────────────────────────────────────────────────────────

const INSURANCE_FIELDS: Array<
  [RegExp, (p: InsurancePolicy) => string | null, 'date' | 'text' | 'amount']
> = [
  [
    /^((medical|travel_medical)_)?insurance_(insurer(_name)?|provider|company)$|^insurer(_name)?$/,
    (p) => p.insurer,
    'text',
  ],
  [
    /^((medical|travel_medical)_)?insurance_policy_number$/,
    (p) => p.policyNumber,
    'text',
  ],
  [
    /^((medical|travel_medical)_)?insurance_coverage(_amount)?(_cad)?$/,
    (p) => (p.coverageAmount !== null ? String(p.coverageAmount) : null),
    'amount',
  ],
  [
    /^((medical|travel_medical)_)?insurance_(coverage_)?(start|effective)_date$/,
    (p) => p.start,
    'date',
  ],
  [
    /^((medical|travel_medical)_)?insurance_(coverage_)?(end|expiry)_date$/,
    (p) => p.end,
    'date',
  ],
];

function sameInsuranceValue(
  kind: 'date' | 'text' | 'amount',
  a: string,
  b: string,
) {
  if (kind === 'date') return isoDay(a) !== null && isoDay(a) === isoDay(b);
  if (kind === 'amount')
    return a.replace(/[^0-9.]/g, '') === b.replace(/[^0-9.]/g, '');
  return comparableValue(a) === comparableValue(b);
}

/**
 * Prod 2026-10-16: the applicant uploaded an expired policy and a covering
 * one. Which one the form described was up to the model, and it left the
 * cover amount blank although both print it.
 */
function fillInsurance(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const entry = findDate(fields, ctx.profile, ENTRY_KEY);
  const exit = findDate(fields, ctx.profile, DEPARTURE_KEY);
  const stay = {
    entryDate: entry?.raw ?? null,
    departureDate: exit?.raw ?? null,
  };
  const chosen = choosePolicy(
    (ctx.insurancePolicies ?? []).map((p) => readPolicy(p, stay)),
  );
  const declaredCover = superVisaInsuranceCheck(ctx.profile).coverageCad;

  for (const [re, get, kind] of INSURANCE_FIELDS) {
    for (const f of fields) {
      if (!re.test(f.key)) continue;
      let want = chosen ? get(chosen) : null;
      let source: PrefilledFormField['source'] = 'document';
      if (!want && kind === 'amount' && declaredCover !== null) {
        want = String(declaredCover);
        source = 'profile';
      }
      if (!want) continue;
      const had = f.value.trim();
      if (had && sameInsuranceValue(kind, had, want)) {
        if (kind === 'date') f.value = isoDay(want) ?? want;
      } else {
        f.value = kind === 'date' ? (isoDay(want) ?? want) : want;
        f.source = source;
        if (had) {
          f.needsReview = true;
          f.note =
            source === 'document'
              ? `Taken from the uploaded policy${chosen?.policyNumber ? ` ${chosen.policyNumber}` : ''} chosen for the stay; "${had}" did not match it.`
              : `Taken from the intake answers; "${had}" did not match them.`;
        }
      }
      if (chosen && source === 'document' && chosen.coversStay === false) {
        f.needsReview = true;
        f.note = `The uploaded policy (${chosen.policyNumber ?? 'no number'}, ending ${chosen.end ?? 'unknown'}) does not cover the planned stay — a policy covering it is needed.`;
      }
    }
  }
}

// ── 12. form fields the profile answers ─────────────────────────────────────

/** Form field pattern → profile keys that answer it, most specific first. */
const PROFILE_ANSWERS: Array<[RegExp, string[]]> = [
  [
    /^(place|city|town)_of_birth$|^birth_(place|city)$/,
    ['place_of_birth', ...FACT_KEY_SYNONYMS.place_of_birth],
  ],
  [
    /^(current_)?occupation$/,
    ['occupation', ...FACT_KEY_SYNONYMS.occupation, 'occupation_category'],
  ],
  [
    /^(residential|home|current)_address$/,
    ['residential_address', 'home_address', 'current_address'],
  ],
  [
    /^second_(host|inviter)_(full_)?name$/,
    [
      'second_inviter_name',
      'second_host_name',
      'second_inviter_full_name',
      'co_signer_name',
    ],
  ],
  [
    /^second_(host|inviter)_(home_)?address$/,
    ['second_inviter_address', ...FACT_KEY_SYNONYMS.second_inviter_address],
  ],
  [
    /^second_(host|inviter)_(phone|telephone)(_number)?$/,
    ['second_inviter_phone', ...FACT_KEY_SYNONYMS.second_inviter_phone],
  ],
  [
    /^(previous|prior)_visa_refus(al|ed)$|^refused_visa(_or_denied_entry)?$/,
    [
      'refused_or_ordered_to_leave',
      'refused_visa_or_denied_entry',
      'previous_visa_refused',
      'previous_visa_refusal',
      'has_prior_refusal',
      'prior_visa_refusal',
      'visa_refused',
      'refused_visa',
    ],
  ],
  [
    /^spouse_(family_name|surname|last_name)$/,
    ['spouse_family_name', 'spouse_surname', 'spouse_last_name'],
  ],
  [
    /^spouse_(given_names?|first_name)$/,
    ['spouse_given_name', 'spouse_given_names', 'spouse_first_name'],
  ],
  [/^spouse_full_name$|^spouse_name$/, ['spouse_full_name', 'spouse_name']],
];

/**
 * Gap-fill only. Prod 2026-10-16 the form left place of birth, home address,
 * the second host and the refusal answer empty; each is filled here whenever
 * the profile holds it under one of these keys.
 */
function fillFromProfile(fields: PrefilledFormField[], ctx: FinalizeContext) {
  for (const [re, keys] of PROFILE_ANSWERS) {
    let value = '';
    for (const k of keys) {
      value = displayAnswer(ctx.profile[k]);
      if (value) break;
    }
    if (!value) continue;
    for (const f of fields) {
      if (!re.test(f.key) || f.value.trim()) continue;
      f.value = value;
      f.source = 'profile';
    }
  }
}

/**
 * Prod 2026-10-29: the profile held the spouse's full name only, and the
 * empty "Spouse family name" / "Spouse given name(s)" fields stayed empty.
 * The parts the applicant gave win (fillFromProfile); otherwise the full
 * name is split the way the IRCC fill splits it (nameParts: last word is the
 * family name), so the Forms page shows what will be written.
 */
function fillSpouseNameParts(
  fields: PrefilledFormField[],
  ctx: FinalizeContext,
) {
  const spouse = asRecord(ctx.profile.spouse ?? ctx.profile.partner);
  const full =
    profileText(ctx.profile.spouse_name) ||
    profileText(ctx.profile.spouse_full_name) ||
    profileText(spouse.name ?? spouse.full_name);
  if (!full) return;
  const parts = nameParts(
    {
      spouse_family_name:
        profileText(ctx.profile.spouse_family_name) ||
        profileText(spouse.family_name) ||
        undefined,
      spouse_given_name:
        profileText(ctx.profile.spouse_given_name) ||
        profileText(spouse.given_name) ||
        undefined,
      spouse_name: full,
    },
    'spouse',
  );
  const fill = (re: RegExp, value?: string) => {
    if (!value) return;
    for (const f of fields) {
      if (!re.test(f.key) || f.value.trim()) continue;
      f.value = value;
      f.source = 'profile';
    }
  };
  fill(/^spouse_(family_name|surname|last_name)$/, parts.family);
  fill(/^spouse_(given_names?|first_name)$/, parts.given);
}

// ── 13. IRCC questions the applicant still has to answer ───────────────────

/**
 * Note on a field VisaAI put on the form because IRCC asks it and nothing
 * answers it yet. The save path drops it (and the review flag) once the
 * applicant types an answer.
 */
export const UNANSWERED_NOTE =
  'IRCC asks this question. Please answer it here so it can be filled in on your IRCC application.';

/**
 * Registry routes that file IRCC's temporary-resident application (tr-rt,
 * IMM 5257): the routes `ROUTE_FACTS` in @visaai/types gives the IRCC portal
 * questions.
 */
const IRCC_TR_RT_ROUTES = new Set([
  'ca-visitor-visa-temporary-resident-visa',
  'ca-business-visitors',
  'ca-super-visa',
]);

interface IrccQuestion {
  /** A key the IRCC mapping reads (canada-ircc.ts, directly or via the Forms-page overlay). */
  key: string;
  /** Other keys for the same answer, on the profile or the generated form. */
  aliases?: string[];
  label: string;
  group: string;
  /** The profile's answer held in structured data (a parent row, the spouse record). */
  read?: () => unknown;
  /** The IRCC fill already reads an answer the form cannot show as text (a list). */
  settled?: () => boolean;
  /** A note for the applicant when the answer is Yes (the field keeps its value). */
  yesNote?: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function records(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> =>
          !!x && typeof x === 'object' && !Array.isArray(x),
      )
    : [];
}

function parentRoleOf(c: Record<string, unknown>): 'father' | 'mother' | null {
  const r = profileText(c.relationship ?? c.relation ?? c.role).toLowerCase();
  if (/father|dad/.test(r)) return 'father';
  if (/mother|mum|mom/.test(r)) return 'mother';
  return null;
}

/**
 * Prod 2026-10-18 (Canada visitor visa, interview skipped): the Forms page had
 * no field for the parents' occupation and whereabouts, the marriage date, the
 * spouse's address, the children's whereabouts, biometrics, other names, dual
 * citizenship, the host's status, the current job's duties, address and start
 * month, US status, travel by air or a previous Canadian visa, so the IRCC
 * fill left every one for the applicant on the portal. Each question that
 * applies to this applicant is now on the form: answered from the profile
 * when it holds the answer, otherwise empty and flagged for the applicant.
 * A question that does not apply (no spouse, no father named, retired) is
 * not added, and a field the generator already wrote under the same key or an
 * alias is not duplicated.
 */
function askIrccQuestions(fields: PrefilledFormField[], ctx: FinalizeContext) {
  const route = ctx.route;
  if (route?.country?.trim().toUpperCase() !== 'CA') return;
  const visaaiId = route.visaaiId?.trim() ?? '';
  if (!IRCC_TR_RT_ROUTES.has(visaaiId)) return;
  const p = ctx.profile;

  /** First answer among the keys: the profile's, else one on the form. */
  const said = (...keys: string[]): string => {
    for (const k of keys) {
      const v = displayAnswer(p[k]);
      if (v) return v;
    }
    for (const k of keys) {
      const f = fields.find((x) => x.key === k && x.value.trim());
      if (f) return f.value.trim();
    }
    return '';
  };
  const yes = (...keys: string[]) => intakeAnswerIsYes(said(...keys)) === true;
  const no = (...keys: string[]) => intakeAnswerIsYes(said(...keys)) === false;

  const questions: IrccQuestion[] = [];
  const ask = (q: IrccQuestion) => questions.push(q);

  // ── Personal details
  ask({
    key: 'has_other_names',
    aliases: ['used_other_names'],
    label:
      'Have you ever used any other name, such as a maiden name, an alias or a different spelling? (Yes/No)',
    group: 'Personal details',
    settled: () =>
      ['other_names', 'aliases', 'previous_names'].some((k) =>
        Array.isArray(p[k]),
      ) || !!profileText(p.other_names),
  });
  ask({
    key: 'multiple_citizenship',
    aliases: ['dual_citizenship', 'dual_national', 'has_multiple_citizenships'],
    label: 'Are you a citizen of more than one country? (Yes/No)',
    group: 'Personal details',
    settled: () => Array.isArray(p.other_citizenships),
  });

  // ── Family: spouse
  const spouse = asRecord(p.spouse ?? p.partner);
  const marital = said('marital_status', 'civil_status').toLowerCase();
  const spouseNamed = !!(
    said('spouse_name', 'spouse_full_name', 'spouse_given_name') ||
    profileText(spouse.name ?? spouse.full_name)
  );
  const notLiving = /never|un-?married|single|divorc|separat|widow|annul/.test(
    marital,
  );
  const spouseLiving = marital
    ? !notLiving && /married|common/.test(marital)
    : spouseNamed;
  const commonLaw = /common/.test(marital);
  if ((spouseLiving && !commonLaw) || /widow/.test(marital)) {
    ask({
      key: 'marriage_date',
      aliases: [
        'date_of_marriage',
        'wedding_date',
        'date_of_current_marriage',
        'current_marriage_date',
        'marriage_date_of_current_spouse',
      ],
      label: 'What is the date of your marriage? (YYYY-MM-DD)',
      group: 'Family',
    });
  }
  if (spouseLiving) {
    const spouseRead =
      (...ks: string[]) =>
      () =>
        ks.map((k) => spouse[k]).find((v) => displayAnswer(v) !== '');
    ask({
      key: 'spouse_same_address',
      aliases: ['lives_with_spouse'],
      label: 'Does your spouse live with you at your home address? (Yes/No)',
      group: 'Family',
      read: spouseRead('same_address', 'lives_with_applicant'),
    });
    ask({
      key: 'spouse_coming_to_canada',
      aliases: ['spouse_accompanying', 'spouse_travelling'],
      label: 'Is your spouse coming to Canada with you on this trip? (Yes/No)',
      group: 'Family',
      read: spouseRead('coming_to_canada', 'accompanying'),
    });
    const together =
      yes('spouse_same_address', 'lives_with_spouse') ||
      intakeAnswerIsYes(spouse.same_address ?? spouse.lives_with_applicant) ===
        true;
    if (!together) {
      ask({
        key: 'spouse_address',
        label:
          "If your spouse does not live with you: what is your spouse's full home address?",
        group: 'Family',
        read: () => spouse.address,
      });
    }
  }

  // ── Family: former or late spouse (trrt matrix C 15, 18-21). Divorced,
  // separated, annulled and widowed all reveal the same block live
  // (2026-10-31): the marriage date, names, date of birth and country of
  // birth. A late spouse's marriage date is asked above under marriage_date.
  const unionEnded = /divorc|separat|annul|widow/.test(marital);
  if (unionEnded) {
    const widow = /widow/.test(marital);
    if (!widow)
      ask({
        key: 'previous_marriage_date',
        aliases: ['former_marriage_date', 'marriage_date', 'date_of_marriage'],
        label:
          'What was the date of your former marriage (or the date your common-law relationship began)? (YYYY-MM-DD)',
        group: 'Family',
      });
    const who = widow ? 'your late spouse' : 'your former spouse or partner';
    ask({
      key: 'previous_spouse_name',
      aliases: [
        'former_spouse_name',
        'late_spouse_name',
        'spouse_name',
        'spouse_full_name',
      ],
      label: `What was the full name (given names and family name) of ${who}?`,
      group: 'Family',
      read: () => spouse.name ?? spouse.full_name,
      // The generator's spouse family / given name fields already hold it.
      settled: () => spouseNamed,
    });
    ask({
      key: 'previous_spouse_date_of_birth',
      aliases: [
        'former_spouse_date_of_birth',
        'late_spouse_date_of_birth',
        'spouse_date_of_birth',
      ],
      label: `What was the date of birth of ${who}? (YYYY-MM-DD; the year alone if you do not know the rest)`,
      group: 'Family',
      read: () => spouse.date_of_birth ?? spouse.dob,
    });
    ask({
      key: 'previous_spouse_country_of_birth',
      aliases: [
        'former_spouse_country_of_birth',
        'late_spouse_country_of_birth',
        'spouse_country_of_birth',
      ],
      label: `In which country was ${who} born?`,
      group: 'Family',
      read: () => spouse.country_of_birth ?? spouse.birth_country,
    });
  }

  // ── Family: children
  const kids = [...records(p.children), ...records(p.children_details)];
  const childFieldNamed = fields.some(
    (f) =>
      f.value.trim() &&
      (f.key === 'children_details' || /^child_\d+_/.test(f.key)),
  );
  const hasKids =
    kids.length > 0 ||
    yes('has_children') ||
    Number(said('number_of_children')) > 0 ||
    childFieldNamed;
  const childrenNone =
    no('has_children') ||
    said('number_of_children') === '0' ||
    (Array.isArray(p.children) && p.children.length === 0);
  if (hasKids && !childrenNone) {
    const everyKid =
      (...ks: string[]) =>
      () =>
        kids.length > 0 &&
        kids.every((c) => ks.some((k) => displayAnswer(c[k]) !== ''));
    ask({
      key: 'children_living_with_you',
      label:
        'Which of your children live with you at your home address? (their names, or "None")',
      group: 'Family',
      settled: everyKid(
        'same_address',
        'lives_with_applicant',
        'in_home_country',
      ),
    });
    ask({
      key: 'children_accompanying',
      label:
        'Which of your children are coming to Canada with you on this trip? (their names, or "None")',
      group: 'Family',
      settled: everyKid(
        'coming_to_canada',
        'accompanying',
        'travelling_with_applicant',
      ),
    });
    // IRCC's child row needs each child's country of birth (live
    // 2026-10-18); the interview does not ask it.
    ask({
      key: 'children_countries_of_birth',
      label:
        'In which country was each of your children born? (one child per line, e.g. "Ali Khan: Pakistan")',
      group: 'Family',
      settled: everyKid('country_of_birth', 'birth_country', 'place_of_birth'),
    });
    // IRCC will not save a child who lives elsewhere without their address
    // (live 2026-10-18).
    ask({
      key: 'children_addresses',
      label:
        'For each child who does not live with you: their name and full home address (one child per line, e.g. "Ali Khan: 12 Main St, Toronto, ON M5V 2T6, Canada")',
      group: 'Family',
      settled: everyKid('address', 'residential_address', 'same_address'),
    });
  }

  // ── Family: parents (IRCC's parent dialog needs every one of these)
  const parentRows = records(p.parents);
  for (const role of ['father', 'mother'] as const) {
    const row = parentRows.find((c) => parentRoleOf(c) === role) ?? {};
    const named =
      profileText(row.name ?? row.full_name) ||
      said(
        `${role}_name`,
        `${role}_full_name`,
        `${role}_given_name`,
        `${role}_family_name`,
      );
    if (!named) continue;
    const who = role === 'father' ? 'your father' : 'your mother';
    const fromRow =
      (...ks: string[]) =>
      () =>
        ks.map((k) => row[k]).find((v) => displayAnswer(v) !== '');
    ask({
      key: `${role}_date_of_birth`,
      aliases: [`${role}_dob`, `${role}_birth_date`, `${role}_birth_year`],
      label: `What is ${who}'s date of birth? (YYYY-MM-DD, or the year only)`,
      group: 'Family',
      read: fromRow('date_of_birth', 'dob', 'birth_date', 'birth_year'),
    });
    ask({
      key: `${role}_country_of_birth`,
      aliases: [`${role}_birth_country`],
      label: `In which country was ${who} born?`,
      group: 'Family',
      read: fromRow('country_of_birth', 'birth_country'),
    });
    const deceased =
      intakeAnswerIsYes(row.deceased ?? row.is_deceased) === true ||
      yes(`${role}_deceased`, `${role}_is_deceased`);
    // An occupation of "Deceased" is a hint, not the answer IRCC's fill reads:
    // ask it plainly, and keep the living-parent questions until it is
    // answered (review 2026-10-18).
    const hinted =
      !deceased &&
      /deceased|passed away|\bdied\b|\blate\b/i.test(
        profileText(row.occupation) || said(`${role}_occupation`),
      );
    if (hinted)
      ask({
        key: `${role}_deceased`,
        label: `Has ${who} passed away? (Yes/No)`,
        group: 'Family',
        read: fromRow('deceased', 'is_deceased'),
      });
    if (deceased || hinted)
      ask({
        key: `${role}_date_of_death`,
        label: `If ${who} has passed away: when? (date, or the year if you do not know the day)`,
        group: 'Family',
        read: fromRow('date_of_death', 'death_date', 'year_of_death'),
      });
    if (deceased) {
      continue;
    }
    ask({
      key: `${role}_occupation`,
      label: `What is ${who}'s current occupation? (for example Retired or Homemaker)`,
      group: 'Family',
      read: fromRow('occupation'),
    });
    ask({
      key: `${role}_same_address`,
      label: `Does ${who} live with you at your home address? (Yes/No)`,
      group: 'Family',
      read: fromRow('same_address', 'lives_with_applicant'),
    });
    ask({
      key: `${role}_coming_to_canada`,
      label: `Is ${who} coming to Canada with you on this trip? (Yes/No)`,
      group: 'Family',
      read: fromRow('coming_to_canada', 'accompanying'),
    });
    // IRCC will not save a parent who lives elsewhere without their address
    // (live 2026-10-18).
    const together =
      intakeAnswerIsYes(row.same_address ?? row.lives_with_applicant) ===
        true || yes(`${role}_same_address`);
    if (!together)
      ask({
        key: `${role}_address`,
        label: `If ${who} does not live with you: what is ${who}'s full home address?`,
        group: 'Family',
        read: fromRow('address', 'residential_address'),
      });
  }

  // ── Employment: the current job's row in IRCC's work history
  const job = said(
    'job_title',
    'occupation',
    'current_occupation',
    'position',
    'designation',
  );
  const working =
    !!job &&
    !isRetiredProfile(p) &&
    !/\bretired\b/i.test(
      said('employment_status', 'occupation', 'current_occupation'),
    ) &&
    !no('employed', 'is_employed', 'currently_employed') &&
    !/^(home ?maker|house ?wife|student|unemployed|retired|none)$/i.test(job);
  if (working) {
    ask({
      key: 'job_duties',
      aliases: ['duties', 'responsibilities', 'job_description'],
      label: 'What are your main duties in your current job?',
      group: 'Employment',
    });
    ask({
      key: 'employer_address',
      aliases: ['work_address', 'current_employer_address'],
      label:
        "What is your employer's full street address (street, city, country)?",
      group: 'Employment',
    });
    ask({
      key: 'employment_start_date',
      aliases: [
        'employment_since',
        'employed_since',
        'current_employment_start_date',
      ],
      label: 'In what month and year did you start your current job? (YYYY-MM)',
      group: 'Employment',
    });
  }

  // ── Employment: a retired or homemaker applicant's ongoing period. IRCC
  // will not save its work history without the last 10 years covered (live
  // 2026-10-18), and the row needs the month the period began.
  const status = said('employment_status', 'occupation', 'current_occupation');
  const notWorking =
    isRetiredProfile(p) ||
    /\bretired\b/i.test(status) ||
    /^(home ?maker|house ?wife|house ?husband)$/i.test(status.trim());
  if (notWorking)
    ask({
      key: 'occupation_since',
      aliases: [
        'retirement_date',
        'retired_since',
        'date_of_retirement',
        'homemaker_since',
        'not_employed_since',
      ],
      label:
        /\bretired\b/i.test(status) || isRetiredProfile(p)
          ? 'Since when have you been retired? (YYYY-MM)'
          : 'Since when have you been a homemaker? (YYYY-MM, or when you stopped your last job)',
      group: 'Employment',
    });

  // ── Travel
  const factAliases = (key: string) =>
    intakeFactSpecs(route).find((s) => s.key === key)?.aliases ?? [];
  ask({
    key: 'us_permanent_resident',
    aliases: [...factAliases('us_permanent_resident'), 'has_green_card'],
    label:
      'Are you a lawful permanent resident of the United States (a green card holder)? (Yes/No)',
    group: 'Travel',
    // Live 2026-10-31: IRCC answers a Green Card "Yes" with "you don't need
    // to apply for anything"; the visitor visa route does not apply to them.
    yesNote: GREEN_CARD_NOTE,
  });
  ask({
    key: 'has_valid_us_visa',
    aliases: [
      ...factAliases('has_valid_us_visa'),
      'valid_us_nonimmigrant_visa',
      'us_nonimmigrant_visa',
    ],
    label: 'Do you currently hold a valid United States visa? (Yes/No)',
    group: 'Travel',
  });
  ask({
    key: 'travel_by_air',
    aliases: ['travelling_by_air', 'arriving_by_air', 'flying_to_canada'],
    label: 'Are you travelling to Canada by air? (Yes/No)',
    group: 'Travel',
  });
  ask({
    key: 'held_canadian_visa_10_years',
    aliases: [
      'held_canadian_visitor_visa',
      'canadian_visa_last_10y',
      'held_canadian_visa_last_10_years',
      'had_canadian_visa_10_years',
    ],
    label:
      'Have you held a Canadian visitor visa in the last 10 years? (Yes/No)',
    group: 'Travel',
  });
  ask({
    key: 'biometrics_given',
    aliases: [
      'biometrics_given_before',
      'has_given_biometrics',
      'previous_biometrics',
    ],
    label:
      'Have you given biometrics (fingerprints and photo) to Canada in the last 10 years? (Yes/No)',
    group: 'Travel',
    settled: () =>
      !!profileText(p.biometrics_enrollment_date ?? p.biometrics_date),
  });

  // ── Host: IRCC's visa purpose turns on the host's status in Canada
  const inviterObj = asRecord(p.inviter ?? p.host ?? p.host_in_canada);
  // A business visitor's inviter is their Canadian contact, family or not;
  // the visa purpose is always Business, so the host's status is not asked.
  const business = visaaiId === 'ca-business-visitors';
  if (business) {
    ask({
      key: 'business_activity',
      aliases: ['business_activities', 'business_purpose'],
      label:
        'What will you do in Canada on this business trip? (meetings, a conference or trade fair, after-sales service, training…)',
      group: 'Travel',
    });
    ask({
      key: 'canadian_business_name',
      aliases: [
        'canadian_company_name',
        'host_company_name',
        'inviting_company_name',
      ],
      label:
        'What is the name of the Canadian company or organization you are visiting, or of the event?',
      group: 'Host',
    });
    ask({
      key: 'inviter_name',
      aliases: [
        'host_name',
        'host_full_name',
        'inviter_full_name',
        'business_contact_name',
      ],
      label:
        'What is the full name of your contact person at that company or event?',
      group: 'Host',
    });
    ask({
      key: 'inviter_address',
      aliases: ['host_address', 'canadian_business_address', 'company_address'],
      label:
        "What is the company's or event's full address in Canada, with the postal code?",
      group: 'Host',
    });
    ask({
      key: 'inviter_phone',
      aliases: ['host_phone', 'host_telephone', 'business_contact_phone'],
      label: "What is your contact person's telephone number?",
      group: 'Host',
    });
  }
  const hosted =
    business ||
    visaaiId === 'ca-super-visa' ||
    Object.keys(inviterObj).length > 0 ||
    yes('family_in_destination') ||
    !!said(
      'inviter_name',
      'host_name',
      'host_full_name',
      'inviter_full_name',
      'family_member_name',
    );
  if (hosted) {
    const host = inviterAnswers(p);
    // The business fill answers the relationship itself (Organization or
    // Conference, canada-ircc-business-visitor.ts).
    if (!business) {
      ask({
        key: 'inviter_status',
        aliases: [
          'host_status',
          'host_immigration_status',
          'inviter_immigration_status',
          'host_citizenship_status',
        ],
        label:
          "What is your host's status in Canada? (Canadian citizen, permanent resident, or temporary resident such as a student or worker)",
        group: 'Host',
        read: () => inviterObj.status,
      });
      // IRCC's invitation page requires these (live 2026-10-18). Read the way
      // the IRCC fill reads them (inviterAnswers), so a fact it already has —
      // the visited family member's relationship, the representative-host's
      // email — is not asked again.
      ask({
        key: 'inviter_relationship',
        aliases: [
          'host_relationship',
          'relationship_to_host',
          'relationship_to_inviter',
        ],
        label:
          'How is your host related to you? (Family member, Friend, Conference or Organization)',
        group: 'Host',
        read: () => host.relationship,
      });
    }
    ask({
      key: 'inviter_phone_type',
      aliases: [
        'host_phone_type',
        'inviter_telephone_type',
        'host_telephone_type',
      ],
      label:
        "Is your host's telephone number a home, cell or other number? (Residence, Cellular or Other)",
      group: 'Host',
      read: () => host.phoneType,
    });
    ask({
      key: 'inviter_email',
      aliases: ['host_email', 'host_email_address', 'inviter_email_address'],
      label: "What is your host's email address?",
      group: 'Host',
      read: () => host.email,
    });
  }

  // ── A tourist with no host: IRCC's invitation page asks who they will
  // visit or where they will stay; the IRCC fill names the place in its note.
  if (!hosted) {
    ask({
      key: 'accommodation_provider_name',
      aliases: ['accommodation_name', 'hotel_name'],
      label: 'Where will you stay in Canada? (hotel or place name)',
      group: 'Travel',
    });
    ask({
      key: 'accommodation_address',
      aliases: ['hotel_address'],
      label:
        'What is the full address of the place where you will stay, with the postal code?',
      group: 'Travel',
    });
  }

  // ── Earlier countries of residence (IRCC's residence table, past 5 years)
  ask({
    key: 'lived_elsewhere_last_5_years',
    aliases: ['lived_in_other_country_last_5_years'],
    label:
      'In the past 5 years, have you lived for more than 6 months in a country other than the one you live in now? (Yes/No)',
    group: 'Personal details',
    settled: () => Array.isArray(p.previous_countries_of_residence),
  });
  if (yes('lived_elsewhere_last_5_years', 'lived_in_other_country_last_5_years'))
    ask({
      key: 'previous_countries_of_residence',
      aliases: ['previous_residence_countries'],
      label:
        'Which countries did you live in during the past 5 years? For each: country, your status there, from and to (YYYY-MM-DD).',
      group: 'Personal details',
    });

  // ── Second inviter: IRCC requires every one of these once "A second
  // person is inviting you" is Yes (live 2026-10-18).
  if (yes('has_second_inviter', 'second_inviter')) {
    // Read the way the IRCC fill reads them (secondInviterAnswers: every
    // second_inviter_* / second_host_* variant and a second_inviter record).
    const second = secondInviterAnswers(p);
    const variants = (...ks: string[]) =>
      ks.flatMap((k) => [`second_inviter_${k}`, `second_host_${k}`]);
    ask({
      key: 'second_inviter_name',
      aliases: [
        ...FACT_KEY_SYNONYMS.second_inviter_name,
        ...variants('full_name'),
      ],
      label: "What is the second inviter's full name?",
      group: 'Host',
      read: () => second.name,
    });
    ask({
      key: 'second_inviter_relationship',
      aliases: variants('relationship'),
      label:
        'How is the second inviter related to you? (Family member, Friend, Conference or Organization)',
      group: 'Host',
      read: () => second.relationship,
    });
    ask({
      key: 'second_inviter_address',
      aliases: variants('address', 'home_address'),
      label:
        "What is the second inviter's full home address in Canada, with the postal code?",
      group: 'Host',
      read: () => second.address,
    });
    ask({
      key: 'second_inviter_phone',
      aliases: variants('phone', 'phone_number', 'telephone'),
      label: "What is the second inviter's telephone number?",
      group: 'Host',
      read: () => second.phone,
    });
    ask({
      key: 'second_inviter_phone_type',
      aliases: variants('phone_type', 'telephone_type'),
      label:
        "Is the second inviter's telephone a home, cell or other number? (Residence, Cellular or Other)",
      group: 'Host',
      read: () => second.phoneType,
    });
    ask({
      key: 'second_inviter_email',
      aliases: variants('email', 'email_address'),
      label: "What is the second inviter's email address?",
      group: 'Host',
      read: () => second.email,
    });
  }

  // ── A child 16 or under: IRCC's /minors-guardian (live 2026-10-31). The
  // fill writes only these explicit answers (canada-ircc.ts).
  if (sixteenOrUnder(p)) {
    ask({
      key: 'minor_travelling_with_guardian',
      label:
        'Is the child travelling to Canada with a parent or legal guardian? (Yes/No)',
      group: 'Travel',
    });
    if (yes('minor_travelling_with_guardian'))
      ask({
        key: 'minor_guardians_travelling',
        label:
          'Is the child travelling with both parents or legal guardians, or with one? (Both/One)',
        group: 'Travel',
      });
    if (no('minor_travelling_with_guardian'))
      ask({
        key: 'minor_travelling_without_guardian',
        label:
          'Is the child travelling alone, or with someone else? (Alone/With someone else)',
        group: 'Travel',
      });
  }

  // ── Medical: IRCC's workMedicalJobs, shown for some residence rows the
  // fill writes (live 2026-10-31; trrtAsksMedicalJobs).
  if (trrtAsksMedicalJobs(p))
    ask({
      key: 'work_in_public_health_job',
      aliases: ['public_health_occupation', 'public_health_job'],
      label:
        'Do you intend to work in Canada in a job where public health must be protected (health care, clinical laboratory, child care, primary or secondary school, in-home caregiving, agriculture)? (Yes/No)',
      group: 'Medical',
    });

  /** The question's Yes note on a field holding a Yes. */
  const withYesNote = (q: IrccQuestion, f: PrefilledFormField) => {
    if (q.yesNote && intakeAnswerIsYes(f.value) === true) {
      f.note = q.yesNote;
      f.needsReview = true;
    }
  };

  for (const q of questions) {
    const keys = new Set([q.key, ...(q.aliases ?? [])]);
    let value = '';
    for (const k of keys) {
      value = displayAnswer(p[k]);
      if (value) break;
    }
    if (!value && q.read) value = displayAnswer(q.read());
    // A list or record under the key (["Sajawal"]) is an answer the IRCC
    // fill reads as it is; the form has no text for it.
    const structured = [...keys].some(
      (k) => p[k] !== null && typeof p[k] === 'object',
    );
    if (!value && structured) continue;
    // The same question under a key of the form's own (carried from the
    // intake with its Forms label, or named by the generator) counts too.
    const label = q.label.trim().toLowerCase();
    const existing = fields.filter(
      (f) => keys.has(f.key) || (f.label ?? '').trim().toLowerCase() === label,
    );
    if (existing.length > 0) {
      // The generator wrote it. Complete an empty one, or flag it when
      // nothing answers it so the applicant sees it is theirs to fill.
      for (const f of existing) {
        if (f.value.trim()) {
          withYesNote(q, f);
          continue;
        }
        if (value) {
          f.value = value;
          f.source = 'profile';
          withYesNote(q, f);
        } else if (!q.settled?.()) {
          markUnanswered(f);
        }
      }
      continue;
    }
    if (value) {
      const f: PrefilledFormField = {
        key: q.key,
        label: q.label,
        value,
        group: q.group,
        source: 'profile',
      };
      withYesNote(q, f);
      fields.push(f);
      continue;
    }
    if (q.settled?.()) continue;
    const f: PrefilledFormField = {
      key: q.key,
      label: q.label,
      value: '',
      group: q.group,
    };
    markUnanswered(f);
    fields.push(f);
  }
}

/** Empty, nobody's answer yet, and the applicant's to give. */
function markUnanswered(f: PrefilledFormField) {
  delete f.source;
  f.needsReview = true;
  f.note = f.note || UNANSWERED_NOTE;
}
