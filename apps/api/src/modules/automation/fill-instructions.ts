import type {
  PortalFillCoverage,
  PortalFillPageCoverage,
  PreflightMappingInput,
  PrefilledFormField,
  PrefilledFormPayload,
} from '@visaai/types';
import type { FillInstruction } from './automation.types';
import { uploadSelectorsFor } from './portal-upload-selectors';
import { resolveFillValue } from './fill-transforms';
import { toIso3 } from './portal-fills/country-names';
import {
  parentValueMatches,
  portalFillExtras,
  scopedSelector,
  type FillFieldMapping,
  type PortalFillMapping,
} from '../../strategies/portal-integration/portal-fill.registry';
import { isoDayMs, plannedStay } from '@visaai/types';
import { composePurposeOfVisit } from '../shared/profile/purpose-description';

export type ProfileData = Record<string, unknown>;

/**
 * Generic, country-agnostic fill builder. Turns a portal's field-mapping (data,
 * resolved from the country strategy's portal) + the applicant profile into fill
 * steps. Replaces the hardcoded buildCanadaTrvInstructions; Canada's IRCC mapping
 * is now registered data (see automation/portal-fills/canada-ircc.ts).
 */
/** Universal normalization: derive given/family name from a full name if absent. */
function normalizeProfile(profile: ProfileData): ProfileData {
  const p: ProfileData = { ...profile };
  if (p.given_name == null || p.family_name == null) {
    const { given, family } = splitName(
      typeof p.full_name === 'string' ? p.full_name : undefined,
    );
    // Only a name actually derived: a blank under the canonical key would
    // win over a mapping's own reading of an alias (surname, first_name, …).
    if (p.given_name == null && given) p.given_name = given;
    if (p.family_name == null && family) p.family_name = family;
  }
  normalizeStay(p);
  normalizePurpose(p);
  return p;
}

/**
 * Stay dates under the canonical keys the portal mappings read, and the day
 * count derived from them (#20). The interview records dates under whatever
 * key it chose (`intended_arrival_date`, …); a mapping that reads
 * `planned_entry_date` would otherwise write nothing. A stored
 * `duration_of_stay_days` goes stale when a date is corrected, so whenever both
 * dates are readable the count is recomputed from them.
 */
function normalizeStay(p: ProfileData): void {
  const stay = plannedStay(p);
  if (p.planned_entry_date == null && stay.entryDate) {
    p.planned_entry_date = stay.entryDate;
  }
  if (p.planned_departure_date == null && stay.departureDate) {
    p.planned_departure_date = stay.departureDate;
  }
  if (stay.days !== null) p.duration_of_stay_days = String(stay.days);
}

/**
 * The purpose text a portal receives is a description with the trip's dates,
 * not the interview's short phrase (#51). Composed deterministically (see
 * purpose-description.ts) so the preflight lock hash is reproducible.
 *
 * A blank value is left blank — whoever blanked it on the form meant it — and a
 * text that already states the dates is left as written.
 */
function normalizePurpose(p: ProfileData): void {
  const current = p.purpose_of_visit;
  if (typeof current === 'string' && current.trim() === '') return;
  if (current != null && typeof current !== 'string') return;
  const composed = composePurposeOfVisit(p, current ?? null);
  if (composed) p.purpose_of_visit = composed;
}

/**
 * Every mapping entry that writes for this profile, with its value, in mapping
 * (= portal) order. One resolution for the fill, the preflight lock and the
 * coverage report.
 *
 * A child entry (`parent`) is written only when its parent entry is written —
 * with `parentValue` when given. IRCC reveals follow-up questions only once the
 * parent radio is answered, so a follow-up whose parent is not answered (no
 * data, or the consultant marked it not applicable) is not on the page, and
 * waiting for it would stop the run.
 */
