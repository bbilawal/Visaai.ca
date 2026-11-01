import {
  registerPortalFill,
  type FillFieldMapping,
  type ManualFieldNote,
} from '../../../strategies/portal-integration/portal-fill.registry';
import {
  isSeasonalAgriculturalWorker,
  isoDayMs,
  workPermitKindOf,
  workPermitPrincipalOf,
} from '@visaai/types';
import { declared, pickDate, pickText, type Profile } from './ircc-profile';
import {
  ANY_SELECT,
  EAPP_PAGE,
  EAPP_PAGES,
  NO,
  YES,
  accompanyingFamilyMemberEntry,
  ask,
  commonLeftNotes,
  countryOfResidenceEntry,
  declarationsTail,
  destinationProvinceEntry,
  dobDayEntry,
  dobMonthEntry,
  dobYearEntry,
  familyMemberCitizenOrPrEntry,
  familyStatusNo,
  familyStatusNote,
  maritalStatusEntry,
  passportCodeEntry,
  provinceCode,
  purposeEntry,
  representativeNote,
  stayLengthEntry,
  usPermanentResidentEntry,
  validPermitEntry,
} from './canada-ircc-eapp-common';

/**
 * Canada WORK PERMIT (registry `ca-work-permit`) — the same eligibility
 * questionnaire of IRCC's secure account ("eapp", /eapp/eapp) as the study
 * permit, on its Work branch. Recorded live 2026-10-30 (Modify my Answers on
 * a draft: S1 switched to Work, every work screen walked, then restored).
 *
 * A new work permit from outside Canada is applied for in the secure
 * account ("Apply to come to Canada" → this questionnaire → IMM 1295), not
 * on tr-rt. The screens every permit shares (screen 1, US PR, marital
 * status, the valid-permit screen, the declarations…) come from
 * canada-ircc-eapp-common.ts, exactly as the study permit answers them; the
 * portal facts are described in canada-ircc-study-eapp.ts.
 *
 * The Work branch, in order (codes recorded live):
 *  - S1 answerlist[1] "What would you like to do in Canada?" 7123 Work
 *    (never 7120 Study); [2] stay 7346 < 6 months / 7347 > 6 months;
 *  - S2 "lawful permanent resident of the United States" 991/997;
 *  - S3 "I have a job offer and my employer gave me an offer of employment
 *    number or LMIA number (or proof …)" 991/997;
 *  - S4 "What is the status of your job offer?" 7318 temporary < 1 year /
 *    7319 temporary ≥ 1 year / 7948 permanent;
 *  - S5 [1] work-permit-exempt categories, [2] public policy or special
 *    measure, [3] spouse / partner / dependent child of a worker, [4] recent
 *    graduate of a Canadian post-secondary school (PGWP), all 991/997;
 *  - S6 "spouse or common-law partner of a person who holds a study permit";
 *  - then the shared tail: marital status, destination, valid permit (7225
 *    No), the exchange / co-op / skilled-worker-family / scholarship screen,
 *    accompanying family member, criminality, medical, designated countries,
 *    the medical information screen, family member application, access
 *    radios (7343 No), biometrics, then fees / digital copies / payment
 *    (never answered) and "Review your answers", where the assistant stops.
 *
 * Nothing is answered from a guess, and nothing is answered from a study
 * fact: no 7120, no PAL/TAL, no DLI or post-secondary answer, and the
 * shared exchange / co-op / scholarship questions are left (the work
 * interview does not ask them, and a study answer left on a profile that
 * switched routes says nothing about this application).
 *
 * LEFT FOR THE APPLICANT (no fact VisaAI asks): the work-permit-exempt
 * categories, the PGWP graduate question, a permanent job offer (7948 is
 * never chosen), the exchange / co-op / scholarship questions, every
 * follow-up of a "Yes" not seen live.
 */

type Kind = ReturnType<typeof workPermitKindOf>;

const workStart = (p: Profile) =>
  pickDate(
    p,
    'work_start_date',
    'intended_work_start_date',
    'employment_start_date_in_canada',
  );
const workEnd = (p: Profile) =>
  pickDate(
    p,
    'work_end_date',
    'intended_work_end_date',
    'employment_end_date_in_canada',
  );

/** The work start plus `months`, as a UTC day; undefined without both dates. */
function workSpan(
  p: Profile,
  months: number,
): { endMs: number; startMs: number; boundMs: number } | undefined {
  const start = workStart(p);
  const end = workEnd(p);
  if (!start || !end) return undefined;
  const startMs = isoDayMs(start);
  const endMs = isoDayMs(end);
  if (startMs === null || endMs === null || endMs <= startMs) return undefined;
  const [y, m, d] = start.split('-').map(Number);
  // Clamp the day to the target month's last day: Aug 31 + 6 months is
  // Feb 28/29, not Mar 3 (Date.UTC would overflow; review 2026-10-30).
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const boundMs = new Date(
    Date.UTC(y, m - 1 + months, Math.min(d, lastDay)),
  ).getTime();
  return { startMs, endMs, boundMs };
}

