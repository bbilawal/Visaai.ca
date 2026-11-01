import {
  registerPortalFill,
  type FillFieldMapping,
  type ManualFieldNote,
} from '../../../strategies/portal-integration/portal-fill.registry';
import { intakeAnswerIsYes, isoDayMs } from '@visaai/types';
import {
  declared,
  pick,
  pickDate,
  pickText,
  type Profile,
} from './ircc-profile';
import {
  ANY_SELECT,
  EAPP_PAGE,
  EAPP_PAGES,
  QUEBEC,
  YES,
  NO,
  accompanyingFamilyMemberEntry,
  ask,
  commonLeftNotes,
  countryOfResidenceEntry,
  declarationsTail,
  destinationProvinceEntry,
  dobDayEntry,
  dobMonthEntry,
  dobYearEntry,
  fact,
  familyMemberCitizenOrPrEntry,
  familyOfWorkerOrStudentEntry,
  familyStatusNote,
  maritalStatusEntry,
  passportCodeEntry,
  provinceCode,
  purposeEntry,
  representativeNote,
  stayLengthEntry,
  usPermanentResidentEntry,
  validPermitEntry,
  yesNo,
} from './canada-ircc-eapp-common';

export { EAPP_PAGE, EAPP_PAGES, provinceCode };
export { maritalCode, criminality } from './canada-ircc-eapp-common';

/**
 * Canada STUDY PERMIT (registry `ca-study-permit`) — the eligibility
 * questionnaire of IRCC's secure account ("eapp"), recorded live on
 * 2026-10-20 (Pakistani applicant, PAL from Ontario, married, spouse not
 * accompanying).
 *
 * Since 2025-03-25 a study permit from outside Canada is applied for in the
 * secure account, not on tr-rt: "Apply to come to Canada" → "Visitor visa,
 * study and/or work permit" opens this questionnaire, whose answers build the
 * document checklist (IMM 1294, IMM 5645, PAL, medical…).
 *
 * Portal facts the mapping relies on:
 *  - host onlineservices-servicesenligne.cic.gc.ca, path /eapp/eapp for EVERY
 *    screen (the review page's referrer is /eapp/eapp too). It is server
 *    paged: the applicant presses the form's Next (`#_next`), the server sends
 *    the next screen at the same URL. The extension fills each screen when it
 *    loads (sidepanel.ts follows a page load on this path); it never presses
 *    Next, Continue or Exit.
 *  - Screen 1 has eight selects, `select#answerlist[1..9]`; after it, usually
 *    one question a screen, as `answerlist[0]` or `answerlist[1]`. The SAME id
 *    is a different question on every screen, so each write is scoped to its
 *    question's label (`labelMatch`, matched against the live wording below)
 *    or, for the date of birth and the one radio question, to text on the
 *    screen (`pageMatch`). A write whose question is not on the screen
 *    resolves to nothing and waits for its screen (the page is `progressive`).
 *  - Option values are numeric codes: 991 Yes / 997 No everywhere; the other
 *    codes are the recorded ones below. Country lists are chosen by option
 *    TEXT ("PAK (Pakistan)", "Pakistan"): their 215 / 241 codes were not all
 *    recorded. The year and day of birth by text, the month by its code.
 *  - The questionnaire ends at /eapp/comeToCanadaReviewPage ("Review your
 *    answers"). The assistant stops there: the instructions, the document
 *    checklist, uploads, signature and payment are the applicant's.
 *
 * SAFETY. The criminality, panel-physician medical exam and designated-country
 * questions are legal declarations: answered only from the applicant's
 * explicit answer, never defaulted, flagged `declaration`. Fee questions
 * (paying or fee-exempt, paying online) and "can you make digital copies" are
 * never answered. Nothing here answers a question from a guess: a question
 * with no answer is left empty and listed for the applicant.
 *
 * NOT SEEN LIVE — left unmapped (the recording followed one applicant):
 *  - every follow-up of a "Yes" this applicant did not give: a USCIS number
 *    after "U.S. lawful permanent resident", the permit type after "valid
 *    work or study permit" (7221–7224 recorded as options, their follow-ups
 *    not), what the exchange / co-op / scholarship / accompanying answers
 *    open, the details after a criminality "Yes", the representative's
 *    details after giving someone access;
 *  - the Quebec path (a CAQ instead of a PAL): the province is left for the
 *    applicant when the school is in Quebec;
 *  - post-secondary "No" (a primary or secondary school), and stays of six
 *    months or less;
 *  - the screens between "post-secondary" and "marital status" were answered
 *    by the applicant during the recording (none was a question we map
 *    beyond those listed here).
 */

