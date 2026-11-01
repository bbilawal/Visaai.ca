import {
  answeredFormFacts,
  intakeAnswerIsYes,
  type PrefilledFormField,
} from '@visaai/types';
import {
  comparableValue,
  isApplicantEmploymentKey,
  isOccupationKey,
  isRetiredProfile,
  otherPartyValueSet,
  type OtherPartyDocument,
} from './applicant-guards';
import { namesMatch } from './subject-attribution';
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
  return fields;
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
const CNIC = /\b(\d{5})[-\s]?(\d{7})[-\s]?(\d)\b/;

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
  for (const [type, doc] of Object.entries(ctx.documentFieldsByType)) {
    const isIdDoc = ID_DOC_TYPE.test(type);
    for (const [k, v] of Object.entries(doc)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const s = String(v).trim();
      const m = CNIC.exec(s);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      // A bare DocumentNumber on a passport is the passport number — only an
      // identity-card document's number is the national ID.
      if (isIdDoc && NATIONAL_ID_KEYS.test(k) && /\d{5,}/.test(s)) return s;
    }
  }
  return null;
}

const SEX_KEY = /^(applicant_)?(sex|gender)$/;
const PASSPORT_TYPE_KEY = /^passport_(type|document_type)$/;
const NATIONAL_ID_FIELD =
  /^(national_id(entity)?(_document)?(_number)?|national_identity_(document_)?number|identity_document_number|cnic(_number)?)$/;

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
    ctx.profile.no_travel_history === true;
  if (!noTravel) return;
  for (const f of fields) {
    if (TRAVEL_HISTORY_KEY.test(f.key) && !f.value.trim()) {
      f.value = 'None';
      f.source = 'profile';
    }
  }
}

// ── 5. contact ownership ─────────────────────────────────────────────────────

function flagForeignContact(
  fields: PrefilledFormField[],
  ctx: FinalizeContext,
) {
  const owner = ctx.accountProfile.full_name;
  if (typeof owner !== 'string' || !owner.trim() || !ctx.applicantName) return;
  if (namesMatch(ctx.applicantName, owner)) return;

  const pairs: Array<[RegExp, unknown, string]> = [
    [/email/, ctx.accountProfile.email, 'email address'],
    [/phone|telephone|mobile/, ctx.accountProfile.phone, 'phone number'],
  ];
  for (const f of fields) {
    for (const [re, accountValue, what] of pairs) {
      if (!re.test(f.key) || !f.value.trim()) continue;
      if (comparableValue(f.value) !== comparableValue(accountValue)) continue;
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

  for (const field of fields) {
    if (!PURPOSE_FIELD.test(field.key) || !field.value.trim()) continue;
    const composed = composePurposeOfVisit(stayFacts, field.value);
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
  /^((?:eldest_|youngest_|other_)?(?:son|daughter|child|sibling|brother|sister|family_member|dependant|dependent|relative))_(\d+)_(.+)$/;
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

  for (const child of children) {
    const name = personName(child);
    const group = named.find(
      (g) => findByName([{ name: g.name }], name) !== null,
    );
    const prefix = group ? `${group.prefix}_${group.n}` : `child_${++maxChild}`;
    const label = group ? group.name : name;
    if (!group) {
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
    if (fields.some((f) => keys.has(f.key))) continue;
    const display = displayAnswer(value);
    if (!display) continue;
    fields.push({
      key: spec.key,
      label: spec.form!.label,
      value: display,
      group: spec.form!.group,
      source: 'profile',
    });
  }
}

function displayAnswer(v: unknown): string {
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
  if (typeof v === 'number') return String(v);
  return '';
}