/**
 * "How long are you planning to stay in Canada?" from the work dates:
 * 7347 more than six months, 7346 less. Exactly six months is left.
 */
export function workStayLength(p: Profile): string | undefined {
  const s = workSpan(p, 6);
  if (!s) return undefined;
  if (s.endMs > s.boundMs) return '7347';
  if (s.endMs < s.boundMs) return '7346';
  return undefined;
}

/** The number on file is a real one (not "none" / "not required"). */
const LMIA_NUMBER = /^\d{7}$/;
const OFFER_NUMBER = /^A\d{7}$/i;
const numberOf = (p: Profile, ...keys: string[]): string => {
  for (const k of keys) {
    const v = p[k];
    const t =
      typeof v === 'number' && Number.isFinite(v)
        ? String(v)
        : typeof v === 'string'
          ? v
          : '';
    if (t.trim()) return t.replace(/[\s-]/g, '');
  }
  return '';
};

/**
 * "I have a job offer and my employer gave me an offer of employment number
 * or LMIA number": Yes only for an employer-specific permit whose number is
 * on file (an LMIA's 7 digits, an offer's A + 7 digits); No for an open
 * work permit. Anything else (no number yet, "other") is the applicant's.
 */
export function jobOffer(p: Profile): string | undefined {
  const kind: Kind = workPermitKindOf(p);
  if (kind === 'open') return NO;
  if (kind === 'lmia')
    return LMIA_NUMBER.test(numberOf(p, 'lmia_number', 'lmia_file_number'))
      ? YES
      : undefined;
  if (kind === 'lmia_exempt')
    return OFFER_NUMBER.test(
      numberOf(
        p,
        'offer_of_employment_number',
        'employment_offer_number',
        'oe_number',
      ),
    )
      ? YES
      : undefined;
  return undefined;
}

/**
 * "What is the status of your job offer?": permanent (7948), or temporary
 * under a year (7318) / a year or more (7319) from the work dates — only
 * when the applicant said whether the offer is permanent or temporary. The
 * interview does not ask it yet, so the dates alone never decide it: a
 * permanent job with an end date on its LMIA is not "temporary" (review
 * 2026-10-30). Otherwise left for the applicant.
 */
export function offerStatus(p: Profile): string | undefined {
  const said = pickText(p, 'job_offer_status', 'job_offer_term');
  if (!said) return undefined;
  if (/perman/i.test(said)) return '7948';
  if (!/temporar/i.test(said)) return undefined;
  const s = workSpan(p, 12);
  if (!s) return undefined;
  return s.endMs >= s.boundMs ? '7319' : '7318';
}

const POLICY_KEYS = [
  'public_policy_or_special_measure',
  'public_policy',
  'special_measure',
];

/**
 * The applicant's own answer to the public policy declaration. The interview
 * asks "If yes, which one?", so "Yes, CUAET" is a yes; a "no" counts only as
 * a plain no (intakeAnswerIsYes), never a "no idea".
 */
export function publicPolicy(p: Profile): string | undefined {
  const said = declared(p, ...POLICY_KEYS);
  if (said) return said === 'Yes' ? YES : NO;
  const raw = pickText(p, ...POLICY_KEYS);
  return raw && /^yes\b/i.test(raw.trim()) ? YES : undefined;
}

/**
 * "What type of work permit do you want to apply for?" (recorded live in a
 * fresh questionnaire 2026-10-31; asked after the valid-permit screen):
 * SAWP 7663, LMIA 7664, LMIA-exempt 7675, an open permit as a student's
 * spouse or a worker's family member 7673. The other categories (intra-
 * company, international agreement, public policy, PNP, entrepreneur,
 * academic, medical residents, charitable/religious, post-graduate) are not
 * modelled: left for the applicant.
 */
export function workPermitTypeCode(p: Profile): string | undefined {
  if (isSeasonalAgriculturalWorker(p)) return '7663';
  const kind = workPermitKindOf(p);
  if (kind === 'lmia') return '7664';
  if (kind === 'lmia_exempt') return '7675';
  if (kind === 'open' && workPermitPrincipalOf(p)) return '7673';
  return undefined;
}

/** A plain yes / no the applicant gave to one of the work screen's questions. */
const yesNo =
  (...keys: string[]) =>
  (p: Profile): string | undefined => {
    const said = declared(p, ...keys);
    if (said) return said === 'Yes' ? YES : NO;
    // "Yes, business visitor": a yes with the detail (as publicPolicy).
    const raw = pickText(p, ...keys);
    return raw && /^yes\b/i.test(raw.trim()) ? YES : undefined;
  };