// The questions every permit shares (screen 1, US PR, marital status, the
// valid-permit screen, the declarations…) live in canada-ircc-eapp-common.ts,
// shared with the work permit; this file keeps what only a student is asked.

/** 7347 "Temporarily - more than 6 months" when the program runs longer. */
function stayLength(p: Profile): string | undefined {
  const start = pickDate(
    p,
    'study_start_date',
    'program_start_date',
    'studies_start_date',
  );
  const end = pickDate(
    p,
    'study_end_date',
    'program_end_date',
    'studies_end_date',
    'expected_completion_date',
  );
  if (!start || !end) return undefined;
  const [y, m, d] = start.split('-').map(Number);
  const sixMonths = new Date(Date.UTC(y, m - 1 + 6, d)).getTime();
  const endMs = isoDayMs(end);
  if (endMs === null) return undefined;
  // Six months or less: not seen live (the 7346 option exists), left.
  return endMs > sixMonths ? '7347' : undefined;
}

const PAL_LETTER = '376806';
const PAL_EXCEPTION = '376807';

/**
 * The PAL/TAL question has no "No": a letter (376806) or an exception
 * (376807). An exception is chosen only when the applicant said they have no
 * letter AND named why; a bare "no" is left (they cannot continue without
 * one or the other, and that is theirs to sort out).
 */
export function attestationAnswer(p: Profile): string | undefined {
  const raw = pick(
    p,
    'has_attestation_letter',
    'has_pal',
    'has_tal',
    'pal_or_tal',
    'provincial_attestation_letter_available',
  );
  if (intakeAnswerIsYes(raw) === true) return PAL_LETTER;
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  if (/^(yes|y)\b/.test(s)) return PAL_LETTER;
  if (/^(no|n)\b/.test(s)) {
    const why = s.replace(/^(no|n)\b[\s,.:;–—-]*/, '');
    return why.length >= 3 ? PAL_EXCEPTION : undefined;
  }
  if (/\b(exception|exempt)\b/.test(s)) return PAL_EXCEPTION;
  return undefined;
}

const studyProvince = (p: Profile) =>
  provinceCode(
    pickText(p, 'study_province', 'province_of_study', 'school_province'),
  );

/** Post-secondary from the program level; language training is left. */
export function postSecondary(p: Profile): string | undefined {
  const lvl = pickText(
    p,
    'study_level',
    'level_of_study',
    'program_level',
  )?.toLowerCase();
  if (!lvl) return undefined;
  if (/post-?\s?secondary|post-?\s?graduate/.test(lvl)) return YES;
  if (
    /\b(primary|secondary|high school|elementary|middle school|grade \d+)\b/.test(
      lvl,
    )
  )
    return NO;
  if (
    /\b(college|university|bachelor'?s?|master'?s?|doctor(al|ate)?|phd|diploma|certificate|degree|undergraduate|graduate)\b/.test(
      lvl,
    )
  )
    return YES;
  return undefined;
}

/** Accepted to a DLI: said so, or the school that accepted them is on file. */
function acceptedToDli(p: Profile): string | undefined {
  const said = declared(p, 'accepted_to_dli', 'has_letter_of_acceptance');
  if (said) return yesNo(said);
  return pickText(
    p,
    'dli_number',
    'designated_learning_institution_number',
    'study_school_name',
    'dli_name',
  )
    ? YES
    : undefined;
}

