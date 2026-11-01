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
import {
  portalFillExtras,
  type FillFieldMapping,
  type PortalFillMapping,
} from '../../strategies/portal-integration/portal-fill.registry';
import { plannedStay } from '@visaai/types';
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
    if (p.given_name == null) p.given_name = given;
    if (p.family_name == null) p.family_name = family;
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
  const written = new Map<string, string>();
  const out: Array<{
    field: FillFieldMapping;
    value: string;
    selector: string;
  }> = [];
  for (const field of mapping) {
    if (exclude.has(field.profileKey)) continue;
    if (field.parent != null) {
      const parentValue = written.get(field.parent);
      if (parentValue == null) continue;
      if (field.parentValue != null && parentValue !== field.parentValue)
        continue;
    }
    const value = resolveFillValue(field, q);
    if (value == null) continue;
    // A radio question names one input per answer; the answer picks it. An
    // answer with no input of its own is not written.
    const selector = field.choices ? field.choices[value] : field.selector;
    if (!selector) continue;
    if (!written.has(field.profileKey)) written.set(field.profileKey, value);
    out.push({ field, value, selector });
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
    if (f.parent != null) {
      const pv = written.get(f.parent);
      if (pv == null) continue;
      if (f.parentValue != null && pv !== f.parentValue) continue;
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
    pages.get(f.page)?.left.push({
      label,
      reason: f.declaration ? 'needs_your_answer' : 'not_in_profile',
    });
  }

  if (extras.left) {
    for (const n of extras.left(q)) {
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
  return normalize ? normalize(p) : p;
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
      ...(field.reveal ? { reveal: true } : {}),
      ...(field.dialog ? { dialog: true } : {}),
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
  if (!formFields || formFields.length === 0) return profile;
  const mappedKeys = new Set(mapping.map((f) => f.profileKey));
  const declarationKeys = new Set(
    mapping.filter((f) => f.declaration).map((f) => f.profileKey),
  );
  const out: ProfileData = { ...profile };
  for (const f of formFields) {
    if (!mappedKeys.has(f.key)) continue;
    // A legal declaration is the applicant's own answer: from their profile
    // or typed by them on the Forms page. A value the form generator inferred
    // (or anyone else entered) never stands in for it.
    if (
      declarationKeys.has(f.key) &&
      f.source !== 'profile' &&
      f.source !== 'applicant'
    )
      continue;
    out[f.key] = f.value == null ? '' : String(f.value);
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

function splitName(fullName?: string): { given: string; family: string } {
  if (!fullName) return { given: '', family: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { given: parts[0], family: '' };
  return {
    given: parts.slice(0, -1).join(' '),
    family: parts[parts.length - 1],
  };
}