export const exemptCategory = yesNo('work_permit_exempt_category', 'work_permit_exempt');
export const recentGraduate = yesNo('recent_canadian_graduate', 'recent_canadian_post_secondary_graduate');

/**
 * "Are you the spouse, common-law partner or dependent child of a person who
 * has or is applying for a work permit?" — from the open work permit's
 * family member: Yes for a worker's, No for a student's. An employer-specific
 * applicant is not asked whose family member they are: left.
 */
export function spouseOfWorker(p: Profile): string | undefined {
  if (workPermitKindOf(p) !== 'open') return undefined;
  const principal = workPermitPrincipalOf(p);
  return principal === 'worker'
    ? YES
    : principal === 'student'
      ? NO
      : undefined;
}

/**
 * "…spouse or common-law partner of a person who holds a study permit?" —
 * Yes only when the relationship names a spouse or partner: a student's
 * dependent child is not one (review 2026-10-30).
 */
export function spouseOfStudent(p: Profile): string | undefined {
  if (workPermitKindOf(p) !== 'open') return undefined;
  const principal = workPermitPrincipalOf(p);
  if (principal === 'worker') return NO;
  if (principal !== 'student') return undefined;
  const rel = pickText(p, 'principal_relationship', 'relationship_to_principal') ?? '';
  if (/\b(child|son|daughter)\b/i.test(rel)) return NO;
  return /\b(spouse|partner|husband|wife|common[\s-]?law)\b/i.test(rel) ? YES : undefined;
}

/**
 * The tail's two family-status questions ("spouse or child of certain
 * skilled workers or students", "accompanying a family member with status"):
 * "No" from the applicant's no, as on the study permit — but never for an
 * open work permit, which is held through a family member in Canada.
 */
const workFamilyStatusNo = (p: Profile) =>
  workPermitKindOf(p) === 'open' ? undefined : familyStatusNo(p);

const workProvince = (p: Profile) =>
  provinceCode(
    pickText(p, 'work_location_province', 'province_of_work', 'work_province'),
  );

// ── the mapping, in questionnaire order ─────────────────────────────────────
export const WORK_EAPP_MAPPING: FillFieldMapping[] = [
  // Screen 1 (eight selects), as on the study permit but for "Work".
  purposeEntry('7123', 'What would you like to do in Canada? (Work)'),
  stayLengthEntry(workStayLength),
  familyMemberCitizenOrPrEntry(),
  dobMonthEntry(),
  passportCodeEntry(),
  countryOfResidenceEntry(),
  dobYearEntry(),
  dobDayEntry(),

  usPermanentResidentEntry(),
  ask(
    'eapp_job_offer',
    ANY_SELECT,
    /i have a job offer and my employer gave me an offer of employment number or lmia number/,
    'Job offer with an offer of employment number or LMIA number',
    'employment',
    jobOffer,
  ),
  ask(
    'eapp_job_offer_status',
    ANY_SELECT,
    /what is the status of your job offer/,
    'Status of the job offer (temporary, under or over a year)',
    'employment',
    offerStatus,
    { parent: 'eapp_job_offer', parentValue: YES },
  ),
  // Four selects on one screen: exempt categories, public policy, spouse of
  // a worker, recent Canadian graduate — each from the applicant's own answer.
  ask(
    'eapp_work_permit_exempt',
    ANY_SELECT,
    /do you plan to work on any of the following work permit exempt categories/,
    'Work in a category that needs no work permit',
    'employment',
    exemptCategory,
  ),
  ask(
    'eapp_public_policy',
    ANY_SELECT,
    /coming to canada under an active public policy or special measure/,
    'Coming under an IRCC public policy or special measure',
    'employment',
    publicPolicy,
    { declaration: true },
  ),
  ask(
    'eapp_spouse_of_worker',
    ANY_SELECT,
    /dependent child of a person who has or is applying for a work permit/,
    'Spouse, partner or dependent child of a work permit holder or applicant',
    'employment',
    spouseOfWorker,
  ),
  ask(
    'eapp_recent_canadian_graduate',
    ANY_SELECT,
    /recently graduated from a participating canadian post-secondary institution/,
    'Recent graduate of a Canadian post-secondary school',
    'employment',
    recentGraduate,
  ),
  ask(
    'eapp_spouse_of_student',
    ANY_SELECT,
    /spouse or common-law partner of a person who holds a study permit/,
    'Spouse or partner of a study permit holder',
    'employment',
    spouseOfStudent,
  ),

  // The shared tail.
  maritalStatusEntry(),
  destinationProvinceEntry(workProvince),
  validPermitEntry(),
  ask(
    'eapp_work_permit_type',
    ANY_SELECT,
    /what type of work permit do you want to apply for/,
    'Type of work permit',
    'employment',
    workPermitTypeCode,
  ),
  // The exchange / co-op / skilled-worker-family / scholarship screen is a
  // study screen: a fresh work questionnaire never shows it (2026-10-31).
  // After an LMIA, IRCC asks Global Talent Stream and professional
  // association questions: no fact, left for the applicant.
  accompanyingFamilyMemberEntry(workFamilyStatusNo),
  // Only after "accompanying a family member" = Yes (branch sweep
  // 2026-10-31): the document used to enter Canada. A passport on file is
  // the answer; anything else is the applicant's.
  ask(
    'eapp_travel_document_type',
    ANY_SELECT,
    /which type of travel document did you use or will you use to enter canada/,
    'Travel document used to enter Canada',
    'passport',
    // Gated on the applicant's own "yes, accompanying a family member with
    // status", so the consultant review never lists a screen IRCC won't show.
    (p: Profile) =>
      (declared(p, 'family_member_status_in_canada', 'accompanying_family_member_with_status') === 'Yes' ||
        /^\s*yes\b/i.test(pickText(p, 'family_member_status_in_canada', 'accompanying_family_member_with_status') ?? '')) &&
      pickText(p, 'passport_number')
        ? '7344'
        : undefined,
  ),
  ...declarationsTail(),
];