// ── the mapping, in questionnaire order ─────────────────────────────────────
export const EAPP_MAPPING: FillFieldMapping[] = [
  // Screen 1 (eight selects). Recorded codes first; the two country lists,
  // chosen by option text, after them.
  purposeEntry('7120', 'What would you like to do in Canada? (Study)'),
  stayLengthEntry(stayLength),
  familyMemberCitizenOrPrEntry(),
  dobMonthEntry(),
  passportCodeEntry(),
  countryOfResidenceEntry(),
  dobYearEntry(),
  dobDayEntry(),

  // One question a screen.
  ask(
    'eapp_attestation_letter',
    ANY_SELECT,
    /provincial or territorial attestation letter or meet an exception/,
    'Provincial or territorial attestation letter (PAL/TAL) or an exception',
    'employment',
    attestationAnswer,
  ),
  ask(
    'eapp_attestation_province',
    ANY_SELECT,
    /which province or territory is your provincial attestation letter from/,
    'Province or territory of the attestation letter',
    'addresses',
    // Quebec takes a CAQ: that path was not seen live, so it is left.
    (p) => {
      const c = studyProvince(p);
      return c === QUEBEC ? undefined : c;
    },
    { parent: 'eapp_attestation_letter', parentValue: PAL_LETTER },
  ),
  usPermanentResidentEntry(),
  ask(
    'eapp_accepted_to_dli',
    ANY_SELECT,
    /have you been accepted to a designated learning institution/,
    'Accepted to a designated learning institution',
    'employment',
    acceptedToDli,
  ),
  ask(
    'eapp_post_secondary',
    ANY_SELECT,
    /planning to attend a post-secondary designated learning institution/,
    'Attending a post-secondary designated learning institution',
    'employment',
    postSecondary,
  ),
  maritalStatusEntry(),
  destinationProvinceEntry(studyProvince),
  validPermitEntry(),
  // Four selects on one screen.
  ask(
    'eapp_exchange_student',
    ANY_SELECT,
    /are you an exchange student/,
    'Exchange student',
    'employment',
    fact('exchange_student', 'is_exchange_student'),
  ),
  ask(
    'eapp_work_essential',
    ANY_SELECT,
    /is work an essential component of your studies/,
    'Work is an essential part of the studies (co-op)',
    'employment',
    fact(
      'work_essential_to_studies',
      'co_op_program',
      'has_coop',
      'coop_work_placement',
    ),
  ),
  familyOfWorkerOrStudentEntry(),
  ask(
    'eapp_government_scholarship',
    ANY_SELECT,
    /commonwealth scholarship/,
    'Commonwealth scholarship, full CIDA bursary or Canadian aid program',
    'employment',
    fact('government_scholarship', 'commonwealth_scholarship', 'cida_bursary'),
  ),
  accompanyingFamilyMemberEntry(),
  ...declarationsTail(),
];

/** What the applicant answers or does on the questionnaire themselves. */
function leftForApplicant(
  p: Profile,
  exclude: ReadonlySet<string> = new Set(),
): ManualFieldNote[] {
  const notes: ManualFieldNote[] = commonLeftNotes();
  if (!exclude.has('eapp_attestation_province') && studyProvince(p) === QUEBEC)
    notes.push({
      page: EAPP_PAGE,
      label: 'Quebec: attestation letter province',
      reason: 'fill_yourself',
      note: 'Your school is in Quebec, which uses a CAQ. Answer the attestation questions yourself.',
    });
  notes.push(...representativeNote(p), ...familyStatusNote(p));
  return notes;
}

registerPortalFill('ircc-study', EAPP_MAPPING, {
  pages: EAPP_PAGES,
  left: leftForApplicant,
});