export function resolveMappings(
  mapping: PortalFillMapping,
  profile: ProfileData,
  exclude: ReadonlySet<string> = new Set(),
): Array<{ field: FillFieldMapping; value: string; selector: string }> {
  const q = normalizedProfile(mapping, profile);
  // A group (one repeating section) stands or falls together.
  const excludedGroups = new Set(
    mapping
      .filter((f) => f.group && exclude.has(f.profileKey))
      .map((f) => f.group as string),
  );
  const written = new Map<string, string>();
  const out: Array<{
    field: FillFieldMapping;
    value: string;
    selector: string;
  }> = [];
  for (const field of mapping) {
    if (exclude.has(field.profileKey)) continue;
    if (field.group && excludedGroups.has(field.group)) continue;
    if (field.parent != null) {
      const parentValue = written.get(field.parent);
      if (parentValue == null) continue;
      if (!parentValueMatches(parentValue, field.parentValue)) continue;
    }
    const value = resolveFillValue(field, q);
    if (value == null) continue;
    // A radio question names one input per answer; the answer picks it. An
    // answer with no input of its own is not written.
    const css = field.choices ? field.choices[value] : field.selector;
    if (!css) continue;
    // A question-scoped control (eapp: one URL, one id, many questions).
    // Its <select> must list the answer's option, checked by the probe.
    // A date select's "Unknown" (a date known only to the year or month) is
    // chosen by its option TEXT: its option value is not the word (live
    // 2026-10-30: a parent born "1960" stopped the run with value_mismatch
    // on the month). Only the date transforms that can yield it.
    const unknownDatePart =
      value === 'Unknown' &&
      field.action === 'select' &&
      !field.op &&
      (field.transform === 'date_month' || field.transform === 'date_day');
    const option =
      field.action === 'select' && !field.op && !unknownDatePart
        ? { by: 'value' as const, value }
        : field.op === 'select_text' || unknownDatePart
          ? { by: 'text' as const, value }
          : undefined;
    const selector =
      field.labelMatch ||
      field.pageMatch ||
      field.principalForm ||
      field.keepExisting ||
      field.dependantForm
        ? scopedSelector(
            css,
            field.labelMatch,
            field.pageMatch,
            option,
            field.principalForm,
            field.keepExisting,
            field.dependantForm,
          )
        : css;
    if (!written.has(field.profileKey)) written.set(field.profileKey, value);
    out.push({
      field: unknownDatePart ? { ...field, op: 'select_text' } : field,
      value,
      selector,
    });
  }
  return out;
}

/**
 * Page by page: how many writes the assistant makes, and what it leaves for
 * the applicant and why. A mapped question with no value is "needs your
 * answer" when it is a legal declaration and "not in your VisaAI data"
 * otherwise; follow-ups of an unanswered question are not listed (the portal
 * does not show them either); the portal's own notes (`left`) add the parts
 * the assistant never fills.
 */