/** What the applicant answers or does on the questionnaire themselves. */
function leftForApplicant(p: Profile): ManualFieldNote[] {
  const notes: ManualFieldNote[] = commonLeftNotes();
  if (workPermitKindOf(p) === 'lmia')
    notes.push({
      page: EAPP_PAGE,
      label: 'Global Talent Stream; professional association membership',
      reason: 'fill_yourself',
      note: 'After the LMIA question IRCC asks whether your employer’s LMIA was issued under the Global Talent Stream and whether it requires you to join a professional association in Canada. Answer them from your LMIA.',
    });
  if (workPermitKindOf(p) === 'open')
    notes.push({
      page: EAPP_PAGE,
      label: 'Your family member’s status in Canada',
      reason: 'needs_your_answer',
      note: 'You are applying for an open work permit: answer the "spouse or child of a skilled worker or student" and "accompanying a family member" questions yourself.',
    });
  else notes.push(...familyStatusNote(p));
  notes.push(...representativeNote(p));
  // Already holding a Canadian permit (live 2026-10-31): any "Yes, I have a
  // ... permit" on the valid-permit screen makes IRCC skip the work permit
  // type, LMIA, accompanying and criminality screens — it treats the
  // application as a visa to return, not a new work permit. Stated, not
  // judged: the applicant chooses which permit they hold.
  if (declared(p, 'has_valid_canadian_permit', 'valid_canadian_permit', 'holds_canadian_permit') === 'Yes')
    notes.push({
      page: EAPP_PAGE,
      label: 'Which Canadian permit you already hold',
      reason: 'needs_your_answer',
      note: 'You said you hold a valid Canadian work or study permit. On the "valid work permit or study permit, and need a visa to return" screen choose the permit you hold. If you answer yes there, IRCC skips the work permit questions (type, LMIA, family) and builds a checklist for a visa to return to Canada, not a new work permit.',
    });
  // Follow-ups IRCC shows only on some answers (branch sweep 2026-10-31).
  if (declared(p, 'us_permanent_resident') === 'Yes')
    notes.push({
      page: EAPP_PAGE,
      label: 'Travelling to Canada directly from the U.S. or St. Pierre and Miquelon',
      reason: 'fill_yourself',
      note: 'As a U.S. permanent resident IRCC asks whether you travel to Canada directly from the United States or St. Pierre and Miquelon. Answer it yourself.',
    });
  if (workPermitKindOf(p) === 'open' && workPermitPrincipalOf(p) === 'student')
    notes.push({
      page: EAPP_PAGE,
      label: 'Which option applies to your student spouse',
      reason: 'fill_yourself',
      note: 'IRCC asks whether your spouse or partner is in a master’s program longer than 16 months or a doctorate, an eligible provincial or territorial program, or a professional degree at a university. Choose the one that matches their letter of acceptance.',
    });
  if (recentGraduate(p) === YES)
    notes.push({
      page: EAPP_PAGE,
      label: 'School letter confirming completion and final transcript',
      reason: 'fill_yourself',
      note: 'For a post-graduation work permit IRCC asks (twice) whether you have an official letter from your school confirming you completed the program and a copy of your final transcript.',
    });
  if (declared(p, 'uses_representative') === 'Yes')
    notes.push({
      page: EAPP_PAGE,
      label: 'Submission letter from your representative',
      reason: 'fill_yourself',
      note: 'If you appoint a representative, IRCC asks whether they gave you a submission letter.',
    });
  return notes;
}

registerPortalFill('ircc-work', WORK_EAPP_MAPPING, {
  pages: EAPP_PAGES,
  left: leftForApplicant,
});
