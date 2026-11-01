import { NO_HOST_NOTE_LABEL } from './canada-ircc'; // registers the visitor mapping this one extends
import {
  registerPortalFillVariant,
  resolvePortalFill,
  resolvePortalFillExtras,
  type FillFieldMapping,
  type ManualFieldNote,
  type PortalPageInfo,
} from '../../../strategies/portal-integration/portal-fill.registry';
import { declared, pick, pickText, type Profile } from './ircc-profile';

/**
 * Canada super visa (registry `ca-super-visa`) on IRCC tr-rt.
 *
 * IRCC takes the super visa in the same Portal temporary-residence
 * application as the visitor visa: canada.ca's super visa "apply" page sends
 * applicants to the IRCC Portal ("I want to apply for: Visitor visa or super
 * visa" → "To visit my children or grandchildren for more than 6 months
 * (super visa)"), and the form is the visitor form — the tr-rt bundle has no
 * super-visa-only question (no insurance, income or IME field). So this is the
 * visitor mapping (canada-ircc.ts), every write unchanged, plus:
 *
 *  - /purpose: the visitor mapping answers "I want to apply for: Visitor
 *    visa" (464) and the visa purpose from the host; here the purpose is
 *    always FAMILY_MORE_THAN_SIX (472), the route tr-rt sends to
 *    /application-type/super-visa. Both radios recorded live 2026-10-18.
 *  - /purpose text: tr-rt caps it at 475 characters (`max475Chars`); a longer
 *    composed description is left for the applicant to shorten.
 *  - /inviter-info: the host is the applicant's child or grandchild by
 *    definition, so the relationship is "Family member" unless the profile
 *    says otherwise.
 *  - Documents (/doc-upload) and the representative page are the applicant's:
 *    listed in coverage with what the profile says about insurance, the
 *    host's income, a co-signer and the medical exam.
 */

const PURPOSE = '/purpose';
const REPRESENTATIVE = '/representative';
const INVITER = '/inviter-info';
const DOCS = '/doc-upload';

export const SUPER_VISA_ID = 'ca-super-visa';

/** tr-rt's `visitDetails` limit (validation `max475Chars`). */
const PURPOSE_MAX = 475;

/** The visitor mapping's visa purpose, answered "super visa" (472, live 2026-10-18). */
const SUPER_VISA_PURPOSE_ANSWER = (f: FillFieldMapping): FillFieldMapping => ({
  ...f,
  label: 'Visa type: super visa for a parent or grandparent',
  derive: () =>
    'Visit children or grandchildren for more than 6 months (super visa)',
});

/** A super visa host is the applicant's child or grandchild. */
function withHostIsFamily(f: FillFieldMapping): FillFieldMapping {
  const base = f.derive;
  return {
    ...f,
    derive: (p) => base?.(p) ?? 'Family member',
  };
}

function buildMapping(visitor: FillFieldMapping[]): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  visitor.forEach((f) => {
    if (f.page === PURPOSE && f.profileKey === 'purpose_of_visit')
      out.push({ ...f, maxLength: PURPOSE_MAX });
    else if (f.page === INVITER && f.profileKey === 'inviter_relationship')
      out.push(withHostIsFamily(f));
    // The visitor mapping answers the visa purpose from the host; a super
    // visa is always "children or grandchildren for more than 6 months".
    else if (f.page === PURPOSE && f.profileKey === 'ircc_visa_purpose')
      out.push(SUPER_VISA_PURPOSE_ANSWER(f));
    else out.push(f);
  });
  return out;
}

// ── what the applicant does: profile facts the portal does not ask ──────────
const usesRepresentative = (p: Profile) =>
  declared(p, 'uses_representative', 'has_representative') === 'Yes' ||
  (declared(p, 'uses_representative', 'has_representative') === undefined &&
    !!pickText(p, 'representative_name'));