export function portalFillCoverage(
  mapping: PortalFillMapping,
  profile: ProfileData,
  exclude: ReadonlySet<string> = new Set(),
): PortalFillCoverage {
  const extras = portalFillExtras(mapping);
  const resolved = resolveMappings(mapping, profile, exclude);
  const written = new Map<string, string>();
  for (const r of resolved)
    if (!written.has(r.field.profileKey))
      written.set(r.field.profileKey, r.value);

  const order: string[] = (extras.pages ?? []).map((x) => x.page);
  for (const f of mapping)
    if (f.page && !order.includes(f.page)) order.push(f.page);
  const pages = new Map<string, PortalFillPageCoverage>();
  for (const page of order) {
    pages.set(page, {
      page,
      title: extras.pages?.find((x) => x.page === page)?.title ?? page,
      filled: 0,
      left: [],
    });
  }
  for (const r of resolved) {
    const pg = r.field.page ? pages.get(r.field.page) : undefined;
    if (pg) pg.filled += 1;
  }

  const q = normalizedProfile(mapping, profile);
  const listed = new Set<string>();
  for (const f of mapping) {
    if (!f.page || f.silent || exclude.has(f.profileKey)) continue;
    if (written.has(f.profileKey) || listed.has(f.profileKey)) continue;
    // A field gated on an answer the applicant does not have (no
    // representative → no IMM 5476 slot) is not theirs to fill either.
    if (f.requires && !q[f.requires]) continue;
    if (f.onlyIf && !f.onlyIf(q)) continue;
    if (f.parent != null) {
      const pv = written.get(f.parent);
      if (pv == null) continue;
      if (!parentValueMatches(pv, f.parentValue)) continue;
    }
    listed.add(f.profileKey);
    const label = f.label
      .replace(/ — (year|month|day)$/, '')
      .replace(/ \(confirm\)$/, '');
    // Present but too long for the portal: the applicant shortens it.
    const unlimited =
      f.maxLength != null
        ? resolveFillValue({ ...f, maxLength: undefined }, q)
        : null;
    if (unlimited != null && f.maxLength != null) {
      pages.get(f.page)?.left.push({
        label,
        reason: 'fill_yourself',
        note: `Longer than the ${f.maxLength} characters IRCC accepts (${unlimited.length}); shorten it and enter it yourself.`,
      });
      continue;
    }
    // Recorded, but nothing of it is in letters IRCC accepts (its boxes take
    // the Roman alphabet only): the applicant types it.
    if (
      f.transform === 'ircc_text' &&
      resolveFillValue({ ...f, transform: undefined, maxLength: undefined }, q) != null
    ) {
      pages.get(f.page)?.left.push({
        label,
        reason: 'fill_yourself',
        note: 'Your answer is not in Roman letters, which this IRCC box requires: type it yourself in English or French.',
      });
      continue;
    }
    pages.get(f.page)?.left.push({
      label,
      reason: f.declaration ? 'needs_your_answer' : 'not_in_profile',
    });
  }

  if (extras.left) {
    for (const n of extras.left(q, exclude)) {
      pages.get(n.page)?.left.push({
        label: n.label,
        reason: n.reason,
        ...(n.note ? { note: n.note } : {}),
      });
    }
  }
  return { pages: [...pages.values()] };
}

/** The profile exactly as the mapping reads it. */
function normalizedProfile(
  mapping: PortalFillMapping,
  profile: ProfileData,
): ProfileData {
  const p = normalizeProfile(profile);
  const normalize = portalFillExtras(mapping).normalize;
  return normalize ? normalize(p, profile) : p;
}

export function buildInstructionsFromMapping(
  mapping: PortalFillMapping,
  profile: ProfileData,
): FillInstruction[] {
  const instructions: FillInstruction[] = [];
  let stepCounter = 0;
  const nextId = () => `step-${++stepCounter}`;

  for (const { field, value, selector } of resolveMappings(mapping, profile)) {
    instructions.push({
      stepId: nextId(),
      action: field.action,
      selector,
      value,
      label: field.label,
    });
  }

  return instructions;
}

/**
 * The SAME resolution as buildInstructionsFromMapping — identical name
 * normalization, identical `requires` gating, identical skip-empty rule — but
 * emitted as the preflight/write-plan shape.
 *
 * These two builders MUST agree. The preflight lock is a hash over these
 * mappings, and WritePlanBuilder writes `targetField` with `mappedValue`; if
 * this produced a different set than the fill path, a consultant would be
 * locking a review of fields that are not the fields that get written. Sharing
 * one resolution is what makes the lock mean what it claims to mean.
 */
export function buildMappingInputs(
  mapping: PortalFillMapping,
  profile: ProfileData,
  exclude: ReadonlySet<string> = new Set(),
): PreflightMappingInput[] {
  return resolveMappings(mapping, profile, exclude).map(
    ({ field, value, selector }): PreflightMappingInput => ({
      fieldKey: field.profileKey,
      targetField: selector,
      mappedValue: value,
      category: field.category,
      // Page-bound portals carry the portal label: one value can feed several
      // writes (DOB → year/month/day), and fieldKey alone cannot tell them apart.
      ...(field.page ? { page: field.page, label: field.label } : {}),
      ...(field.op ? { op: field.op } : {}),
      // An unverified selector is waited for, never probed (see
      // FillFieldMapping.unverified): same wire shape as a revealed field.
      ...(field.reveal || field.unverified ? { reveal: true } : {}),
      ...(field.dialog ? { dialog: true } : {}),
      ...(field.awaitOptions ? { awaitOptions: true } : {}),
      ...(field.declaration ? { declaration: true } : {}),
    }),
  );
}

/**
 * Overlay the applicant's SAVED application form (prefilled_form_json) onto the
 * profile, for the portal-mapped keys only.
 *
 * The saved form is the reviewed copy: the applicant (and, since the editable
 * review, the consultant) corrects values there. Deriving mappings from the
 * intake profile alone meant a consultant locked — and the fill would have
 * written — a value the applicant had already corrected (prod: duration of
 * stay 56 shown, 62 saved).
 *
 * Rules:
 *  - a mapped key PRESENT in the form wins, even when blank (the person who
 *    blanked it meant it; the skip-empty rule then drops the field);
 *  - a mapped key ABSENT from the form falls back to the profile;
 *  - non-mapped form keys are never copied, so the form cannot widen the set
 *    of written fields or flip a `requires` gate (form yes/no answers are
 *    strings — "No" is truthy).
 */
export function applyPrefillOverrides(
  mapping: PortalFillMapping,
  profile: ProfileData,
  formFields: ReadonlyArray<PrefilledFormField> | null | undefined,
): ProfileData {
  // No Forms page yet: the interview's own answers still get the same
  // readings (a child's country of birth, the biometrics expiry), or they
  // reached IRCC only once a form had been generated.
  if (!formFields || formFields.length === 0) return withFormSynonyms(profile);
  const mappedKeys = new Set(mapping.map((f) => f.profileKey));
  const declarationKeys = new Set(
    mapping.filter((f) => f.declaration).map((f) => f.profileKey),
  );
  const out: ProfileData = { ...profile };
  // A person's correction of a plain fact (PERSON_CORRECTED_SYNONYMS).
  const corrected = personSynonymEdits(formFields, mappedKeys);
  for (const f of formFields) {
    if (!mappedKeys.has(f.key)) {
      // The form generator names its own keys (city_of_birth,
      // father_given_name), and the portal derivations read several aliases
      // of each fact. An applicant who skipped the interview and filled the
      // Forms page had 84 answers there but only 42 reached the IRCC fill
      // (dry run 2026-10-18). Such a key joins the profile when the profile
      // has nothing under it, and only as the applicant's own answer or one
      // read from their document — never an inference, and never anyone
      // else's edit, since it may be a declaration alias.
      const v = f.value == null ? '' : String(f.value).trim();
      const cur = profile[f.key];
      if (
        v !== '' &&
        (f.source === 'applicant' ||
          f.source === 'document' ||
          f.source === 'profile') &&
        isEmpty(cur)
      )
        out[f.key] = v;
      continue;
    }
    // A legal declaration is the applicant's own answer: from their profile
    // or typed by them on the Forms page. A value the form generator inferred
    // (or anyone else entered) never stands in for it.
    if (
      declarationKeys.has(f.key) &&
      f.source !== 'profile' &&
      f.source !== 'applicant'
    )
      continue;
    const value = f.value == null ? '' : String(f.value);
    // A value the form generator copied in (from the profile, a document or
    // its own inference) is a snapshot. When the profile now holds the same
    // fact, the profile is newer: an applicant corrected their marriage date
    // 1999 -> 1988 in the interview, yet the form's copy of the old OCR value
    // was locked by the consultant and typed into IRCC (dry run 2026-10-16).
    // Only a person's edit on the form (applicant, consultant) overrides the
    // profile; a snapshot only fills keys the profile lacks.
    const generated =
      f.source === 'profile' ||
      f.source === 'document' ||
      f.source === 'inferred';
    const current = profile[f.key];
    if (
      generated &&
      current !== undefined &&
      current !== null &&
      String(current).trim() !== ''
    )
      continue;
    // An empty form field erases the profile's answer only when a person
    // cleared it (applicant or consultant). A form generated before the
    // answer existed holds the key empty; letting that win hid answers given
    // later in the interview (dry run 2026-10-16: spouse date and country of
    // birth, native language and military service all answered, all shown
    // to the consultant as "not in profile").
    if (
      value.trim() === '' &&
      f.source !== 'applicant' &&
      f.source !== 'consultant'
    )
      continue;
    out[f.key] = value;
  }
  const merged = withFormSynonyms(out);
  for (const [to, v] of corrected) merged[to] = v;
  return merged;
}