const amount = (p: Profile, ...keys: string[]): number | undefined => {
  const v = pick(p, ...keys);
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? Number(v.replace(/[^\d.]/g, ''))
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const cad = (n: number) => `CAD ${Math.round(n).toLocaleString('en-US')}`;

function insuranceNote(p: Profile): ManualFieldNote {
  const label = 'Proof of medical insurance';
  const has = declared(
    p,
    'has_super_visa_insurance',
    'has_medical_insurance',
    'has_travel_medical_insurance',
  );
  const rule =
    'A super visa needs private health insurance valid for at least 1 year from entry, with at least $100,000 of emergency cover.';
  if (has !== 'Yes')
    return { page: DOCS, label, reason: 'not_in_profile', note: rule };
  // The intake records `medical_insurance_months` (and its aliases); a
  // 6-month policy recorded there gave no warning (audit 2026-10-19).
  const months = amount(
    p,
    'medical_insurance_months',
    'insurance_duration_months',
    'insurance_validity_months',
    'medical_insurance_duration_months',
    'travel_medical_insurance_duration_months',
  );
  const cover = amount(
    p,
    'medical_insurance_coverage_cad',
    'insurance_coverage_cad',
    'insurance_coverage_amount',
    'travel_medical_insurance_coverage_cad',
  );
  const problems: string[] = [];
  if (months !== undefined && months < 12)
    problems.push(
      `Your policy is recorded as ${months} months; it must be valid for at least 1 year from entry.`,
    );
  if (cover !== undefined && cover < 100000)
    problems.push(
      `Your cover is recorded as ${cad(cover)}; it must be at least $100,000.`,
    );
  return {
    page: DOCS,
    label,
    reason: 'fill_yourself',
    note: problems.length ? problems.join(' ') : rule,
  };
}

function hostIncomeNote(p: Profile): ManualFieldNote {
  const income = amount(
    p,
    'host_annual_income_cad',
    'host_income_cad',
    'host_income',
    'inviter_annual_income_cad',
  );
  const coSigner = pickText(
    p,
    'co_signer_name',
    'cosigner_name',
    'host_co_signer',
  );
  const coSigns =
    !!coSigner ||
    declared(p, 'has_co_signer', 'host_spouse_co_signs') === 'Yes';
  const parts = [
    "Your host's most recent notice of assessment (or T4/T1, or employment letter) showing at least the minimum necessary income for their family size.",
    income !== undefined
      ? `Recorded income: ${cad(income)} a year.`
      : undefined,
    coSigns
      ? `${coSigner ?? "Your host's spouse or partner"} co-signs: add their income proof too.`
      : undefined,
  ].filter(Boolean);
  return {
    page: DOCS,
    label: "Proof of your host's income",
    reason: 'fill_yourself',
    note: parts.join(' '),
  };
}

function medicalExamNote(p: Profile): ManualFieldNote {
  const done = declared(
    p,
    'ime_completed',
    'immigration_medical_exam_completed',
    'upfront_medical_exam_completed',
  );
  return {
    page: DOCS,
    label: 'Proof of your immigration medical exam',
    reason: 'fill_yourself',
    note:
      done === 'No'
        ? 'A super visa needs a medical exam with an IRCC panel physician: book it before you apply and upload the confirmation.'
        : 'Upload the confirmation from your IRCC panel physician.',
  };
}

function superVisaNotes(p: Profile): ManualFieldNote[] {
  const notes: ManualFieldNote[] = [
    {
      page: PURPOSE,
      label: 'Super visa',
      reason: 'fill_yourself',
      note: 'If the portal does not already show "super visa" as your visa type, choose it: "To visit my children or grandchildren for more than 6 months".',
    },
    {
      page: DOCS,
      label: 'Letter of invitation from your child or grandchild',
      reason: 'fill_yourself',
      note: 'Signed by your host, promising financial support for your stay, with the list and number of people in their household (each name and date of birth).',
    },
    hostIncomeNote(p),
    insuranceNote(p),
    medicalExamNote(p),
    {
      page: DOCS,
      label: "Proof of your host's status in Canada",
      reason: 'fill_yourself',
      note: 'Their Canadian citizenship document, permanent resident card or status card.',
    },
    {
      page: DOCS,
      label: 'Proof you are the parent or grandparent',
      reason: 'fill_yourself',
      note: "Your host's birth or baptismal certificate, or another official document naming you as their parent or grandparent.",
    },
  ];
  // The representative page itself is the visitor mapping's (canada-ircc.ts
  // fills it and lists what it leaves); only the IMM 5476 upload is ours.
  if (usesRepresentative(p))
    notes.push({
      page: DOCS,
      label: 'Use of a Representative (IMM 5476)',
      reason: 'fill_yourself',
      note: 'Signed by you and your representative.',
    });
  return notes;
}

function pagesWith(visitor: PortalPageInfo[]): PortalPageInfo[] {
  const out: PortalPageInfo[] = [];
  for (const pg of visitor) {
    out.push(pg);
    if (pg.page === PURPOSE && !visitor.some((v) => v.page === REPRESENTATIVE))
      out.push({ page: REPRESENTATIVE, title: 'Representative' });
  }
  out.push({ page: DOCS, title: 'Documents' });
  return out;
}

const visitor = resolvePortalFill('ircc');
const visitorExtras = resolvePortalFillExtras('ircc');
if (!visitor) throw new Error('canada-ircc must register the ircc mapping');

export const IRCC_SUPER_VISA_MAPPING = buildMapping(visitor);

registerPortalFillVariant('ircc', SUPER_VISA_ID, IRCC_SUPER_VISA_MAPPING, {
  ...visitorExtras,
  pages: pagesWith(visitorExtras.pages ?? []),
  left: (p, exclude) => [
    // The host (children, the Canadian business) is always the inviter
    // here: the visitor's no-host note does not apply.
    ...(visitorExtras.left?.(p, exclude) ?? []).filter(
      (n) => n.label !== NO_HOST_NOTE_LABEL,
    ),
    ...superVisaNotes(p),
  ],
});