/**
 * Forms-page names whose correction by a person (applicant or consultant)
 * outranks the profile's answer under the name the portal derivation reads.
 *
 * Everywhere else an interview answer wins over a Forms-page synonym, and a
 * consultant's edit of an unmapped key does not count (#158). The residence
 * date is the exception: the residence row reads the profile's
 * residence_since first, so correcting "Living there since" on the Forms page
 * changed nothing on IRCC (prod 2026-10-18, super visa app 61f16bb5: profile
 * residence_since 1988-09-16, the marriage date, while the form said
 * 1968-10-09). It is a plain fact, never a declaration, so a consultant's
 * correction counts too. The same holds for the medical exam's reference
 * number: a stale profile number under one name must not outrank the
 * applicant's correction under another (the IME/UMI format gate is the
 * mapping's transform, applied to whichever value wins).
 */
const MEDICAL_NUMBER_FORM_KEYS = [
  'medical_exam_number',
  'medical_exam_reference_number',
  'ime_number',
  'umi_number',
  'medical_number',
  'medical_reference_number',
];
const PERSON_CORRECTED_SYNONYMS: ReadonlyArray<
  [from: string, to: string, usable: (v: string) => boolean]
> = [
  ['residential_address_from_date', 'residence_since', usableResidenceSince],
  ['residential_address_since', 'residence_since', usableResidenceSince],
  // Onto the first key the medical number derivation reads.
  ...MEDICAL_NUMBER_FORM_KEYS.map(
    (k): [string, string, (v: string) => boolean] => [
      k,
      'medical_exam_number',
      () => true,
    ],
  ),
  // The Green Card number and Taiwan ID are written under ircc_ keys (IRCC's
  // format), so a correction of the asked key must reach the profile.
  ['us_green_card_number', 'us_green_card_number', () => true],
  ['taiwan_personal_id_number', 'taiwan_personal_id_number', () => true],
];

function personSynonymEdits(
  formFields: ReadonlyArray<PrefilledFormField>,
  mappedKeys: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [from, to, usable] of PERSON_CORRECTED_SYNONYMS) {
    // A mapped target has its own form row; that row decides.
    if (out.has(to) || mappedKeys.has(to)) continue;
    const f = formFields.find((x) => x.key === from);
    if (!f || (f.source !== 'applicant' && f.source !== 'consultant')) continue;
    const v = f.value == null ? '' : String(f.value).trim();
    // Only a value its reader can use replaces the profile's: a free-text
    // residence date ("09/10/1968", "October 1968") would leave the row
    // without a date and drop every residence write.
    if (v !== '' && usable(v)) out.set(to, v);
  }
  return out;
}

/** An ISO calendar date, or "since birth" (read as the date of birth). */
function usableResidenceSince(v: string): boolean {
  if (/birth/i.test(v)) return true;
  return /^\d{4}-\d{2}-\d{2}/.test(v) && isoDayMs(v.slice(0, 10)) !== null;
}

/**
 * The Forms page's own name for a fact the portal derivations read under
 * another key (live 2026-10-18, a skipped interview). Applied only where the
 * target is empty, so an interview answer always wins.
 */
const FORM_SYNONYMS: ReadonlyArray<[from: string, to: string]> = [
  ['purpose_of_trip', 'purpose_of_visit'],
  ['current_occupation', 'occupation'],
  ['place_of_birth_city', 'city_of_birth'],
  ['place_of_birth_country', 'country_of_birth'],
  ['national_identity_document_number', 'national_id_number'],
  ['national_identity_document_country', 'national_id_country'],
  ['national_identity_document_issue_date', 'national_id_issue_date'],
  ['funds_available_for_stay', 'available_funds_cad'],
  ['host_telephone_number', 'host_phone'],
  ['host_email_address', 'host_email'],
  ['telephone_number', 'telephone'],
  ['residential_address_from_date', 'residence_since'],
  ['residential_address_since', 'residence_since'],
  ['residential_address_line_1', 'residential_street'],
  ['current_country_status', 'residence_status'],
  ['visa_refusal_or_denial', 'refused_or_ordered_to_leave'],
  ['visa_refusal_or_denial_details', 'refusal_details'],
  ['overstayed_or_unauthorized_work_study', 'immigration_violations'],
  ['witnessed_or_participated_in_abuse', 'ill_treatment'],
];

/** A scalar as text; objects and lists are not text answers. */
const asText = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : '';
const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v !== 'object' && asText(v).trim() === '');
const isNo = (v: unknown) => /^\s*no\s*$/i.test(asText(v));

/**
 * The Forms page keeps children as one line of text ("Mian Muhammad Sajawal
 * (son, born 1989-10-14, Pakistan); …"). Each entry becomes a child with
 * what it states: son/daughter, birth date, country, and "lives with me",
 * "lives in <country>", "coming" / "not coming" when written. Anything not
 * stated stays unknown, and IRCC lists that child for the applicant.
 */
export function childrenFromText(v: unknown): ProfileData[] {
  if (typeof v !== 'string') return [];
  const out: ProfileData[] = [];
  for (const raw of v.split(/;|\n/)) {
    const entry = raw.trim();
    const m = /^([^(]+?)\s*(?:\((.*)\))?\s*$/.exec(entry);
    if (!m || !m[1].trim()) continue;
    const name = m[1].trim();
    const parts = (m[2] ?? '').split(',').map((x) => x.trim());
    const child: ProfileData = { name };
    for (const part of parts) {
      const low = part.toLowerCase();
      const date = /(\d{4}-\d{2}-\d{2})/.exec(part);
      if (/^(son|daughter|step-?son|step-?daughter)$/.test(low))
        child.relationship = low;
      else if (date) child.date_of_birth = date[1];
      else if (
        /^(lives|living) (with me|at my address|with the applicant)/.test(low)
      )
        child.same_address = 'Yes';
      else if (/^(lives|living) in /.test(low)) {
        child.same_address = 'No';
        child.lives_in = part.replace(/^(lives|living) in /i, '');
      } else if (/^not (coming|travell?ing)/.test(low))
        child.coming_to_canada = 'No';
      else if (/^(coming|travell?ing) (to canada|with me)/.test(low))
        child.coming_to_canada = 'Yes';
      else if (/^[a-z][a-z .'-]+$/i.test(part) && !child.country_of_birth)
        child.country_of_birth = part;
    }
    out.push(child);
  }
  return out;
}

function withFormSynonyms(p: ProfileData): ProfileData {
  const out: ProfileData = { ...p };
  const fill = (to: string, v: unknown) => {
    if (isEmpty(out[to]) && !isEmpty(v)) out[to] = v;
  };
  // The form's funds row is a CAD amount only when its currency says so (or
  // says nothing). A PKR balance became "Money available (CAD): 4835403"
  // (live E2E 2026-10-18).
  const fundsCurrency =
    asText(p.funds_currency) || asText(p.available_funds_currency);
  const fundsNotCad =
    fundsCurrency.trim() !== '' &&
    !/^\s*(cad|c\$|canadian dollars?)\s*$/i.test(fundsCurrency);
  for (const [from, to] of FORM_SYNONYMS) {
    if (to === 'available_funds_cad' && fundsNotCad) continue;
    fill(to, p[from]);
  }
  // One combined question answered "No" answers each narrower one "No"; a
  // "Yes" does not say which, so the applicant answers those on IRCC.
  if (isNo(p.tuberculosis_contact_or_diagnosis)) {
    fill('tuberculosis', 'No');
    fill('tuberculosis_contact', 'No');
  }
  if (isNo(p.has_travel_history_last_10_years))
    fill('travelled_last_5_years', 'No');
  // Biometrics are valid for 10 years from the day they were given. The
  // interview asks that day; the portal's re-use answer reads the expiry.
  const enrolled = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(
    asText(p.biometrics_enrollment_date ?? p.biometrics_date).trim(),
  );
  // Given more than 10 years ago: not given "in the last 10 years", or the
  // portal would answer Yes from the date alone.
  if (enrolled) {
    const tenYearsAgo = new Date();
    tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
    const given = Date.UTC(
      Number(enrolled[1]),
      Number(enrolled[2]) - 1,
      Number(enrolled[3] ?? '01'),
    );
    if (
      given < tenYearsAgo.getTime() &&
      [
        'biometrics_given',
        'biometrics_given_before',
        'has_given_biometrics',
        'previous_biometrics',
      ].every((k) => isEmpty(p[k]))
    )
      fill('biometrics_given', 'No');
  }
  if (enrolled && isEmpty(p.biometrics_expiry_date))
    fill(
      'biometrics_valid_until',
      `${Number(enrolled[1]) + 10}-${enrolled[2]}-${
        enrolled[2] === '02' && enrolled[3] === '29'
          ? '28'
          : (enrolled[3] ?? '01')
      }`,
    );
  const education = asText(p.highest_level_of_education);
  if (
    /^\s*(none|no formal|primary|elementary|secondary|high school)/i.test(
      education,
    )
  )
    fill('has_post_secondary_education', 'No');
  if (isEmpty(out.children)) {
    const kids = childrenFromText(p.children_details);
    if (kids.length) out.children = kids;
  }
  // "Name: address" lines from the Forms page, onto the child of that name.
  const addresses = asText(p.children_addresses);
  if (addresses && Array.isArray(out.children)) {
    const norm = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .trim();
    const lines = addresses
      .split(/\n|;/)
      .map((l) => /^([^:]+):\s*(.+)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m);
    out.children = (out.children as unknown[]).map((c) => {
      if (!c || typeof c !== 'object') return c;
      const kid = c as ProfileData;
      if (!isEmpty(kid.address)) return kid;
      const name = norm(asText(kid.name));
      const hit = lines.find((m) => name && norm(m[1]) === name);
      return hit
        ? {
            ...kid,
            address: hit[2].trim(),
            same_address: kid.same_address ?? 'No',
          }
        : kid;
    });
  }
  // "Name: country" lines (or one country for every child) from the Forms
  // page, onto each child with no country of birth (live 2026-10-18).
  const births = asText(p.children_countries_of_birth).trim();
  if (births && Array.isArray(out.children)) {
    const norm = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z]+/g, ' ')
        .trim();
    const lines = births
      .split(/\n|;/)
      .map((l) => /^([^:]+):\s*(.+)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m);
    // One bare value is every child's country only when it IS a country
    // ("Pakistan"), not free text ("Both in Pakistan", "Lahore").
    const everyone =
      lines.length === 0 && toIso3(births) !== null ? births : '';
    const lacking = (out.children as unknown[]).filter(
      (c) =>
        !!c &&
        typeof c === 'object' &&
        isEmpty((c as ProfileData).country_of_birth) &&
        isEmpty((c as ProfileData).birth_country),
    );
    // One child without a country and one "Name: country" line: that line is
    // theirs even when the name is written differently.
    const onlyLine =
      lacking.length === 1 && lines.length === 1 ? lines[0][2].trim() : '';
    out.children = (out.children as unknown[]).map((c) => {
      if (!c || typeof c !== 'object') return c;
      const kid = c as ProfileData;
      if (!isEmpty(kid.country_of_birth) || !isEmpty(kid.birth_country))
        return kid;
      const name = norm(asText(kid.name));
      const hit = lines.find((m) => name && norm(m[1]) === name);
      const country = hit ? hit[2].trim() : onlyLine || everyone;
      return country ? { ...kid, country_of_birth: country } : kid;
    });
  }
  const en = p.can_communicate_in_english;
  const fr = p.can_communicate_in_french;
  if (!isEmpty(en) && !isEmpty(fr)) {
    const yes = (v: unknown) => /^\s*yes\s*$/i.test(String(v));
    fill(
      'official_language_ability',
      yes(en) && yes(fr)
        ? 'Both'
        : yes(en)
          ? 'English'
          : yes(fr)
            ? 'French'
            : 'Neither',
    );
  }
  return out;
}

export function buildInstructionsFromPrefill(
  payload: PrefilledFormPayload,
): FillInstruction[] {
  const instructions: FillInstruction[] = [];
  let counter = 0;
  const nextId = () => `step-${++counter}`;

  for (const field of payload.fields) {
    if (!field.value) continue;
    instructions.push({
      stepId: nextId(),
      action: 'fill',
      selector: `[name="${field.key}"], #${field.key}`,
      value: field.value,
      label: field.label || field.key,
    });
  }

  return instructions;
}

export function buildUploadInstructions(
  docs: Array<{ documentType: string; downloadUrl: string; fileName: string }>,
  startId: number,
): FillInstruction[] {
  const instructions: FillInstruction[] = [];
  let counter = startId;
  const nextId = () => `step-${++counter}`;

  if (docs.length === 0) return instructions;

  instructions.push({
    stepId: nextId(),
    action: 'info',
    selector: '',
    value: `Uploading ${docs.length} document${docs.length === 1 ? '' : 's'} from your vault…`,
    label: 'Document upload',
  });

  for (const doc of docs) {
    instructions.push({
      stepId: nextId(),
      action: 'upload',
      selector: uploadSelectorsFor(doc.documentType),
      value: doc.fileName,
      label: `Upload: ${doc.fileName}`,
      downloadUrl: doc.downloadUrl,
      fileName: doc.fileName,
    });
  }

  return instructions;
}

export function buildFinalReviewStep(startId: number): FillInstruction {
  return {
    stepId: `step-${startId + 1}`,
    action: 'pause',
    selector: '',
    value:
      'Review every field and uploaded file, then complete the payment, electronic signature, and final submission yourself. VisaAI never submits or pays on your behalf.',
    label: 'Manual review & submission',
  };
}

/**
 * A full name split for portals that ask for the halves, used only when the
 * profile has no given / family name of its own (identity documents now
 * record both as printed). A single name is the family name and the given
 * name stays blank: IRCC's rule for applicants with one name (audit
 * 2026-10-18 — SUKARNO went in as a given name with no family name).
 */
function splitName(fullName?: string): { given: string; family: string } {
  if (!fullName || !fullName.trim()) return { given: '', family: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { given: '', family: parts[0] };
  return {
    given: parts.slice(0, -1).join(' '),
    family: parts[parts.length - 1],
  };
}
