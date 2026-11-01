import {
  registerPortalFill,
  type FillFieldMapping,
  type ManualFieldNote,
  type PortalPageInfo,
} from '../../../strategies/portal-integration/portal-fill.registry';
import {
  CA_PROVINCE_NAMES,
  US_STATES,
  contactAddress,
  declared,
  displayCountry,
  irccMedicalNumber,
  nameParts,
  parseAddressLine,
  canadianPostalCode,
  parseCanadianAddress,
  people,
  pick,
  pickCountry,
  pickDate,
  pickText,
  residentialAddress,
  sentence,
  splitPlace,
  type Address,
  type Profile,
} from './ircc-profile';
import { plannedStay } from '@visaai/types';
import { isSamePerson } from '../../shared/profile/family-members';
import { samePerson } from '../../shared/profile/canonical-fact-keys';
import { placePhone, phoneSummary, type PlacedPhone } from './phone-numbers';
import { signatureNotes, uploadMappings } from './ircc-uploads';
import {
  IRCC_ACTIVITY,
  irccOccupationFor,
  irccOccupationFromDuties,
} from './ircc-occupations';
import { IRCC_NATIVE_LANGUAGES } from './ircc-languages';
import {
  IRCC_GENERIC_TEXT,
  applyFillTransform,
  irccRomanText,
  plainWords,
} from '../fill-transforms';

/**
 * Canada IRCC portal fill mapping (TRV/visitor), read off the live portal
 * (tr-rt.apps.cic.gc.ca) on 2026-10-15: the pages a human filled by hand in
 * that day's dry run, with their exact ids.
 *
 * Portal facts the mapping relies on:
 *  - Multi-page, reached in order with "Save and continue". Ids are reused
 *    across pages (`#lastName_input` is the applicant on /bio-data, the spouse
 *    on /family-info and a child in the children dialog), so every entry names
 *    its `page` and a run writes only the page whose URL path is open.
 *  - Dates are three selects (`<id>Year_sltDateYear`, `<id>Month_sltDateMonth`,
 *    `<id>Day_sltDateDay`, day unpadded); countries are IRCC numeric codes.
 *  - Radios are `<name>_radio-button-NN-input` (yes/no questions: -01 Yes,
 *    -02 No) and are selected by clicking the input. Follow-up questions appear
 *    only after their parent radio is answered — those entries are `reveal`
 *    and hang off their parent (`parent`), so they are written in order and
 *    only when the parent is.
 *  - Table rows (residences, work history, children) are added in a
 *    mat-dialog: open with the table's add button, fill inside the dialog,
 *    Save. A row is only added when everything the dialog requires is known;
 *    a half-filled dialog cannot be saved and would strand the page.
 *  - IRCC refuses dashes in an identity number; /validity-status details take
 *    500 characters at most.
 *
 * SAFETY. The criminality, security, medical and immigration-history questions
 * are legal declarations. They are answered only from the applicant's own
 * explicit answer to that question (`declared`), are never defaulted, and are
 * flagged `declaration` so the readback gate shows them apart for the
 * applicant to confirm. Without an answer the question is left for the
 * applicant and listed as "needs your answer".
 */

// ── pages ───────────────────────────────────────────────────────────────────
const GROUP = '/group-questions';
const PURPOSE = '/purpose';
const REPRESENTATIVE = '/representative';
const BIO = '/bio-data';
const TRAVEL_DOC = '/bio-data-travel-docs';
const NATIONALITY = '/nationality';
const NATIONAL_ID = '/national-id-doc';
const OTHER_NAMES = '/other-names';
const CONTACT = '/contact-info';
const MINORS_GUARDIAN = '/minors-guardian';
const BIOMETRICS = '/biometrics';
const INVITER = '/inviter-info';
const FINANCES = '/finances';
const ACTIVITIES = '/activities';
const TRAVEL_HISTORY = '/travel-history';
const VALIDITY = '/validity-status';
const CRIME = '/crime-activity';
const SECURITY = '/security-questions';
const MEDICAL_EXAM = '/medical-background-questions';
const MEDICAL_TB = '/medical-tuberculosis';
const MEDICAL = '/medical-questions';
const FAMILY = '/family-info';
const CHILDREN = '/family-info-children';
const PARENTS = '/family-info-parents';
const LANGUAGE = '/language';
const EMAIL = '/contact-info-email';
const TELEPHONE = '/contact-info-tel';
const DOC_UPLOAD = '/doc-upload';

/** Portal order (observed 2026-10-15) and the titles shown to the applicant. */
export const IRCC_PAGES: PortalPageInfo[] = [
  // Before Purpose on a new draft (live 2026-10-18).
  { page: GROUP, title: 'Group application' },
  { page: PURPOSE, title: 'Purpose of visit' },
  { page: REPRESENTATIVE, title: 'Representative' },
  { page: BIO, title: 'Personal details' },
  { page: TRAVEL_DOC, title: 'Travel document' },
  { page: NATIONALITY, title: 'Citizenship and places lived' },
  { page: NATIONAL_ID, title: 'National identity document' },
  { page: OTHER_NAMES, title: 'Other names' },
  { page: CONTACT, title: 'Contact information' },
  // A child 16 or under only (live 2026-10-31).
  { page: MINORS_GUARDIAN, title: 'Travelling with a parent or guardian' },
  { page: BIOMETRICS, title: 'Biometrics' },
  { page: INVITER, title: 'Invitation' },
  { page: FINANCES, title: 'Finances' },
  { page: ACTIVITIES, title: 'Education and employment' },
  { page: TRAVEL_HISTORY, title: 'Travel history' },
  { page: VALIDITY, title: 'Travel history (continued)' },
  { page: CRIME, title: 'Criminality' },
  { page: SECURITY, title: 'Security' },
  { page: MEDICAL_EXAM, title: 'Medical exam' },
  { page: MEDICAL_TB, title: 'Tuberculosis' },
  { page: MEDICAL, title: 'Medical questions' },
  { page: FAMILY, title: 'Marital status and spouse' },
  { page: CHILDREN, title: 'Children' },
  { page: PARENTS, title: 'Parents' },
  { page: LANGUAGE, title: 'Language' },
  { page: EMAIL, title: 'Email address' },
  { page: TELEPHONE, title: 'Telephone number' },
  // Progressive: which upload slots IRCC shows depends on the answers, so the
  // slots present are filled and the rest are listed for the applicant.
  { page: DOC_UPLOAD, title: 'Documents', progressive: true },
];

// Residence dialog limits (used while the mapping below is built).
/** statusResidenceDetail ("Other"): required, Roman script, at most 100 characters. */
const RESIDENCE_DETAIL_MAX = 100;
/** Earlier residence rows the assistant adds; more are left with a note. */
const MAX_EARLIER_RESIDENCES = 4;

// ── building blocks ─────────────────────────────────────────────────────────
type Category = FillFieldMapping['category'];
type Extra = Partial<
  Pick<
    FillFieldMapping,
    | 'derive'
    | 'reveal'
    | 'dialog'
    | 'parent'
    | 'parentValue'
    | 'declaration'
    | 'maxLength'
    | 'transform'
    | 'silent'
  >
>;

/** One ISO date → IRCC's year / month / day selects (day optional: work history). */
function dateSelects(
  page: string,
  profileKey: string,
  id: string,
  label: string,
  category: Category,
  extra: Extra = {},
  withDay = true,
): FillFieldMapping[] {
  const out: FillFieldMapping[] = [
    {
      page,
      profileKey,
      selector: `#${id}Year_sltDateYear`,
      action: 'select',
      transform: 'date_year',
      label: `${label} — year`,
      category,
      ...extra,
    },
    {
      page,
      profileKey,
      selector: `#${id}Month_sltDateMonth`,
      action: 'select',
      transform: 'date_month',
      label: `${label} — month`,
      category,
      ...extra,
    },
  ];
  if (withDay)
    out.push({
      page,
      profileKey,
      selector: `#${id}Day_sltDateDay`,
      action: 'select',
      transform: 'date_day',
      label: `${label} — day`,
      category,
      ...extra,
    });
  return out;
}

/** A yes/no radio question (`-01` Yes, `-02` No). */
function yesNo(
  page: string,
  profileKey: string,
  name: string,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return radio(
    page,
    profileKey,
    name,
    label,
    category,
    { Yes: '01', No: '02' },
    derive,
    extra,
  );
}

function radio(
  page: string,
  profileKey: string,
  name: string,
  label: string,
  category: Category,
  answers: Record<string, string>,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  const choices: Record<string, string> = {};
  for (const [answer, nn] of Object.entries(answers))
    choices[answer] = `#${name}_radio-button-${nn}-input`;
  return {
    page,
    profileKey,
    selector: `[name="${name}"]`,
    choices,
    op: 'radio',
    action: 'fill',
    label,
    category,
    derive,
    ...extra,
  };
}

/** Passport fields wait for the two questions a new draft asks first. */
const PASSPORT_SHOWN: Extra = {
  reveal: true,
  parent: 'passport_type',
  parentValue: 'Regular',
};

/**
 * The applicant's age in whole years on `on` (default today, UTC), from the
 * date of birth. IRCC counts it in the browser's local time at fill time.
 */
function ageOn(p: Profile, on = new Date()): number | undefined {
  const dob = pickDate(p, 'date_of_birth');
  const m = dob && /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return undefined;
  let age = on.getUTCFullYear() - Number(m[1]);
  const md = (on.getUTCMonth() + 1) * 100 + on.getUTCDate();
  if (md < Number(m[2]) * 100 + Number(m[3])) age -= 1;
  return age;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Other keys the TB close-contact declaration is read under. */
const TB_CONTACT_KEYS = ['tb_close_contact', 'close_contact_tuberculosis'];

/**
 * IRCC asks a child aged 5 or under other tuberculosis questions (tr-rt
 * bundle 2026-10-19). Within a day of the 6th birthday the browser's local
 * date may differ from ours, so the child's version is assumed then too: the
 * 5-year questions are left to the applicant rather than waited for.
 */
const maybeYoungChild = (p: Profile) => {
  const age = ageOn(p, new Date(Date.now() - DAY_MS));
  if (age !== undefined) return age <= 5;
  // Only a birth year: within 6 years the applicant may still be 5, so the
  // 5-year questions are left rather than written to a page without them.
  const y = Number(pickText(p, 'birth_year', 'year_of_birth'));
  return Number.isInteger(y) && y > 1900 && new Date().getUTCFullYear() - y <= 6;
};

/**
 * The oldest the applicant can be today, whatever the browser's local date:
 * from the date of birth a day ahead, else from the birth year alone (this
 * year minus it). Undefined with neither.
 */
function oldestAge(p: Profile): number | undefined {
  const age = ageOn(p, new Date(Date.now() + DAY_MS));
  if (age !== undefined) return age;
  const y = Number(pickText(p, 'birth_year', 'year_of_birth'));
  return Number.isInteger(y) && y > 1900
    ? new Date().getUTCFullYear() - y
    : undefined;
}

/**
 * Surely 5 or under, even on the browser's date: IRCC shows the 2-year TB
 * questions (live 2026-10-31, child born 2022-03-10) and no 5-year ones.
 * Near the 6th birthday (maybeYoungChild but not this) neither chain is
 * written and the applicant answers the one IRCC shows.
 */
const surelyFiveOrUnder = (p: Profile) => {
  const age = oldestAge(p);
  return age !== undefined && age <= 5;
};

/**
 * 16 or under, or may be on the browser's date: IRCC's /minors-guardian
 * ("Children 16 years old and younger", live 2026-10-31). No date of birth
 * or birth year: not a child here.
 */
export const sixteenOrUnder = (p: Profile) => {
  // The browser's date may be a day behind ours: on the 17th birthday the
  // page may still be shown, so the answers are written (a page IRCC does
  // not show is skipped, never a halt).
  const age = ageOn(p, new Date(Date.now() - DAY_MS));
  if (age !== undefined) return age <= 16;
  const oldest = oldestAge(p);
  return oldest !== undefined && oldest <= 16;
};

/**
 * Surely under 14, even on the browser's date: IRCC does not show them
 * /biometrics (live 2026-10-31: hidden at 4 and 12, shown at 15 and 17).
 * Unknown age: not a child here.
 */
const surelyUnder14 = (p: Profile) => {
  const age = oldestAge(p);
  return age !== undefined && age < 14;
};

/**
 * Surely under 18, even on the browser's date: IRCC does not show them
 * /travel-history, /validity-status, /crime-activity or /security-questions,
 * and /activities shows only hasPostSecondaryEducation (live 2026-10-31, at
 * 4, 15 and 17). Possibly 18 already, or unknown age: every page as before.
 */
const surelyUnder18 = (p: Profile) => {
  const age = oldestAge(p);
  return age !== undefined && age < 18;
};

/** Pages IRCC does not show a minor (see surelyUnder18). */
const MINOR_HIDDEN_PAGES = new Set([TRAVEL_HISTORY, VALIDITY, CRIME, SECURITY]);

/**
 * The gate under which IRCC hides this page (or this part of /activities:
 * all but the education question and rows), or undefined when it is shown
 * to everyone. A note has no profile key: on /activities, only education
 * notes are kept (see leftForApplicant).
 */
function hiddenFor(
  page: string | undefined,
  profileKey: string | undefined,
): ((p: Profile) => boolean) | undefined {
  if (!page) return undefined;
  if (page === BIOMETRICS) return surelyUnder14;
  if (MINOR_HIDDEN_PAGES.has(page)) return surelyUnder18;
  if (
    page === ACTIVITIES &&
    profileKey !== 'has_post_secondary_education' &&
    !profileKey?.startsWith('ircc_school_')
  )
    return surelyUnder18;
  return undefined;
}

/**
 * Entries IRCC does not show a child are not written for them (a missing
 * control on /activities would refuse the page) and not listed as left for
 * them.
 */
function forChildren(mapping: FillFieldMapping[]): FillFieldMapping[] {
  return mapping.map((f) => {
    const hidden = hiddenFor(f.page, f.profileKey);
    if (!hidden) return f;
    const own = f.onlyIf;
    return {
      ...f,
      onlyIf: (p: Profile) => !hidden(p) && (!own || own(p)),
    };
  });
}

/**
 * /minors-guardian answers, from the applicant's explicit words only. Both
 * or one parent / guardian (530 / 531) after Yes; alone or with someone else
 * (532 / 533) after No (live 2026-10-31).
 */
const GUARDIANS_BOTH = 'Both parents or legal guardians';
const GUARDIANS_ONE = 'One parent or legal guardian';
const WITHOUT_ALONE = 'Alone';
const WITHOUT_SOMEONE = 'With someone else';

function guardiansTravelling(p: Profile): string | undefined {
  const s = pickText(p, 'minor_guardians_travelling')?.toLowerCase();
  if (!s) return undefined;
  const both = /\bboth\b|\btwo\b/.test(s);
  const one = /\bone\b|\bonly\b|\bsingle\b/.test(s);
  if (both === one) return undefined;
  return both ? GUARDIANS_BOTH : GUARDIANS_ONE;
}

function travellingWithout(p: Profile): string | undefined {
  const s = pickText(p, 'minor_travelling_without_guardian')?.toLowerCase();
  if (!s) return undefined;
  const alone = /\balone\b|\bunaccompanied\b|\bon (his|her|their) own\b/.test(s);
  const someone = /\bsomeone\b|\bsomebody\b|\banother\b|\bother (adult|person)\b/.test(s);
  if (alone === someone) return undefined;
  return alone ? WITHOUT_ALONE : WITHOUT_SOMEONE;
}

/** The child's own "travelling with a parent or legal guardian?" answer. */
const travelsWithGuardian = (p: Profile) =>
  sixteenOrUnder(p) ? declared(p, 'minor_travelling_with_guardian') : undefined;

/**
 * The applicant travels on a document that is not a passport (a refugee or
 * stateless travel document, a certificate of identity). IRCC's "Other"
 * (250) reveals otherDocumentType and travelDocumentIssuedBy (live
 * 2026-10-31); see otherDocumentOption for which kinds are written.
 */
export function notPassportDocument(p: Profile): string | undefined {
  const kind = pickText(p, 'travel_document_type', 'passport_type');
  if (!kind || /\bpassport\b/i.test(kind)) return undefined;
  return /travel document|certificate|laissez|titre de voyage|refugee|stateless|identity document|red cross|\boas\b|organi[sz]ation of american states|^other\b/i.test(
    kind,
  )
    ? kind
    : undefined;
}

/**
 * IRCC's otherDocumentType answers (live 2026-10-31, Travel_Document_Other
 * LOV), by the label written. 097 "Other travel document" reveals a name box
 * (nameTravelDoc) never recorded live, so it is never chosen.
 */
export const OTHER_DOCUMENT_CODES: Record<string, string> = {
  'Certificate of Identity': '06',
  'Refugee Travel Document': '07',
  'Red Cross Travel Document': '08',
  'UN Laissez-Passer': '09',
  'Organization of American States (OAS) Travel Document': '13',
};

/** The IRCC kind of a non-passport document, only when its words name one clearly. */
export function otherDocumentOption(p: Profile): string | undefined {
  const kind = notPassportDocument(p)?.toLowerCase();
  if (!kind) return undefined;
  if (/certificate of identity/.test(kind)) return 'Certificate of Identity';
  if (
    /refugee travel document|convention travel document|titre de voyage|1951 convention/.test(
      kind,
    )
  )
    return 'Refugee Travel Document';
  if (/red cross/.test(kind)) return 'Red Cross Travel Document';
  if (/laissez[- ]passer/.test(kind) && /\bun\b|united nations/.test(kind))
    return 'UN Laissez-Passer';
  if (/\boas\b|organi[sz]ation of american states/.test(kind))
    return 'Organization of American States (OAS) Travel Document';
  return undefined;
}

/** Who issued the non-passport document: its own answer only, never the nationality. */
const otherDocumentIssuer = (p: Profile) =>
  pickCountry(p, 'travel_document_issuing_country');

/**
 * The young applicant's own answers to IRCC's 2-year tuberculosis questions
 * (contactTwoYears → hasTestTwoYears → twoYearsPostive → twoYearsTreatment).
 * Written for a child surely 5 or under (ids live 2026-10-31); near the 6th
 * birthday the note gives the explicit answers to enter instead (matrix B
 * row 5). A question not answered is not listed; nothing is inferred.
 */
function youngChildTbAnswers(p: Profile): string {
  const chain: [string, string][] = [
    ['tuberculosis_contact_two_years', 'close contact in the last 2 years'],
    ['tuberculosis_tested_two_years', 'tested since'],
    ['tuberculosis_test_positive_two_years', 'test positive'],
    [
      'tuberculosis_positive_treated_two_years',
      'treatment of at least 6 months completed or under way',
    ],
  ];
  const out: string[] = [];
  for (const [key, label] of chain) {
    const yn = declared(p, key);
    if (!yn) break;
    out.push(`${label}: ${yn}`);
    if (yn === 'No') break;
  }
  return out.length ? ` Your answers: ${out.join('; ')}.` : '';
}

/** A regular passport, unless VisaAI holds another kind. */
function regularPassport(p: Profile): 'Regular' | undefined {
  if (!pickText(p, 'passport_number')) return undefined;
  // Only a kind IRCC lists separately is not Regular. The Forms page often
  // holds just "Passport" (live 2026-10-18), which is the regular kind.
  const kind = pickText(p, 'passport_type');
  if (kind && /diplomat|official|service|alien|refugee|stateless/i.test(kind))
    return undefined;
  return 'Regular';
}

/** A legal declaration: explicit answer only, under the listed keys. */
function declaration(
  page: string,
  profileKey: string,
  name: string,
  label: string,
  keys: string[],
): FillFieldMapping {
  return yesNo(
    page,
    profileKey,
    name,
    label,
    'travel_history',
    (p) => declared(p, profileKey, ...keys),
    {
      declaration: true,
    },
  );
}

/**
 * The details box a "Yes" to a declaration reveals (live 2026-10-18). Only the
 * applicant's own words are written; a "Yes" without them is listed as
 * needing their answer.
 */
function declarationDetails(
  page: string,
  parent: string,
  id: string,
  label: string,
  keys: string[],
): FillFieldMapping {
  return text(
    page,
    `${parent}_details`,
    `#${id}_txtArea`,
    label,
    'travel_history',
    (p) => pickText(p, `${parent}_details`, ...keys),
    {
      reveal: true,
      parent,
      parentValue: 'Yes',
      maxLength: 500,
      declaration: true,
    },
  );
}

function text(
  page: string,
  profileKey: string,
  selector: string,
  label: string,
  category: Category,
  derive?: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page,
    profileKey,
    selector,
    action: 'fill',
    label,
    category,
    ...(derive ? { derive } : {}),
    ...extra,
  };
}

const NA_PHONE = 'Canada or the U.S.';

/**
 * One IRCC telephone: the location radio `telLocation_<group>` (-01 Canada or
 * the U.S., -02 Other), then either the ten NA digits in `#telNumber_<group>`
 * or — after "Other" — the dialling code in `#telCountryCode_<group>` and the
 * national number in `#telNumber_<group>` (live 2026-10-18). Each follow-up
 * is a reveal of the location answer it belongs to, so only one of the two
 * paths is ever written. `extra` applies to the location radio; the
 * follow-ups inherit its `silent`.
 */
function telephone(
  page: string,
  keys: { location: string; number: string },
  group: string,
  labels: { location: string; code: string; number: string },
  phone: (p: Profile) => PlacedPhone | undefined,
  extra: Extra = {},
): FillFieldMapping[] {
  const follow = (parentValue: string): Extra => ({
    reveal: true,
    parent: keys.location,
    parentValue,
    ...(extra.silent ? { silent: true } : {}),
  });
  const numberAt = (location: string) => (p: Profile) => {
    const ph = phone(p);
    return ph?.location === location ? ph.number : undefined;
  };
  return [
    radio(
      page,
      keys.location,
      `telLocation_${group}`,
      labels.location,
      'addresses',
      { [NA_PHONE]: '01', Other: '02' },
      (p) => phone(p)?.location,
      extra,
    ),
    text(
      page,
      keys.number,
      `#telNumber_${group}`,
      labels.number,
      'addresses',
      numberAt(NA_PHONE),
      { ...follow(NA_PHONE), transform: 'na_phone' },
    ),
    text(
      page,
      `${keys.number}_country_code`,
      `#telCountryCode_${group}`,
      labels.code,
      'addresses',
      (p) => phone(p)?.countryCode,
      { ...follow('Other'), transform: 'digits' },
    ),
    text(
      page,
      `${keys.number}_international`,
      `#telNumber_${group}`,
      labels.number,
      'addresses',
      numberAt('Other'),
      { ...follow('Other'), transform: 'digits' },
    ),
  ];
}

function country(
  page: string,
  profileKey: string,
  selector: string,
  label: string,
  category: Category,
  derive?: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page,
    profileKey,
    selector,
    action: 'select',
    transform: 'ircc_country',
    label,
    category,
    ...(derive ? { derive } : {}),
    ...extra,
  };
}

function optionText(
  page: string,
  profileKey: string,
  selector: string,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page,
    profileKey,
    selector,
    action: 'select',
    op: 'select_text',
    label,
    category,
    derive,
    ...extra,
  };
}

function check(
  page: string,
  profileKey: string,
  selector: string,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page,
    profileKey,
    selector,
    action: 'fill',
    op: 'check',
    label,
    category,
    derive,
    ...extra,
  };
}

/** The open dialog's Save button (resolved inside the dialog by its text). */
export const DIALOG_SAVE = '::dialog-save';

/** A table row added through its dialog: open → fields → save. */
function dialogRow(
  page: string,
  rowKey: string,
  addButton: string,
  saveButton: string,
  label: string,
  category: Category,
  summary: (p: Profile) => string | undefined,
  fields: FillFieldMapping[],
  extra: Extra = {},
): FillFieldMapping[] {
  return [
    {
      page,
      profileKey: rowKey,
      selector: addButton,
      action: 'fill',
      op: 'dialog_open',
      label: `Add ${label}`,
      category,
      derive: summary,
      silent: true,
      ...extra,
    },
    // A field inside the dialog that follows another dialog question (the
    // telephone's number follows its location) keeps that parent; the rest
    // hang off the row.
    ...fields.map((f) => ({
      ...f,
      dialog: true,
      parent: f.parent ?? rowKey,
      silent: true,
    })),
    {
      page,
      profileKey: `${rowKey}_saved`,
      selector: saveButton,
      action: 'fill',
      op: 'dialog_save',
      label: `Save ${label}`,
      category,
      derive: summary,
      dialog: true,
      parent: rowKey,
      silent: true,
    },
  ];
}

// ── purpose of the visit ────────────────────────────────────────────────────
/** IRCC's `visaPurpose` answers (live 2026-10-18), by the label VisaAI shows. */
export const VISA_PURPOSE_CODES: Record<string, string> = {
  Tourism: '470',
  'Visit other family or friends': '471',
  'Visit children or grandchildren for more than 6 months (super visa)': '472',
  Business: '473',
  'Medical treatment': '474',
  'Funeral or end-of-life ceremony': '675',
  'Be with a loved one who is critically ill': '673',
  'Visit a spouse, parent or dependent child who is a Canadian citizen or permanent resident':
    '686',
  'Visit a spouse, parent or dependent child who is in Canada temporarily':
    '687',
  'Visit a grandparent, grandchild, sibling or adult child who is a Canadian citizen or permanent resident':
    '688',
  // Also in the live 2026-10-18 branch sweep of /purpose (wave 2a, matrix
  // A 13-14). 479 "not sure" is never chosen for the applicant.
  'Provide care to someone who is critically ill': '674',
  'Marine crew': '676',
  'Diplomatic visit': '677',
  'Family member of a diplomat': '678',
  'Family of a victim of flight PS752': '690',
  'Study for 6 months or less without a study permit': '477',
  'Work without a work permit': '478',
};

/** The stated purpose, lowercased ('' when none). */
function statedPurpose(p: Profile): string {
  return (
    pickText(
      p,
      'purpose_of_visit',
      'visit_purpose',
      'purpose_of_trip',
      'purpose',
      'purpose_of_travel',
      'trip_purpose',
      'reason_for_visit',
      'travel_purpose',
    ) ?? ''
  ).toLowerCase();
}

/**
 * Passing through Canada. IRCC's transit application ("I want to apply for"
 * 466) has follow-ups never recorded live, so the purpose page is left for
 * the applicant (wave 2a, matrix A 4).
 */
export function isTransit(p: Profile): boolean {
  const purpose = statedPurpose(p);
  // "public transit" on a sightseeing trip is not a transit application.
  if (TOURISM_WORDS.test(purpose)) return false;
  return /\btransit(ing)? (visa|through|via|in)\b|\bpassing through canada\b|\bconnecting flights?\b|\blayovers?\b|\bstopovers?\b/.test(
    purpose,
  );
}

/** Words of a tourist trip: they win over "course", "study" or "transit". */
const TOURISM_WORDS =
  /touris|sightsee|sight-seeing|holiday|vacation|\bleisure\b|\btour of\b/;

/**
 * Explicit study intent (review of f574b692: "Tourism, of course" and "I will
 * study the culture" are not IRCC's study purpose).
 */
const STUDY_INTENT =
  /\bstudy (program(me)?|course)s?\b|\bstudy in canada\b|\benrol(l)?(ed|ing|ment)?\b|\blanguage (school|course|program(me)?)s?\b|\bsummer school\b|\bshort (study|course) program(me)?s?\b|\battend(ing)? (a |an |the )?([\w-]+ ){0,4}(course|program(me)?|school)s?\b/;

/** Stay within 6 months, from the planned dates (undefined when unknown). */
function withinSixMonths(p: Profile): boolean | undefined {
  const days = plannedStay(p).days;
  return days === null ? undefined : days <= 183;
}

/**
 * The visa purpose from what VisaAI knows: the stated purpose, then who the
 * host is to the applicant and their status in Canada. A family purpose that
 * turns on status IRCC needs (citizen / PR vs temporary) is left for the
 * applicant when the status is unknown.
 */
function visaPurposeOption(p: Profile): string | undefined {
  const purpose = statedPurpose(p);
  if (/funeral|end-of-life/.test(purpose))
    return 'Funeral or end-of-life ceremony';
  if (/\bps ?752\b|\bflight 752\b/.test(purpose))
    return 'Family of a victim of flight PS752';
  if (/critically ill|dying/.test(purpose))
    return /\b(provide|providing|give|giving) care\b|\bcar(e|ing) for\b/.test(
      purpose,
    )
      ? 'Provide care to someone who is critically ill'
      : 'Be with a loved one who is critically ill';
  if (/\bmarine crew\b|\bship'?s crew\b|\bseafarer\b|\bjoin (a|my|the) (ship|vessel)\b/.test(purpose))
    return 'Marine crew';
  if (/\b(family member|spouse|child|dependant|dependent) of (a|an) (accredited )?diplomat\b|\bdiplomat'?s (spouse|wife|husband|child|family)\b/.test(purpose))
    return 'Family member of a diplomat';
  if (/\bdiplomatic (visit|mission|posting|assignment|duties)\b|\baccredited diplomat\b/.test(purpose))
    return 'Diplomatic visit';
  // Explicit words only: "work in Toronto" may be business or need a permit.
  if (/\bwork(ing)? without (a )?(work )?permit\b|\bwork[- ]permit[- ]exempt\b|\bexempt from (a |the )?work permit\b/.test(purpose))
    return 'Work without a work permit';
  const familyWords =
    /\b(family|son|daughter|child|children|grand\w*|parents?|mother|father|spouse|wife|husband|brother|sister|relatives?)\b/;
  const host = inviter(p);
  const rel = (
    pickText(host, 'relationship') ??
    pickText(p, 'relationship_to_host', 'relationship_to_inviter') ??
    ''
  ).toLowerCase();
  // Medical only when the applicant is the patient: "help my daughter after
  // her surgery" is a family visit, not IRCC's medical purpose (review
  // 2026-10-18).
  if (
    /medical (treatment|procedure)|surgery|operation/.test(purpose) &&
    !familyWords.test(purpose) &&
    !rel
  )
    return 'Medical treatment';
  if (
    /\b(business|conference|meeting|trade (show|fair)|training)\b/.test(
      purpose,
    ) &&
    !familyWords.test(purpose)
  )
    return 'Business';
  const status = (
    pickText(
      p,
      'inviter_status',
      'host_status',
      'host_immigration_status',
      'inviter_immigration_status',
    ) ?? ''
  ).toLowerCase();
  const settled = /citizen|permanent|\bpr\b/.test(status)
    ? true
    : /student|worker|work permit|temporar|visitor/.test(status)
      ? false
      : undefined;
  const bySettled = (citizen: string, temporary: string) =>
    settled === undefined ? undefined : settled ? citizen : temporary;
  const NEAR_CITIZEN =
    'Visit a spouse, parent or dependent child who is a Canadian citizen or permanent resident';
  const NEAR_TEMPORARY =
    'Visit a spouse, parent or dependent child who is in Canada temporarily';
  const WIDER_CITIZEN =
    'Visit a grandparent, grandchild, sibling or adult child who is a Canadian citizen or permanent resident';
  const OTHER = 'Visit other family or friends';
  if (rel) {
    // Order matters: "mother-in-law" is not a mother, "grandmother" not a
    // mother, "business partner" not a partner, "person" not a son.
    if (/business|colleague|employer|contact/.test(rel)) return undefined;
    if (
      /in-law|cousin|uncle|aunt|niece|nephew|friend|relative|family/.test(rel)
    )
      return OTHER;
    if (/\bgrand/.test(rel)) return bySettled(WIDER_CITIZEN, OTHER);
    if (/\b((half|step)-?)?(brother|sister|sibling)s?\b/.test(rel))
      return bySettled(WIDER_CITIZEN, OTHER);
    if (/\b(step-?)?(son|daughter|child|children)\b/.test(rel))
      // A child studying or working in Canada is usually still dependent.
      return bySettled(WIDER_CITIZEN, NEAR_TEMPORARY);
    if (/\b(spouse|wife|husband|common-law|partner)\b/.test(rel))
      return bySettled(NEAR_CITIZEN, NEAR_TEMPORARY);
    if (
      /\b(step-?)?(father|mother|parent)s?\b|\bguardian\b|\btutor\b/.test(rel)
    )
      return bySettled(NEAR_CITIZEN, NEAR_TEMPORARY);
  }
  if (/touris|sightsee|holiday|vacation/.test(purpose)) return 'Tourism';
  // The applicant's own words (E2E 2026-10-29), never on a family visit.
  if (
    /\bleisure\b|sight-seeing|\btour of\b|\bsee niagara\b/.test(purpose) &&
    !familyWords.test(purpose) &&
    !/\b(friends?|cousins?|uncles?|aunts?|nieces?|nephews?|in-laws?)\b|\bfianc/.test(
      purpose,
    )
  )
    return 'Tourism';
  // Study without a permit is only for 6 months or less; a longer course
  // needs a study permit, which this application is not. Checked after
  // Tourism, on explicit study words only.
  if (
    STUDY_INTENT.test(purpose) &&
    !TOURISM_WORDS.test(purpose) &&
    !familyWords.test(purpose) &&
    !rel &&
    withinSixMonths(p) === true
  )
    return 'Study for 6 months or less without a study permit';
  return undefined;
}

// ── addresses inside follow-ups and dialogs ─────────────────────────────────
/**
 * An address held as an object or one line, complete enough for IRCC: a
 * Canadian one needs civic number, street, city, province and postal code (the
 * manual-entry form); any other needs a street line, city and country. Live
 * 2026-10-18: a child or parent row whose "lives at your address?" is No does
 * not save without one, so an incomplete address is listed, not written.
 */
function anyAddress(v: unknown, fallbackCountry?: string): Address | undefined {
  let a: Address | undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Profile;
    a = {
      street: pickText(o, 'street', 'street_address', 'address_line1', 'line1'),
      streetNumber: pickText(
        o,
        'street_number',
        'house_number',
        'civic_number',
      ),
      streetName: pickText(o, 'street_name'),
      apartment: pickText(o, 'apartment', 'unit', 'apt', 'suite'),
      city: pickText(o, 'city', 'town', 'locality'),
      province: pickText(o, 'province', 'state', 'region'),
      postalCode: pickText(o, 'postal_code', 'postcode', 'zip', 'zip_code'),
      country: pickCountry(o, 'country') ?? fallbackCountry,
    };
  } else {
    a = parseAddressLine(v, fallbackCountry);
  }
  return a && (manualParts(a) || otherParts(a)) ? a : undefined;
}

/**
 * Countries IRCC asks in its manual-entry address form (live bundle
 * 2026-10-19: the address group shows the manual-entry checkbox, civic number,
 * street, apartment, city and a province / state / postal code of their own
 * for Canada, the United States and Mexico). Every other country takes one
 * street line, the city and an optional postal code.
 */
const MANUAL_ENTRY_COUNTRIES = ['CAN', 'USA', 'MEX'];

/** A United States or Mexico address as IRCC's manual-entry form asks it. */
interface NorthAmericanParts {
  streetNumber: string;
  streetName: string;
  apartment?: string;
  city: string;
  /** U.S.: the state's name (#state_ select). Mexico: the state as written. */
  state: string;
  /** U.S.: required ZIP, 12345 or 12345-6789. Mexico: optional, 5 digits. */
  postalCode?: string;
}

function northAmericanParts(
  a: Address | undefined,
): NorthAmericanParts | undefined {
  if (a?.country !== 'USA' && a?.country !== 'MEX') return undefined;
  let num = a.streetNumber;
  let name = a.streetName;
  let apartment = a.apartment;
  let street = a.street;
  const mexico = a.country === 'MEX';
  // "350 Fifth Avenue, Apt 4B": the unit has a field of its own. Its id holds
  // a digit or is one letter ("100 Unit Road" is a street). In Mexico "#"
  // marks the civic number ("Calle 5 # 23"), not a unit.
  const unit = (
    mexico
      ? /^(.+?),?\s+(?:apt\.?|apartment|unit|suite|int\.?|interior|depto\.?)\s*([\w-]*\d[\w-]*|[A-Za-z])$/i
      : /^(.+?),?\s+(?:apt\.?|apartment|unit|suite|ste\.?|#)\s*([\w-]*\d[\w-]*|[A-Za-z])$/i
  ).exec(street ?? '');
  if (unit && !apartment) [street, apartment] = [unit[1], unit[2]];
  if ((!num || !name) && street) {
    if (mexico) {
      // The number after "#", "No." or "Núm." ("Calle 5 # 23", Mérida's
      // "Calle 60 # 23 x 45 y 47" — the cross streets stay in the street),
      // else the last number ("Avenida Reforma 222"), else a leading one.
      const marked =
        /^(.+?)\s*(?:#|\bNo\.|\bNo\b|\bNúm\.?)\s*(\d+[A-Za-z]?)\b\s*(.*)$/i.exec(
          street,
        );
      const last = /^(.+?)\s+(\d+[A-Za-z]?)$/.exec(street);
      const lead = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(street);
      if (marked)
        [name, num] = [
          [marked[1], marked[3]].filter(Boolean).join(' '),
          marked[2],
        ];
      else if (last) [name, num] = [last[1], last[2]];
      else if (lead) [num, name] = [lead[1], lead[2]];
    } else {
      // Only a leading number: "PO Box 123" or "Route 66" has none.
      const lead = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(street);
      if (lead) [num, name] = [lead[1], lead[2]];
    }
  }
  const region = a.province?.trim();
  let state: string | undefined;
  let postalCode: string | undefined;
  const pc = a.postalCode?.trim();
  if (a.country === 'USA') {
    state = region
      ? (US_STATES[region.toUpperCase()] ??
        Object.values(US_STATES).find(
          (n) => n.toLowerCase() === region.toLowerCase(),
        ))
      : undefined;
    // IRCC's pattern: ^[0-9]{5}(?:-[0-9]{4})?$ — and it is required.
    postalCode = pc && /^\d{5}(?:-\d{4})?$/.test(pc) ? pc : undefined;
    if (!postalCode) return undefined;
  } else {
    state = region || undefined;
    // Optional for Mexico; a code IRCC would reject is left out.
    postalCode = pc && /^\d{5}$/.test(pc) ? pc : undefined;
  }
  if (!num || !name || !a.city || !state) return undefined;
  return {
    streetNumber: num,
    streetName: name,
    apartment,
    city: a.city,
    state,
    ...(postalCode ? { postalCode } : {}),
  };
}

/**
 * IRCC's apartment box takes at most 10 characters (bundle 2026-10-19,
 * max10Chars); a longer unit is kept on the street line instead of dropped.
 */
const shortApartment = (a: { apartment?: string } | undefined) =>
  a?.apartment && a.apartment.length <= 10 ? a.apartment : undefined;
const streetWithLongApartment = (
  a: { streetName: string; apartment?: string } | undefined,
) =>
  a && a.apartment && a.apartment.length > 10
    ? `${a.streetName} ${a.apartment}`
    : a?.streetName;

/** Complete for IRCC's manual-entry form (Canada, U.S., Mexico). */
const manualParts = (a: Address | undefined) =>
  canadianParts(a) ?? northAmericanParts(a);

interface CanadianParts {
  streetNumber: string;
  streetName: string;
  apartment?: string;
  city: string;
  province: string;
  postalCode: string;
}

function canadianParts(a: Address | undefined): CanadianParts | undefined {
  if (a?.country !== 'CAN') return undefined;
  let num = a.streetNumber;
  let name = a.streetName;
  if (!num || !name) {
    const m = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(a.street ?? '');
    if (m) [num, name] = [m[1], m[2]];
  }
  const prov = a.province
    ? (CA_PROVINCE_NAMES[a.province.toUpperCase()] ?? a.province)
    : provinceOfPostalCode(a.postalCode);
  // IRCC takes only "A1A 1A1" (live 2026-10-19); anything else is left.
  const postalCode = canadianPostalCode(a.postalCode);
  if (!num || !name || !a.city || !prov || !postalCode) return undefined;
  return {
    streetNumber: num,
    streetName: name,
    apartment: a.apartment,
    city: a.city,
    province: prov,
    postalCode,
  };
}

/** A Canadian postal code's first letter names its province (Canada Post). */
function provinceOfPostalCode(pc: string | undefined): string | undefined {
  const c = pc?.trim().charAt(0).toUpperCase();
  const code = c
    ? (
        {
          A: 'NL',
          B: 'NS',
          C: 'PE',
          E: 'NB',
          G: 'QC',
          H: 'QC',
          J: 'QC',
          K: 'ON',
          L: 'ON',
          M: 'ON',
          N: 'ON',
          P: 'ON',
          R: 'MB',
          S: 'SK',
          T: 'AB',
          V: 'BC',
          Y: 'YT',
        } as Record<string, string>
      )[c]
    : undefined; // X is shared by the Northwest Territories and Nunavut
  return code ? CA_PROVINCE_NAMES[code] : undefined;
}

function otherParts(
  a: Address | undefined,
): { street: string; city: string; postalCode?: string } | undefined {
  if (!a?.country || MANUAL_ENTRY_COUNTRIES.includes(a.country))
    return undefined;
  const street =
    a.street ?? [a.streetNumber, a.streetName].filter(Boolean).join(' ');
  if (!street || !a.city) return undefined;
  return { street, city: a.city, postalCode: a.postalCode };
}

/**
 * The manual-entry part of IRCC's address group `<group>` (Canada, the U.S.
 * and Mexico): tick "enter the address manually", then civic number, street,
 * apartment and city, and the country's own region and postal code fields —
 * #province_ and #postalcode_ (Canada), #state_ and #zipcode_ (U.S.),
 * #mexicoState_ and #postalcodeMexico_ (Mexico). Canada keeps its keys.
 */
function manualEntryFields(
  page: string,
  key: string,
  group: string,
  label: string,
  addr: (p: Profile) => Address | undefined,
  extra: Extra = {},
): FillFieldMapping[] {
  const ca = (p: Profile) => canadianParts(addr(p));
  const na = (p: Profile) => northAmericanParts(addr(p));
  const any = (p: Profile) => manualParts(addr(p));
  const us = (p: Profile) => (addr(p)?.country === 'USA' ? na(p) : undefined);
  const mx = (p: Profile) => (addr(p)?.country === 'MEX' ? na(p) : undefined);
  const quiet = { ...extra, silent: true };
  return [
    check(
      page,
      `${key}_manual`,
      `#manualEntryaddress_${group}-input`,
      `${label} — enter the address manually`,
      'addresses',
      (p) => (any(p) ? 'Yes' : undefined),
      quiet,
    ),
    text(
      page,
      `${key}_street_number`,
      `#streetNum_${group}`,
      `${label} — street number`,
      'addresses',
      (p) => any(p)?.streetNumber,
      quiet,
    ),
    text(
      page,
      `${key}_street_name`,
      `#street_${group}`,
      `${label} — street`,
      'addresses',
      (p) => streetWithLongApartment(any(p)),
      quiet,
    ),
    text(
      page,
      `${key}_apartment`,
      `#apartmentNumber_${group}`,
      `${label} — apartment / unit`,
      'addresses',
      (p) => shortApartment(any(p)),
      quiet,
    ),
    text(
      page,
      `${key}_city_ca`,
      `#city_${group}`,
      `${label} — city`,
      'addresses',
      (p) => any(p)?.city,
      quiet,
    ),
    optionText(
      page,
      `${key}_province`,
      `#province_${group}`,
      `${label} — province`,
      'addresses',
      (p) => ca(p)?.province,
      quiet,
    ),
    text(
      page,
      `${key}_postal_code_ca`,
      `#postalcode_${group}`,
      `${label} — postal code`,
      'addresses',
      (p) => ca(p)?.postalCode,
      quiet,
    ),
    optionText(
      page,
      `${key}_state`,
      `#state_${group}`,
      `${label} — state`,
      'addresses',
      (p) => us(p)?.state,
      quiet,
    ),
    text(
      page,
      `${key}_zip_code`,
      `#zipcode_${group}`,
      `${label} — ZIP code`,
      'addresses',
      (p) => us(p)?.postalCode,
      quiet,
    ),
    text(
      page,
      `${key}_mexico_state`,
      `#mexicoState_${group}`,
      `${label} — state`,
      'addresses',
      (p) => mx(p)?.state,
      quiet,
    ),
    text(
      page,
      `${key}_postal_code_mx`,
      `#postalcodeMexico_${group}`,
      `${label} — postal code`,
      'addresses',
      (p) => mx(p)?.postalCode,
      quiet,
    ),
  ];
}

/**
 * IRCC's address group `<group>`: the country, then the manual-entry form
 * (Canada, U.S., Mexico — manualEntryFields) or any other country's single
 * street line (`streetAddress_`, `city_`, `postalcodeother_`).
 */
function addressFields(
  page: string,
  key: string,
  group: string,
  label: string,
  addr: (p: Profile) => Address | undefined,
  extra: Extra = {},
): FillFieldMapping[] {
  // Profile keys of their own: "residential_address_city" is a real profile
  // key, and a value stored under a field's key wins over its derive (review
  // 2026-10-18).
  key = key.startsWith('ircc_') ? key : `ircc_${key}`;
  const manual = (p: Profile) => manualParts(addr(p));
  const other = (p: Profile) => otherParts(addr(p));
  const quiet = { ...extra, silent: true };
  return [
    country(
      page,
      `${key}_country`,
      `#country_${group}`,
      `${label} — country`,
      'addresses',
      (p) => (manual(p) || other(p) ? addr(p)?.country : undefined),
      extra,
    ),
    ...manualEntryFields(page, key, group, label, addr, extra),
    text(
      page,
      `${key}_street`,
      `#streetAddress_${group}`,
      `${label} — street address`,
      'addresses',
      (p) => other(p)?.street,
      quiet,
    ),
    text(
      page,
      `${key}_city`,
      `#city_${group}`,
      `${label} — city`,
      'addresses',
      (p) => other(p)?.city,
      quiet,
    ),
    text(
      page,
      `${key}_postal_code`,
      `#postalcodeother_${group}`,
      `${label} — postal code`,
      'addresses',
      (p) => other(p)?.postalCode,
      quiet,
    ),
  ];
}

// ── facts ───────────────────────────────────────────────────────────────────
/** The place of birth as one line, from whichever key the extractor used. */
const birthPlace = (p: Profile) =>
  pickText(p, 'place_of_birth', 'birth_place', 'birthplace');
const birthCountry = (p: Profile) =>
  pickCountry(
    p,
    'country_of_birth',
    'birth_country',
    'place_of_birth_country',
    'birthplace_country',
  ) ?? splitPlace(birthPlace(p)).country;
// Live 2026-10-18 (super visa, app 61f16bb5): the profile held
// birthplace_city "Rawalpindi" beside an empty place_of_birth, and IRCC's
// city of birth was left empty.
const birthCity = (p: Profile) =>
  pickText(
    p,
    'city_of_birth',
    'birth_city',
    'place_of_birth_city',
    'birthplace_city',
    'town_of_birth',
  ) ?? splitPlace(birthPlace(p)).city;
const nationality = (p: Profile) =>
  pickCountry(
    p,
    'nationality',
    'citizenship',
    'country_of_citizenship',
    'applicant_citizenship',
    'applicant_nationality',
  );

function multipleCitizenship(p: Profile): 'Yes' | 'No' | undefined {
  const yn = declared(
    p,
    'multiple_citizenship',
    'dual_citizenship',
    'dual_national',
    'has_multiple_citizenships',
  );
  if (yn) return yn;
  const other = pick(
    p,
    'other_citizenships',
    'other_citizenship',
    'additional_citizenships',
  );
  if (Array.isArray(other)) return other.length === 0 ? 'No' : 'Yes';
  return declared(p, 'other_citizenships', 'other_citizenship');
}

/**
 * Every key a national ID number is held under. Live 2026-10-18 (super visa,
 * app 61f16bb5): the profile said national_identity_card_number and the whole
 * National identity document page was skipped.
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
];
const nationalIdNumber = (p: Profile) =>
  pickText(p, ...NATIONAL_ID_NUMBER_KEYS);
const nationalIdIssueDate = (p: Profile) =>
  pickDate(
    p,
    'national_id_issue_date',
    'national_identity_card_issue_date',
    'national_identity_document_issue_date',
    'national_id_card_issue_date',
    'cnic_issue_date',
    'id_issue_date',
    'national_id_date_of_issue',
  );

function hasNationalId(p: Profile): 'Yes' | 'No' | undefined {
  return (
    declared(p, 'has_national_id', 'has_national_identity_document') ??
    (nationalIdNumber(p) ? 'Yes' : undefined)
  );
}

/** The applicant said this is a group (or family) application. */
const isGroupApplication = (p: Profile) =>
  declared(
    p,
    'ircc_group_application',
    'group_application',
    'is_group_application',
    'applying_as_group',
    'family_group_application',
  ) === 'Yes';

/** Travelling to Canada by air: an explicit answer, or a stated way of travel. */
function travellingByAir(p: Profile): 'Yes' | 'No' | undefined {
  const yn = declared(
    p,
    'travelling_by_air',
    'travel_by_air',
    'arriving_by_air',
    'flying_to_canada',
  );
  if (yn) return yn;
  const mode = (
    pickText(p, 'travel_mode', 'mode_of_travel', 'means_of_travel') ?? ''
  ).toLowerCase();
  if (/\b(air|fly|flying|flight|plane|airline)\b/.test(mode)) return 'Yes';
  if (/\b(land|car|bus|train|road|sea|ship|boat|cruise|ferry)\b/.test(mode))
    return 'No';
  return undefined;
}

function hasOtherNames(p: Profile): 'Yes' | 'No' | undefined {
  for (const k of [
    'has_other_names',
    'used_other_names',
    'other_names',
    'aliases',
    'previous_names',
  ]) {
    const v = p[k];
    // A listed name that is the applicant's current name is no other name.
    if (Array.isArray(v))
      return v.filter((x) => !isCurrentName(x, p)).length === 0 ? 'No' : 'Yes';
    const yn = declared(p, k);
    if (yn) return yn;
    if (typeof v === 'string' && v.trim())
      return isCurrentName(v, p) ? 'No' : 'Yes'; // a name
  }
  return undefined;
}

/**
 * A "Yes" that opens a table IRCC requires at least one row in (other names,
 * children, trips) is written only when the assistant adds a complete row.
 * Otherwise the page cannot be saved (live 2026-10-18: hasOtherNames "Yes"
 * with no name row) — the question is left, with a note, for the applicant.
 */
function yesOnlyWithRow(
  yn: 'Yes' | 'No' | undefined,
  hasRow: boolean,
): 'Yes' | 'No' | undefined {
  return yn === 'Yes' && !hasRow ? undefined : yn;
}

function biometricsGiven(p: Profile): 'Yes' | 'No' | undefined {
  return (
    declared(
      p,
      'biometrics_given_before',
      'has_given_biometrics',
      'previous_biometrics',
      'biometrics_given',
    ) ??
    (pickDate(p, 'biometrics_enrollment_date', 'biometrics_date')
      ? 'Yes'
      : undefined)
  );
}

/**
 * Valid biometrics may be re-used only while they cover the planned entry;
 * ones that expire before it are given again (audit 2026-10-19: that answer
 * was left to the applicant though the dates decide it).
 */
function biometricsReuse(p: Profile): string | undefined {
  const until = pickDate(p, 'biometrics_valid_until', 'biometrics_expiry_date');
  const entry = pickDate(p, 'planned_entry_date');
  if (!until || !entry) return undefined;
  return until >= entry
    ? 'Re-use my valid biometrics'
    : 'Give my biometrics again';
}

/** A U.S. lawful permanent resident (Green Card holder): explicit answer. */
const greenCard = (p: Profile) =>
  declared(
    p,
    'us_green_card',
    'us_permanent_resident',
    'has_green_card',
    'has_us_green_card',
    'is_us_permanent_resident',
    'us_lawful_permanent_resident',
  );

/**
 * A U.S. lawful permanent resident needs no visitor visa or eTA (IRCC tr-rt,
 * live 2026-10-31: answering "Yes" routes to "You don't need to apply for
 * anything"). Shown on the travel-document page instead of answering it.
 */
export const GREEN_CARD_NOTE =
  'You told us you are a lawful permanent resident of the United States (Green Card holder). IRCC says a U.S. permanent resident needs no visitor visa and no eTA to visit Canada: travel with your valid passport and Green Card. The assistant did not answer this question; if you still apply, answer it yourself (IRCC then tells you that you do not need to apply).'

/**
 * A question IRCC asks only for a passport from one country (tr-rt bundle
 * 2026-10-19: hasTaiwanPassport, hasIsraeliPassport, hasRomaniaPassport,
 * shown by codePassport): the explicit answer, and only for that passport.
 */
const passportOf =
  (iso3: string, key: string) =>
  (p: Profile): 'Yes' | 'No' | undefined =>
    nationality(p) === iso3 ? declared(p, key) : undefined;

/** Taiwan's personal identification number: letters and digits, at most 20. */
function taiwanPersonalId(p: Profile): string | undefined {
  const v = pickText(p, 'taiwan_personal_id_number', 'taiwan_personal_id')
    ?.replace(/[\s-]/g, '')
    .toUpperCase();
  return v && /^[A-Z0-9]{1,20}$/.test(v) ? v : undefined;
}
const taiwanPassport = passportOf('TWN', 'taiwan_passport_with_personal_id');

const holdsUsVisa = (p: Profile) =>
  declared(
    p,
    'holds_us_visa',
    'has_us_visa',
    'has_valid_us_visa',
    'valid_us_nonimmigrant_visa',
    'us_nonimmigrant_visa',
  );

const usVisaInOtherPassport = (p: Profile) =>
  declared(p, 'us_visa_in_other_passport', 'us_visa_different_passport');

/** The other passport the U.S. visa is in: every part IRCC requires, or nothing. */
function usVisaPassport(
  p: Profile,
):
  | { country: string; number: string; issued: string; expires: string }
  | undefined {
  const country = pickCountry(p, 'us_visa_passport_country');
  const number = pickText(p, 'us_visa_passport_number');
  const issued = pickDate(p, 'us_visa_passport_issue_date');
  const expires = pickDate(p, 'us_visa_passport_expiry_date');
  return country && number && issued && expires
    ? { country, number, issued, expires }
    : undefined;
}

/** The other passport's fields, revealed by "a different passport: Yes". */
const US_VISA_PASSPORT_SHOWN: Extra = {
  reveal: true,
  parent: 'us_visa_in_other_passport',
  parentValue: 'Yes',
  silent: true,
};

const militaryService = (p: Profile) =>
  declared(p, 'military_service', 'served_in_military', 'served_army');

function citizenFromBirth(p: Profile): 'Yes' | 'No' | undefined {
  return declared(
    p,
    'citizen_from_birth',
    'citizenship_by_birth',
    'citizen_since_birth',
  );
}

/** When a citizen by naturalisation became one. */
const citizenshipDate = (p: Profile) =>
  pickDate(
    p,
    'citizenship_acquired_date',
    'citizenship_date',
    'date_became_citizen',
    'naturalization_date',
    'naturalisation_date',
  );

// Inviter = the host in Canada.
//
// The interview records the host under several names: `inviter_*` / `host_*`
// when asked about an invitation, but also as the family member being visited
// (`family_member_name`, `relationship_to_family_in_destination`) or the
// person providing accommodation (`accommodation_provider_name`,
// `accommodation_address`). Dry run 2026-10-16: the host was known all along,
// and the invitation page was left blank. The representative's phone, email
// and address are used only when the representative IS the host. A provider
// that is lodging (hotel, hostel, Airbnb) is never the inviter (E2E
// 2026-10-29: the hotel was written as the inviter of a tourist), nor is a
// hotel chain named without the word "hotel" (review of 4a13b7cb).
const LODGING =
  /\b(hotels?|easyhotel|hostels?|inns?|motels?|lodges?|guest ?houses?|airbnb|vrbo|b&b|bnb|bed and breakfast|resorts?|suites|fairmont|marriott|sheraton|hilton|hyatt|best western|radisson|delta|westin|novotel|ibis)\b/i;
const isLodging = (x: string) =>
  LODGING.test(x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
function inviter(p: Profile): Profile {
  const obj = pick(p, 'inviter', 'host', 'host_in_canada');
  const o =
    obj && typeof obj === 'object' && !Array.isArray(obj)
      ? (obj as Profile)
      : {};
  const flat = (k: string) =>
    pick(p, `inviter_${k}`, `host_${k}`) ?? o[k] ?? o[`${k}`];
  const visiting =
    declared(p, 'family_in_destination') !== 'No'
      ? pickText(p, 'family_member_name')
      : undefined;
  const name =
    flat('name') ??
    flat('full_name') ??
    visiting ??
    [pickText(p, 'accommodation_provider_name')].find(
      (x) => !!x && !isLodging(x),
    );
  const repName = pickText(p, 'representative_name');
  const named =
    typeof name === 'string'
      ? name
      : [flat('given_name'), flat('family_name')]
          .filter((x): x is string => typeof x === 'string' && !!x.trim())
          .join(' ') || undefined;
  const repIsHost = !!repName && !!named && isSamePerson(repName, named);
  const providerIsHost =
    !!named &&
    !!pickText(p, 'accommodation_provider_name') &&
    isSamePerson(pickText(p, 'accommodation_provider_name'), named);
  const repContact = repIsHost
    ? (pickText(p, 'representative_phone', 'representative_telephone') ??
      pickText(p, 'representative_contact'))
    : undefined;
  return {
    family_name: flat('family_name') ?? flat('last_name'),
    given_name: flat('given_name') ?? flat('first_name'),
    name,
    relationship:
      flat('relationship') ??
      pick(p, 'relationship_to_host', 'relationship_to_inviter') ??
      (visiting && name === visiting
        ? pick(p, 'relationship_to_family_in_destination')
        : undefined),
    address:
      flat('address') ??
      (providerIsHost ? pick(p, 'accommodation_address') : undefined) ??
      (repIsHost ? pick(p, 'representative_address') : undefined),
    phone:
      flat('phone') ??
      flat('telephone') ??
      flat('phone_number') ??
      (repContact && !repContact.includes('@') ? repContact : undefined),
    organization:
      flat('organization') ??
      flat('organization_name') ??
      flat('organisation') ??
      flat('organisation_name') ??
      flat('company') ??
      flat('company_name'),
    phone_type: flat('phone_type') ?? flat('telephone_type'),
    phone_country_code:
      flat('phone_country_code') ?? flat('telephone_country_code'),
    email:
      flat('email') ??
      (repIsHost
        ? (pickText(p, 'representative_email') ??
          (repContact?.includes('@') ? repContact : undefined))
        : undefined),
  };
}
const inviterName = (p: Profile) => {
  const i = inviter(p);
  return nameParts(
    {
      x_family_name: i.family_name,
      x_given_name: i.given_name,
      x_name: i.name,
    },
    'x',
  );
};

/**
 * An inviter's relationship as IRCC's options (Family member, Friend,
 * Conference, Organization), whole words only: "Mr Johnson" is not a son,
 * "contact person" not a son, "schoolmate" not a school (review 2026-10-18).
 * Someone else's relation ("colleague of my son", "friend of my daughter")
 * or a colleague / neighbour is none of the four: left for the applicant.
 */
export function relationshipOption(raw: unknown): string | undefined {
  const r = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!r) return undefined;
  // IRCC's own options, as chosen on the Forms page.
  if (/^family member$/.test(r)) return 'Family member';
  if (/\b(of|to) (my|our|the|his|her)\b/.test(r)) return undefined;
  if (
    /\b(colleagues?|co-?workers?|neighbou?rs?|acquaintances?|classmates?|schoolmates?|contact|boss|teacher)\b/.test(
      r,
    )
  )
    return undefined;
  if (/\bfriends?\b/.test(r)) return 'Friend';
  if (/\b(conference|event)\b/.test(r)) return 'Conference';
  // A business partner is the company the applicant deals with, not an
  // event: Organization (business-visitor audit 2026-10-19).
  if (
    /\b(organi[sz]ation|company|employer|business partners?|university|college|school)\b/.test(
      r,
    )
  )
    return 'Organization';
  if (relationshipKind(r)) return 'Family member';
  return undefined;
}

function inviterRelationship(p: Profile): string | undefined {
  return relationshipOption(pickText(inviter(p), 'relationship'));
}

const relationshipKind = (r: string): boolean =>
  /\b(brothers?|sisters?|siblings?|sons?|daughters?|child|children|parents?|mother|father|cousins?|uncle|aunt|niece|nephew|grand\w*|spouse|wife|husband|family|relatives?|in-laws?)\b/.test(
    r,
  );

/**
 * The first inviter's relationship, phone type and email as the IRCC fill
 * reads them (inviter(): every alias, the visited family member, the
 * representative when they are the host), for the Forms page to show as
 * answered. A relationship the fill cannot place is not an answer.
 */
export function inviterAnswers(p: Profile): {
  relationship?: string;
  phoneType?: string;
  email?: string;
} {
  const i = inviter(p);
  const relationship = pickText(i, 'relationship');
  const phoneType = pickText(i, 'phone_type');
  return {
    relationship: relationshipOption(relationship) ? relationship : undefined,
    phoneType: phoneTypeOption(phoneType) ? phoneType : undefined,
    email: pickText(i, 'email'),
  };
}

/** The relationships that make IRCC ask for the organization's name. */
export const INVITER_IS_ORGANIZATION = ['Organization', 'Conference'] as const;

const inviterAddress = (p: Profile) => parseCanadianAddress(inviter(p).address);

/**
 * The inviter's phone, placed (phone-numbers.ts). The inviter is the host IN
 * Canada, so an unprefixed North American number is theirs; a number with
 * another +CC (the host's phone back home) goes in as "Other".
 */
function inviterPhone(p: Profile): PlacedPhone | undefined {
  const i = inviter(p);
  return placePhone(pickText(i, 'phone'), {
    country: 'CAN',
    countryCode: pickText(i, 'phone_country_code'),
  });
}

function phoneTypeOption(raw: string | undefined): string | undefined {
  const t = raw?.toLowerCase();
  if (!t) return undefined;
  if (/cell|mobile/.test(t)) return 'Cellular';
  if (/home|residen|landline/.test(t)) return 'Residence';
  return 'Other';
}

function inviterPhoneType(p: Profile): string | undefined {
  return phoneTypeOption(pickText(inviter(p), 'phone_type'));
}

/**
 * Money for the trip in CAD: a CAD-named amount, or a plain amount whose
 * recorded currency is CAD (live 2026-10-18: available_funds 5000 with
 * funds_currency CAD left IRCC's field empty). An amount in another currency,
 * or with no currency stated, is never presented as CAD.
 */
function tripFundsCad(p: Profile): unknown {
  const cad = pick(p, 'available_funds_cad', 'trip_funds_cad');
  if (cad !== undefined && cad !== null && cad !== '') return cad;
  const currency = pickText(p, 'funds_currency', 'available_funds_currency');
  if (!currency || !/^\s*(cad|c\$|canadian dollars?)\s*$/i.test(currency))
    return undefined;
  return pick(p, 'available_funds', 'funds_available', 'trip_funds');
}

const MEDICAL_NUMBER_KEYS = [
  'medical_exam_number',
  'medical_exam_reference_number',
  'ime_number',
  'umi_number',
  'medical_number',
  'medical_reference_number',
];

/**
 * The IME or UMI number in a format IRCC accepts (live validation
 * 2026-10-18): a UMI is 2 letters + 8 or 9 digits, or "U" + 9 digits; an IME
 * is digits only — 8 digits here, since a 10-digit number was rejected.
 * Spaces and dashes are dropped; anything else is left for the applicant.
 */
export function medicalExamNumber(p: Profile): string | undefined {
  const raw = pickText(p, 'ircc_medical_exam_number', ...MEDICAL_NUMBER_KEYS);
  return raw ? irccMedicalNumber(raw) : undefined;
}

// ── second inviter (live ids 2026-10-18) ────────────────────────────────────
/**
 * The second person inviting the applicant, from their own keys only
 * (`second_inviter_*`, `second_host_*`, or a `second_inviter` record). Never
 * the host's: a second inviter who lives with the host still has their own
 * details, and a missing one is left for the applicant, not copied.
 */
function secondInviter(p: Profile): Profile {
  const obj = pick(p, 'second_inviter', 'second_host');
  const o =
    obj && typeof obj === 'object' && !Array.isArray(obj)
      ? (obj as Profile)
      : {};
  const flat = (...ks: string[]) => {
    for (const k of ks) {
      // The block's own (ircc_) keys first: a correction made in the
      // consultant review must reach the derived answers too.
      const v =
        pick(
          p,
          `ircc_second_inviter_${k}`,
          `second_inviter_${k}`,
          `second_host_${k}`,
        ) ?? o[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };
  return {
    family_name: flat('family_name', 'last_name', 'surname'),
    given_name: flat('given_name', 'first_name'),
    name: flat('name', 'full_name') ?? pick(p, 'additional_inviter_name'),
    relationship: flat('relationship'),
    organization: flat(
      'organization_name',
      'organization',
      'company_name',
      'company',
    ),
    address: flat('address', 'home_address'),
    phone: flat('phone', 'phone_number', 'telephone'),
    phone_type: flat('phone_type', 'telephone_type'),
    phone_country_code: flat('phone_country_code', 'telephone_country_code'),
    email: flat('email', 'email_address'),
  };
}
const hasSecondInviter = (p: Profile) =>
  declared(p, 'has_second_inviter', 'second_inviter') === 'Yes';
const secondInviterName = (p: Profile) => {
  const i = secondInviter(p);
  return nameParts(
    {
      x_family_name: i.family_name,
      x_given_name: i.given_name,
      x_name: i.name,
    },
    'x',
  );
};
function secondInviterRelationship(p: Profile): string | undefined {
  return relationshipOption(pickText(secondInviter(p), 'relationship'));
}

/** The second inviter's facts as the IRCC fill reads them, for the Forms page. */
export function secondInviterAnswers(
  p: Profile,
): Record<string, string | undefined> {
  const i = secondInviter(p);
  const relationship = pickText(i, 'relationship');
  const phoneType = pickText(i, 'phone_type');
  return {
    name:
      pickText(i, 'name') ??
      ([pickText(i, 'given_name'), pickText(i, 'family_name')]
        .filter(Boolean)
        .join(' ') ||
        undefined),
    relationship: relationshipOption(relationship) ? relationship : undefined,
    address: pickText(i, 'address'),
    phone: pickText(i, 'phone'),
    phoneType: phoneTypeOption(phoneType) ? phoneType : undefined,
    email: pickText(i, 'email'),
  };
}
const secondInviterAddress = (p: Profile) =>
  parseCanadianAddress(secondInviter(p).address);
/**
 * The second inviter's phone, placed like the first inviter's: a North
 * American number, or after "Other" the dialling code
 * (#telCountryCode_phoneNumberInviterTwo, live 2026-10-19 — the same shape as
 * the other phone groups) and the national number.
 */
function secondInviterPhone(p: Profile): PlacedPhone | undefined {
  const i = secondInviter(p);
  return placePhone(pickText(i, 'phone'), {
    country: 'CAN',
    countryCode: pickText(i, 'phone_country_code'),
  });
}

/** The second inviter's organization or conference, when IRCC asks it. */
function secondInviterOrganization(p: Profile): string | undefined {
  const kind = secondInviterRelationship(p);
  return kind && (INVITER_IS_ORGANIZATION as readonly string[]).includes(kind)
    ? pickText(secondInviter(p), 'organization')
    : undefined;
}

const digitsOf = (v: unknown) =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
    .replace(/\D/g, '')
    .slice(-10);
const flatText = (v: unknown) =>
  (typeof v === 'string' ? v : '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The second inviter is typed only when they are clearly someone other than
 * the host: their own name, not the host's (in any word order or length),
 * none of the host's phone, email or address, and not data the
 * second-inviter router moved over on a guess (`second_inviter_source:
 * 'router'`). Prod 2026-10-16 (61f16bb5): the host, "Mian Muhammad
 * Bilawal", named again as "Bilawal Muzaffar" with his own phone and house,
 * was routed to the second inviter.
 */
function secondInviterConfirmed(p: Profile): boolean {
  if (!hasSecondInviter(p)) return false;
  if (pickText(p, 'second_inviter_source') === 'router') return false;
  const second = secondInviter(p);
  const name = secondInviterName(p);
  if (!name.family) return false;
  const full =
    pickText(second, 'name') ??
    [name.given, name.family].filter(Boolean).join(' ');
  const host = inviter(p);
  const hostName =
    pickText(host, 'name') ??
    [pickText(host, 'given_name'), pickText(host, 'family_name')]
      .filter(Boolean)
      .join(' ');
  if (hostName && full && samePerson(full, hostName)) return false;
  const phone = digitsOf(second.phone);
  if (phone && phone === digitsOf(host.phone)) return false;
  const email = pickText(second, 'email')?.toLowerCase();
  if (email && email === pickText(host, 'email')?.toLowerCase()) return false;
  const address = flatText(second.address);
  if (address && address === flatText(host.address)) return false;
  return true;
}

/** IRCC's second-inviter block, revealed by "A second person is inviting you: Yes". */
function secondInviterFields(): FillFieldMapping[] {
  // Silent: one "Second inviter" note lists what is missing (secondInviterGaps).
  const shown: Extra = {
    reveal: true,
    parent: 'has_second_inviter',
    parentValue: 'Yes',
    silent: true,
  };
  const manual: Extra = {
    reveal: true,
    parent: 'ircc_second_inviter_manual_address',
    silent: true,
  };
  const only = (p: Profile) => secondInviterConfirmed(p);
  return [
    text(
      INVITER,
      'ircc_second_inviter_family_name',
      '#secondInviter_lastName_input',
      'Second inviter — family name',
      'addresses',
      (p) => (only(p) ? secondInviterName(p).family : undefined),
      shown,
    ),
    text(
      INVITER,
      'ircc_second_inviter_given_name',
      '#secondInviter_firstName_input',
      'Second inviter — given name',
      'addresses',
      (p) => (only(p) ? secondInviterName(p).given : undefined),
      shown,
    ),
    optionText(
      INVITER,
      'ircc_second_inviter_relationship',
      '#relationInviterTwo_select',
      'Second inviter — relationship to you',
      'addresses',
      (p) => (only(p) ? secondInviterRelationship(p) : undefined),
      shown,
    ),
    // Organization or Conference reveals "Name of organization or
    // conference" (#nameOfOrgInviterTwo_input, live 2026-10-19).
    text(
      INVITER,
      'ircc_second_inviter_organization_name',
      '#nameOfOrgInviterTwo_input',
      'Second inviter — name of organization or conference',
      'addresses',
      (p) => (only(p) ? secondInviterOrganization(p) : undefined),
      {
        reveal: true,
        parent: 'ircc_second_inviter_relationship',
        parentValue: INVITER_IS_ORGANIZATION,
        silent: true,
      },
    ),
    check(
      INVITER,
      'ircc_second_inviter_manual_address',
      '#manualEntryaddress_inviterTwoAddress-input',
      'Second inviter — enter the address manually',
      'addresses',
      (p) => (only(p) && secondInviterAddress(p) ? 'Yes' : undefined),
      shown,
    ),
    text(
      INVITER,
      'ircc_second_inviter_street_number',
      '#streetNum_inviterTwoAddress',
      'Second inviter — street number',
      'addresses',
      (p) => secondInviterAddress(p)?.streetNumber,
      manual,
    ),
    text(
      INVITER,
      'ircc_second_inviter_street',
      '#street_inviterTwoAddress',
      'Second inviter — street',
      'addresses',
      (p) => secondInviterAddress(p)?.streetName,
      manual,
    ),
    text(
      INVITER,
      'ircc_second_inviter_apartment',
      '#apartmentNumber_inviterTwoAddress',
      'Second inviter — apartment / unit',
      'addresses',
      (p) => secondInviterAddress(p)?.apartment,
      manual,
    ),
    text(
      INVITER,
      'ircc_second_inviter_city',
      '#city_inviterTwoAddress',
      'Second inviter — city',
      'addresses',
      (p) => secondInviterAddress(p)?.city,
      manual,
    ),
    optionText(
      INVITER,
      'ircc_second_inviter_province',
      '#province_inviterTwoAddress',
      'Second inviter — province',
      'addresses',
      (p) => secondInviterAddress(p)?.province,
      manual,
    ),
    text(
      INVITER,
      'ircc_second_inviter_postal_code',
      '#postalcode_inviterTwoAddress',
      'Second inviter — postal code',
      'addresses',
      (p) => secondInviterAddress(p)?.postalCode,
      manual,
    ),
    radio(
      INVITER,
      'ircc_second_inviter_phone_type',
      'telType_phoneNumberInviterTwo',
      'Second inviter — telephone type',
      'addresses',
      { Residence: '01', Cellular: '02', Other: '05' },
      (p) =>
        only(p)
          ? phoneTypeOption(pickText(secondInviter(p), 'phone_type'))
          : undefined,
      shown,
    ),
    ...telephone(
      INVITER,
      {
        location: 'ircc_second_inviter_phone_location',
        number: 'ircc_second_inviter_phone',
      },
      'phoneNumberInviterTwo',
      {
        location: 'Second inviter — telephone location',
        code: 'Second inviter — telephone country code',
        number: 'Second inviter — telephone number',
      },
      (p) => (only(p) ? secondInviterPhone(p) : undefined),
      shown,
    ),
    text(
      INVITER,
      'ircc_second_inviter_email',
      '#emailAddressInviterTwo_input',
      'Second inviter — email',
      'addresses',
      (p) => (only(p) ? pickText(secondInviter(p), 'email') : undefined),
      shown,
    ),
  ];
}

// ── representative (IMM 5476) ───────────────────────────────────────────────
// /representative, recorded live 2026-10-15: "Are you applying on behalf of
// someone else?" (hasRepresentative -01 Yes / -02 No), then the unpaid
// representative's relationship (#unpaidType_select: Family member / Friend /
// Other, recorded 2026-10-17), name (#lastName_input / #firstName_input, page
// scoped), telephone (…_phoneNumberRep), address (…_representativeAddress)
// and email (#emailContactInfo_input + Repeat).
function usesRepresentative(p: Profile): 'Yes' | 'No' | undefined {
  return declared(
    p,
    'uses_representative',
    'has_representative',
    'using_representative',
    'uses_authorized_representative',
  );
}

/** Details are filled only for an UNPAID representative: a paid one's page asks for a membership ID we do not record. */
function unpaidRepresentative(p: Profile): boolean {
  if (usesRepresentative(p) !== 'Yes') return false;
  return declared(p, 'representative_paid', 'is_paid_representative') === 'No';
}

/** The unpaid representative's relationship, as #unpaidType_select lists it. */
function representativeRelationship(p: Profile): string | undefined {
  if (!unpaidRepresentative(p)) return undefined;
  const own = pickText(
    p,
    'representative_relationship',
    'representative_relationship_to_applicant',
  )?.toLowerCase();
  if (own) {
    if (/friend/.test(own)) return 'Friend';
    if (/other|consultant|lawyer|agent|colleague/.test(own)) return 'Other';
    return relationshipKind(own) ? 'Family member' : undefined;
  }
  const repName = pickText(p, 'representative_name');
  const hostName =
    pickText(inviter(p), 'name') ?? pickText(p, 'family_member_name');
  if (!repName || !hostName || !isSamePerson(repName, hostName))
    return undefined;
  const host = inviterRelationship(p);
  return host === 'Family member' || host === 'Friend' ? host : undefined;
}

const representativeNames = (p: Profile) =>
  unpaidRepresentative(p) ? nameParts(p, 'representative') : {};

function representativeContactParts(p: Profile): {
  email?: string;
  phone?: string;
} {
  const contact = pickText(p, 'representative_contact') ?? '';
  const email =
    pickText(p, 'representative_email') ??
    /[^\s,;]+@[^\s,;]+\.[^\s,;]+/.exec(contact)?.[0];
  const phone =
    pickText(p, 'representative_phone', 'representative_telephone') ??
    (contact.replace(/[^\s,;]+@[^\s,;]+/g, '').trim() || undefined);
  return { email, phone };
}

/** The representative's own email, or the host's when they are the same person. */
function representativeEmail(p: Profile): string | undefined {
  if (!unpaidRepresentative(p)) return undefined;
  const own = representativeContactParts(p).email;
  if (own) return own;
  const host = inviter(p);
  const repName = pickText(p, 'representative_name');
  const hostName = pickText(host, 'name') ?? pickText(p, 'family_member_name');
  return repName && hostName && isSamePerson(repName, hostName)
    ? pickText(host, 'email')
    : undefined;
}

/** Whether the representative is the host in Canada (same person). */
function representativeIsHost(p: Profile): boolean {
  const repName = pickText(p, 'representative_name');
  const hostName =
    pickText(inviter(p), 'name') ?? pickText(p, 'family_member_name');
  return !!repName && !!hostName && isSamePerson(repName, hostName);
}

/**
 * The unpaid representative's phone, placed (phone-numbers.ts). Where they
 * live: their recorded Canadian address, or Canada when they are the host.
 * Otherwise unknown — only a number written with +CC is placed, since an
 * unpaid helper may live anywhere.
 */
function representativePhone(p: Profile): PlacedPhone | undefined {
  if (!unpaidRepresentative(p)) return undefined;
  return placePhone(representativeContactParts(p).phone, {
    country:
      representativeAddress(p)?.country ??
      (representativeIsHost(p) ? 'CAN' : undefined),
    countryCode: pickText(
      p,
      'representative_phone_country_code',
      'representative_telephone_country_code',
    ),
  });
}

function representativePhoneType(p: Profile): string | undefined {
  if (!representativePhone(p)) return undefined;
  const own = phoneTypeOption(pickText(p, 'representative_phone_type'));
  if (own) return own;
  return representativeIsHost(p) ? inviterPhoneType(p) : undefined;
}

const representativeAddress = (p: Profile) =>
  unpaidRepresentative(p)
    ? parseCanadianAddress(pick(p, 'representative_address'))
    : undefined;

/** Who pays for the trip, in the applicant's words. */
const payerText = (p: Profile) =>
  pickText(
    p,
    'financial_support',
    'trip_expenses_paid_by',
    'who_pays_trip',
    'travel_expenses_paid_by',
    'expenses_paid_by',
  );

function fundsShared(p: Profile): 'Yes' | 'No' | undefined {
  const yn = declared(
    p,
    'funds_shared',
    'someone_else_paying',
    'financial_support_from_other',
    'funds_provided_by_other',
    'is_sponsored',
  );
  if (yn) return yn;
  // A named supporter other than the applicant is an explicit Yes.
  const named = pickText(p, 'financial_supporter', 'sponsor_name');
  if (named && tripPayer(named) !== 'self') return 'Yes';
  const s = payerText(p);
  if (!s) return named ? 'No' : undefined;
  // Live 2026-10-19 (business visitor): "trip_expenses_paid_by: Self" left the
  // question blank. The applicant paying, with nobody else named, is a No.
  // Audit 2026-10-19: "Pension" or "Savings" was written as Yes — someone
  // else giving money — for a retired parent paying their own way. Only a
  // payer the words place is answered; anything else is the applicant's.
  const who = tripPayer(s);
  if (who) return who === 'self' ? 'No' : 'Yes';
  return declared(p, 'financial_support');
}

/**
 * Words that name someone other than the applicant paying: a host, a
 * relative, an employer or company, a sponsor or inviter. Any one of them
 * makes the trip partly paid by someone else ("Self and my son" is Yes).
 */
const OTHER_PAYER =
  /\b(host|hosts|inviter|inviting|invitation|sponsor|sponsors|sponsored|sponsoring|son|sons|daughter|daughters|child|children|kids?|family|families|parents?|mother|father|mum|mom|dad|brother|brothers|sister|sisters|siblings?|spouse|wife|husband|partner|partners|uncle|aunt|cousins?|relatives?|nephew|niece|grand\w*|in ?laws?|friends?|relations?|employer|employers|company|companies|organi[sz]ations?|organi[sz]ers?|firm|client|clients|university|college|school|government|ministry|church|charity|foundation|fiance|fiancee|boyfriend|girlfriend|someone|somebody|others?)\b/;

/**
 * "Self", "Myself", "Own funds", "Personal savings", "Applicant (business
 * income)", "Pension", "Savings", "Rental income" — the applicant pays alone.
 * An allow-list: every word must be one of these, so a name or anything else
 * unplaced ("Ali Khan", "Mr Johnson") decides nothing.
 */
const SELF_WORDS = new Set([
  'self',
  'myself',
  'me',
  'i',
  'own',
  'my',
  'mine',
  'personal',
  'personally',
  'applicant',
  'the',
  'funds',
  'fund',
  'savings',
  'saving',
  'saved',
  'income',
  'incomes',
  'business',
  'money',
  'account',
  'accounts',
  'bank',
  'from',
  'pension',
  'pensions',
  'retirement',
  'salary',
  'salaries',
  'wage',
  'wages',
  'earnings',
  'rental',
  'rent',
  'property',
  'investments',
  'investment',
  'profit',
  'profits',
  'deposits',
  'deposit',
  'cash',
  'and',
  'or',
  'with',
  'pay',
  'pays',
  'paying',
  'will',
  'all',
  'expenses',
  'costs',
  'trip',
  'travel',
  'stay',
  'of',
  'by',
  'am',
  'a',
  'nobody',
  'none',
  'no',
  'one',
  'else',
]);

/**
 * Who pays, from the applicant's words: 'self', 'other' (someone else gives
 * money — Yes on IRCC's "Is someone else giving you money?"), or undefined
 * when the words do not say.
 */
export function tripPayer(raw: string): 'self' | 'other' | undefined {
  const t = raw
    .toLowerCase()
    .replace(/'s\b/g, '')
    .replace(/[^a-z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return undefined;
  // "Nobody else", "No one else": the applicant alone.
  if (/^(no ?one|nobody|none)( else)?\b/.test(t) && !/\bbut\b/.test(t))
    return 'self';
  if (OTHER_PAYER.test(t)) return 'other';
  const words = t.split(' ').filter(Boolean);
  return words.every((w) => SELF_WORDS.has(w)) ? 'self' : undefined;
}

function fundsDetails(p: Profile): string | undefined {
  const explicit = pickText(
    p,
    'financial_support_details',
    'funds_details',
    'sponsor_details',
  );
  if (explicit) return explicit;
  const who = pickText(
    p,
    'financial_supporter',
    'sponsor_name',
    'financial_support_provider_name',
  );
  if (!who) return payerDetails(p);
  const rel =
    pickText(p, 'financial_supporter_relationship', 'sponsor_relationship') ??
    (isSamePerson(who, pickText(p, 'family_member_name'))
      ? pickText(p, 'relationship_to_family_in_destination')
      : undefined);
  const how = pickText(p, 'financial_support');
  // What the profile already proves about the same person: their status in
  // Canada and that they are the host. Dry run 2026-10-16: the generated
  // answer ("X (son) is paying for part or all of the trip") said less than
  // the applicant's documents do.
  const isFamilyMember = isSamePerson(who, pickText(p, 'family_member_name'));
  const status = isFamilyMember
    ? pickText(p, 'family_member_citizenship')
    : undefined;
  const hosts = isSamePerson(who, pickText(p, 'accommodation_provider_name'));
  const hostAddress = hosts ? pickText(p, 'accommodation_address') : undefined;
  const statusText = status
    ? /^canad/i.test(status)
      ? 'Canadian citizen'
      : status
    : undefined;
  const about = [rel, statusText].filter(Boolean).join(', ');
  return sentence(
    `${who}${about ? ` (${about})` : ''} is paying for part or all of the trip${
      hostAddress
        ? ` and is hosting me at ${hostAddress.replace(/\.$/, '')}`
        : ''
    }.`,
    how && !how.toLowerCase().includes(who.toLowerCase())
      ? `Details: ${how.replace(/\.$/, '')}.`
      : undefined,
  );
}

/**
 * The details box from who pays, when no supporter is named: the payer in the
 * applicant's words, with the company's name when the payer is the employer
 * or the Canadian company (audit 2026-10-19: a business visitor's "Employer"
 * answered Yes and left the box blank). Only for a Yes the words gave.
 */
function payerDetails(p: Profile): string | undefined {
  const s = payerText(p);
  if (!s || fundsShared(p) !== 'Yes' || tripPayer(s) !== 'other')
    return undefined;
  const lower = s.toLowerCase();
  const company = /\bemployer/.test(lower)
    ? pickText(
        p,
        'employer_name',
        'current_employer_name',
        'employer',
        'company_name',
      )
    : /\b(company|organi[sz]ation|inviting|host)\b/.test(lower)
      ? pickText(
          p,
          'canadian_business_name',
          'canadian_company_name',
          'host_company_name',
          'inviting_company_name',
        )
      : undefined;
  // "My son Ali" reads on as "Paid for by my son Ali"; a name keeps its case.
  const trimmed = s.replace(/[.\s]+$/, '');
  const first = trimmed.split(/\s/)[0].toLowerCase();
  const payer =
    SELF_WORDS.has(first) || OTHER_PAYER.test(first)
      ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
      : trimmed;
  const named =
    company && !lower.includes(company.toLowerCase())
      ? `${payer} (${company})`
      : payer;
  return `Paid for by ${named}.`;
}

/**
 * Words passports and interviews use for sex, besides English: Spanish,
 * Portuguese, French, German, Arabic, Urdu / Hindi, Persian.
 */
const SEX_WORDS: Readonly<Record<string, 'Male' | 'Female'>> = {
  m: 'Male',
  male: 'Male',
  man: 'Male',
  homme: 'Male',
  hombre: 'Male',
  masculino: 'Male',
  masculin: 'Male',
  masculine: 'Male',
  mannlich: 'Male',
  maennlich: 'Male',
  ذكر: 'Male',
  مرد: 'Male',
  मर्द: 'Male',
  पुरुष: 'Male',
  f: 'Female',
  female: 'Female',
  woman: 'Female',
  femme: 'Female',
  mujer: 'Female',
  feminino: 'Female',
  femenino: 'Female',
  feminin: 'Female',
  feminine: 'Female',
  weiblich: 'Female',
  أنثى: 'Female',
  انثى: 'Female',
  عورت: 'Female',
  زن: 'Female',
  महिला: 'Female',
  स्त्री: 'Female',
};

/**
 * Letters a bilingual passport prints beside the ICAO one ("M / H" — Homme /
 * Hombre; "F / W" — weiblich). Too thin to stand alone: only read next to an
 * M or F that says the same.
 */
const SEX_SECOND_LETTERS: Readonly<Record<string, 'Male' | 'Female'>> = {
  h: 'Male',
  w: 'Female',
};

function sexWord(s: string): 'Male' | 'Female' | 'Another gender' | undefined {
  const w = s.trim().replace(/\.$/, '');
  const plain = w.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const hit = SEX_WORDS[w] ?? SEX_WORDS[plain];
  if (hit) return hit;
  if (w === 'x' || /another|other|non-binary|nonbinary/.test(w))
    return 'Another gender';
  return undefined;
}

/** The applicant's sex as IRCC's options, from the passport / ID or intake. */
function sexOption(p: Profile): string | undefined {
  const s = pickText(p, 'sex', 'gender')?.trim().toLowerCase();
  if (!s) return undefined;
  const whole = sexWord(s);
  if (whole) return whole;
  // Bilingual print: "M/M", "F / F", "M/H", "Masculino / Male". Every half
  // must say the same; "M/F" is two answers and gives none.
  const halves = s.split(/\s*[/|]\s*/).filter(Boolean);
  if (halves.length < 2) return undefined;
  const read = halves.map((h) => sexWord(h));
  if (!read.some(Boolean)) return undefined;
  const all = halves.map((h, i) => read[i] ?? SEX_SECOND_LETTERS[h.trim()]);
  return all.every((r) => r && r === all[0]) ? all[0] : undefined;
}

/** The current job title, under every key currentJob reads. */
const currentJobTitle = (p: Profile) =>
  pickText(
    p,
    'job_title',
    'occupation',
    'current_occupation',
    'position',
    'designation',
  );

function isRetired(p: Profile): boolean {
  if (declared(p, 'retired', 'is_retired') === 'Yes') return true;
  const s = pickText(p, 'employment_status', 'occupation', 'employed');
  return !!s && /retired/i.test(s);
}

/**
 * The retirement date. A month is enough for IRCC's work history (it asks
 * year and month only), so "2016-10" is read as the first of that month.
 */
function retirementDate(p: Profile): string | undefined {
  const keys = [
    'retirement_date',
    'retired_since',
    'date_of_retirement',
    'occupation_since',
  ];
  const full = pickDate(p, ...keys);
  if (full) return full;
  const month = pickText(p, ...keys);
  if (month && /^\d{4}-\d{2}$/.test(month)) return `${month}-01`;
  return ongoingNoJobFrom(p, 'Retired');
}

/**
 * The applicant's current job as an IRCC work-history row (live 2026-10-18:
 * the dialog will not save without employer, duties and the employer's street
 * address). Each missing piece is listed for the applicant, and a job title
 * the rules in ircc-occupations.ts cannot place is never guessed.
 */
/**
 * `#responsibilityActivity_input`: IRCC rejects more than 100 characters
 * ("Must be 100 characters or less, including spaces", live 2026-10-19);
 * longer duties are cut at a whole word rather than dropped.
 */
const WORK_DUTIES_MAX = 100;

function currentJob(p: Profile): {
  facts?: {
    since: string;
    activity: string;
    title: string;
    employer: string;
    duties: string;
    address: Address;
  };
  missing: string[];
} {
  if (isRetired(p)) return { missing: [] };
  const employedSaid = declared(
    p,
    'employed',
    'is_employed',
    'currently_employed',
  );
  const jobTitle = currentJobTitle(p);
  if (employedSaid === 'No' || !jobTitle) return { missing: [] };
  // A no-job employment status (unemployed, retired, homemaker): the
  // occupation is then only the profession (review of 0910f4b7).
  const status = pickText(p, 'employment_status');
  if (status && NO_JOB_ACTIVITY.some(([re]) => re.test(status)))
    return { missing: [] };
  if (
    /^(home ?maker|house ?wife|student|unemployed|retired|none)$/i.test(
      jobTitle.trim(),
    )
  )
    return { missing: [] };
  const employer = pickText(
    p,
    'employer_name',
    'employer',
    'company',
    'company_name',
    'current_employer_name',
  );
  // IRCC's duties box refuses all punctuation (live 2026-10-19: "," and ":"
  // kept it ng-invalid, so the row could not be saved).
  const dutiesRaw = pickText(
    p,
    'job_duties',
    'duties',
    'responsibilities',
    'job_description',
  );
  const occ = occupationOf(jobTitle, employer, dutiesRaw);
  const duties = dutiesRaw ? plainWords(dutiesRaw, WORK_DUTIES_MAX) : undefined;
  const sinceRaw = pickText(
    p,
    'employment_start_date',
    'employment_since',
    'employed_since',
    'current_employment_start_date',
    'employment_since_year',
  );
  const since =
    sinceRaw && /^\d{4}-\d{2}/.test(sinceRaw)
      ? `${sinceRaw.slice(0, 7)}-01`
      : undefined;
  const fallbackCountry = pickCountry(
    p,
    'employment_country',
    'current_employer_country',
    'country_of_residence',
    'current_country_of_residence',
  );
  const addr = anyAddress(
    pick(p, 'employer_address', 'work_address', 'current_employer_address'),
    fallbackCountry,
  );
  const missing: string[] = [];
  if (!since) missing.push('the month and year you started');
  if (!occ) missing.push(`the IRCC occupation for "${jobTitle}"`);
  if (!employer) missing.push('employer name');
  if (!duties) missing.push('your duties');
  if (!addr)
    missing.push(
      "employer's full address (street, city and country; in Canada also province and postal code)",
    );
  if (missing.length) return { missing };
  return {
    facts: {
      since: since!,
      activity: occ!.activity,
      title: occ!.title,
      employer: employer!,
      duties: duties!,
      address: addr!,
    },
    missing,
  };
}

function retiredRow(p: Profile): string | undefined {
  if (!isRetired(p)) return undefined;
  const since = retirementDate(p);
  const home = residentialAddress(p);
  if (!since || !(manualParts(home) || otherParts(home))) return undefined;
  return `Retired since ${since.slice(0, 7)}`;
}

/**
 * A homemaker (live 2026-10-18, super visa: "not employed, occupation
 * Homemaker"). IRCC's work history must cover the last 10 years or the page
 * will not save; an ongoing Homemaker row does, when VisaAI knows since when.
 */
function isHomemaker(p: Profile): boolean {
  if (isRetired(p)) return false;
  if (declared(p, 'homemaker', 'is_homemaker') === 'Yes') return true;
  const s = pickText(
    p,
    'occupation',
    'current_occupation',
    'employment_status',
    'job_title',
  );
  return (
    !!s &&
    /^(home ?maker|house ?wife|house ?husband|stay[- ]at[- ]home (mother|father|parent))$/i.test(
      s.trim(),
    )
  );
}

/** Since when the applicant has been a homemaker: an explicit date or month only. */
function homemakerSince(p: Profile): string | undefined {
  const keys = ['homemaker_since', 'occupation_since', 'not_employed_since'];
  const full = pickDate(p, ...keys);
  if (full) return full;
  const month = pickText(p, ...keys);
  if (month && /^\d{4}-\d{2}$/.test(month)) return `${month}-01`;
  return ongoingNoJobFrom(p, 'Homemaker');
}

function homemakerRow(p: Profile): string | undefined {
  if (!isHomemaker(p)) return undefined;
  const since = homemakerSince(p);
  const home = residentialAddress(p);
  if (!since || !(manualParts(home) || otherParts(home))) return undefined;
  return `Homemaker since ${since.slice(0, 7)}`;
}

/**
 * The month an ongoing no-job period of this kind began, from the interview's
 * work history ({activity: "Unemployed", from: "2024-03", to: "present"}).
 * The interview records the current period without work there, or as
 * not_employed_since (intake-requirements.ts work_history).
 */
function ongoingNoJobFrom(p: Profile, kind: string): string | undefined {
  for (const e of workHistoryList(p)) {
    const to = pickText(e, 'to', 'to_date', 'end_date', 'end');
    if (!to || !ONGOING.test(to.trim())) continue;
    const what =
      pickText(e, 'activity', 'job_title', 'title', 'occupation', 'position') ?? '';
    if (NO_JOB_ACTIVITY.find(([re]) => re.test(what))?.[1] !== kind) continue;
    const from = tripMonth(pick(e, 'from', 'from_date', 'start_date', 'start'));
    if (from) return `${from.slice(0, 7)}-01`;
  }
  return undefined;
}

/**
 * Currently without work (matrix B A15): said so, or an ongoing "Unemployed"
 * period in the work history with no job named. Retired and homemaker have
 * their own rows.
 */
function isUnemployed(p: Profile): boolean {
  if (isRetired(p) || isHomemaker(p)) return false;
  // Never next to a current job row (review of 0910f4b7).
  if (currentJob(p).facts) return false;
  const unemployed = NO_JOB_ACTIVITY[0][0];
  const status = pickText(p, 'employment_status');
  if (status) return unemployed.test(status);
  const title = currentJobTitle(p);
  if (title && unemployed.test(title)) return true;
  // "Not employed" said outright, with since when: the title is the profession.
  if (
    declared(p, 'employed', 'is_employed', 'currently_employed') === 'No' &&
    !(title && STUDY.test(title)) &&
    unemployedSince(p)
  )
    return true;
  return !title && !!ongoingNoJobFrom(p, 'Unemployed');
}

/** Since when the applicant has been without work: a date or month only. */
function unemployedSince(p: Profile): string | undefined {
  const keys = ['unemployed_since', 'not_employed_since', 'occupation_since'];
  const full = pickDate(p, ...keys);
  if (full) return full;
  const month = pickText(p, ...keys);
  if (month && /^\d{4}-\d{2}$/.test(month)) return `${month}-01`;
  return ongoingNoJobFrom(p, 'Unemployed');
}

/**
 * The ongoing "Unemployed" row (`#activtyOccupation_select` 002, which hides
 * title and employer like Homemaker). IRCC still wants the period's street,
 * city and country (live 2026-10-19: an Unemployed row would not save without
 * them); for the CURRENT period that is where the applicant lives now, as on
 * the retired and homemaker rows.
 */
function unemployedRow(p: Profile): string | undefined {
  if (!isUnemployed(p)) return undefined;
  const since = unemployedSince(p);
  const home = residentialAddress(p);
  if (!since || !(manualParts(home) || otherParts(home))) return undefined;
  return `Unemployed since ${since.slice(0, 7)}`;
}

// ── earlier work / activity rows ────────────────────────────────────────────
/**
 * IRCC's /activities wants the last 10 years with no gaps. The interview
 * records the earlier periods as `work_history` — {from, to, activity,
 * employer, city, country} — and only the current row was ever written (live
 * E2E 2026-10-19). Each period becomes a row of the same "Add" dialog.
 */
const MAX_WORK_ROWS = 6;

/** Activities with no job title or employer (`#activtyOccupation_select`). */
const NO_JOB_ACTIVITY: ReadonlyArray<[RegExp, string]> = [
  [
    /\b(un-?employed|not (employed|working)|no (work|job)|job[- ]?seek\w*|looking for (work|a job)|between jobs)\b/i,
    'Unemployed',
  ],
  [/\bretire(d|ment)?\b/i, 'Retired'],
  [
    /\b(home ?maker|house ?wife|house ?husband|stay[- ]at[- ]home)\b/i,
    'Homemaker',
  ],
];

interface WorkRowFacts {
  from: string;
  /** Absent for a period still going (written with the ongoing box ticked). */
  to?: string;
  ongoing?: boolean;
  activity: string;
  /** Absent for Unemployed / Retired / Homemaker, whose dialog hides them. */
  title?: string;
  employer?: string;
  duties?: string;
  address: Address;
}

function workHistoryList(p: Profile): Profile[] {
  return people(p, 'work_history', 'employment_history', 'previous_jobs', 'previous_employment');
}

const ONGOING = /^(present|now|current(ly)?|ongoing|to date|today|till date)$/i;

/** Company-form words that do not tell two employers apart. */
const EMPLOYER_SUFFIX =
  /\b(the|ltd|limited|pvt|private|inc|incorporated|co|company|corp|corporation|llc|llp|plc|gmbh|pty|pte|sa|ag|bv)\b/g;

const employerKey = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(EMPLOYER_SUFFIX, ' ')
    .replace(/\s+/g, '');

/** "Meezan Bank Ltd." and "MEEZAN BANK LIMITED" are one employer. */
const sameEmployer = (a: string | undefined, b: string | undefined) =>
  !!employerKey(a) && employerKey(a) === employerKey(b);

const thisMonth = () => new Date().toISOString().slice(0, 7);

const STUDY = /\b(student|studying|studies|study|full[- ]time stud\w*)\b/i;

/**
 * A period that is the applicant's CURRENT situation is already the current /
 * retired / homemaker row and is not added twice: one still going, the
 * current job under the same employer (overlapping its start), or — for a
 * retired applicant or a homemaker — a period of that kind that reaches the
 * month it began or ends this month.
 */
function isCurrentPeriod(e: Profile, p: Profile, last: boolean): boolean {
  const to = pickText(e, 'to', 'to_date', 'end_date', 'end');
  if (to && ONGOING.test(to.trim())) return ongoingIsCurrent(e, p);
  // No end month on the latest period: it is still going. On an earlier one
  // it is a gap in the record, listed for the applicant.
  if (!to) return last;
  const toMonth = tripMonth(to)?.slice(0, 7);
  if (!toMonth) return false;
  const what =
    pickText(e, 'activity', 'job_title', 'title', 'occupation', 'position') ?? '';
  const kind = NO_JOB_ACTIVITY.find(([re]) => re.test(what))?.[1];
  const ongoingKind = isRetired(p)
    ? { kind: 'Retired', since: retirementDate(p) }
    : isHomemaker(p)
      ? { kind: 'Homemaker', since: homemakerSince(p) }
      : undefined;
  if (ongoingKind && kind === ongoingKind.kind) {
    if (toMonth >= thisMonth()) return true;
    if (!ongoingKind.since || toMonth >= ongoingKind.since.slice(0, 7)) return true;
  }
  const job = currentJob(p).facts;
  if (!job) return false;
  const employer = pickText(e, 'employer', 'employer_name', 'company', 'company_name');
  if (!sameEmployer(employer, job.employer)) return false;
  // Same employer and the period reaches the current job's start month:
  // the same job, however its start was recorded.
  return toMonth >= job.since.slice(0, 7);
}

/**
 * A period recorded as still going is the current row when it is of the
 * retired / homemaker kind, when there is no current job to tell it apart
 * from, or when it is the current job (same employer, or no employer and the
 * same start month). Any other is a second job held alongside (live
 * 2026-10-30: a car wash run alongside the current trading job was dropped
 * as if it were the current job, and IRCC refused the page) and is written
 * as its own row, marked ongoing.
 */
function ongoingIsCurrent(e: Profile, p: Profile): boolean {
  const what =
    pickText(e, 'activity', 'job_title', 'title', 'occupation', 'position') ?? '';
  const kind = NO_JOB_ACTIVITY.find(([re]) => re.test(what))?.[1];
  if (kind && (isRetired(p) || isHomemaker(p))) return true;
  const job = currentJob(p).facts;
  // An ongoing period without work and no job (matrix B A15): the current
  // row when the unemployed row writes it; otherwise it is written as its own
  // ongoing row, never dropped (IRCC refuses /activities short of today).
  if (kind && !job) return kind === 'Unemployed' && !!unemployedRow(p);
  // A stale ongoing "Unemployed" next to the current job: the job is the
  // current period (review of 0910f4b7).
  if (kind === 'Unemployed') return true;
  if (!job) return true;
  const employer = known(
    pickText(e, 'employer', 'employer_name', 'company', 'company_name'),
  );
  const from = tripMonth(pick(e, 'from', 'from_date', 'start_date', 'start'));
  if (!employer) return !from || from.slice(0, 7) === job.since.slice(0, 7);
  if (sameEmployer(employer, job.employer)) return true;
  // The current job under another spelling ("Ali Traders" / "Ali Trading
  // Co"): it began within a month of the current job, or under the same title
  // (review of 508e7812).
  if (from && Math.abs(monthNo(from.slice(0, 7)) - monthNo(job.since.slice(0, 7))) <= 1)
    return true;
  const jobTitle = pickText(
    p,
    'job_title',
    'occupation',
    'current_occupation',
    'position',
    'designation',
  );
  const title = pickText(e, 'job_title', 'title', 'occupation', 'position');
  // The same title counts only for the same business: the two names share a
  // distinctive word ("Ali Traders" / "Ali Trading Co"). Two "Proprietor"
  // rows for "Max Care" and "City Laundry" are two businesses (review).
  return (
    !!title &&
    !!jobTitle &&
    nameWords(title).join(' ') === nameWords(jobTitle).join(' ') &&
    distinctWords(employer).some((w) => distinctWords(job.employer).includes(w))
  );
}

/** Filler in a business name that does not tell two businesses apart. */
const EMPLOYER_FILLER = new Set([
  'co', 'company', 'pvt', 'private', 'ltd', 'limited', 'llc', 'inc',
  'traders', 'trading', 'enterprises', 'group', 'the', 'and',
]);
const distinctWords = (s: string | undefined) =>
  nameWords(s).filter((w) => !EMPLOYER_FILLER.has(w));

/** Earlier periods only, in the order recorded. */
function earlierWorkPeriods(p: Profile): Profile[] {
  const list = workHistoryList(p);
  return list.filter((e, i) => !isCurrentPeriod(e, p, i === list.length - 1));
}

/** A piece the applicant said they do not know (the interview records "unknown"). */
const UNKNOWN_PIECE = /^(unknown|not known|don'?t know|do not know|n\/a)$/i;
const known = (v: string | undefined) =>
  v && !UNKNOWN_PIECE.test(v.trim()) ? v : undefined;

const sameCityName = (a: string | undefined, b: string) =>
  !!a && a.toLowerCase().replace(/[^a-z]/g, '') === b.toLowerCase().replace(/[^a-z]/g, '');

/** The period's address: street, city and country (Canada: also province, postal code). */
function workRowAddress(e: Profile): Address | undefined {
  const country = pickCountry(e, 'country', 'employer_country');
  const raw = pick(e, 'address', 'employer_address', 'work_address');
  if (raw && typeof raw === 'object') {
    // An "unknown" part is a missing part, never typed into IRCC.
    const parts = Object.fromEntries(
      Object.entries(raw as Profile).filter(
        ([, v]) => typeof v !== 'string' || !!known(v),
      ),
    );
    return anyAddress(parts, country);
  }
  if (typeof raw === 'string' && !known(raw)) return undefined;
  const street = known(pickText(e, 'street', 'street_address')) ??
    (typeof raw === 'string' ? raw : undefined);
  const city = known(pickText(e, 'city', 'town'));
  // A full line ("12 Mall Road, Gujranwala, Pakistan") parses on its own; a
  // street line takes the period's city and country. When the period has its
  // own city, the line's split is trusted only if it found that city — else
  // the line is the street, commas and all (live 2026-10-19: "House 12,
  // Street 4, Rehman Road" + city Gujrat was split into street "House 12,
  // Street 4" and city "Rehman Road").
  const parsed = typeof raw === 'string' ? anyAddress(raw, country) : undefined;
  if (parsed && (!city || sameCityName(parsed.city, city))) return parsed;
  return (
    anyAddress(
      {
        street,
        city,
        province: pickText(e, 'province', 'state'),
        postal_code: pickText(e, 'postal_code', 'postcode', 'zip'),
        country,
      },
      country,
    )
  );
}

/**
 * IRCC occupation from the job title, else from the title with the business
 * it names (live 2026-10-29: "Managing Partner and 50% shareholder" at "Max
 * Trading" named no trade, so the current-job row was never written).
 */
function occupationOf(
  title: string | undefined,
  employer: string | undefined,
  duties?: string,
): ReturnType<typeof irccOccupationFor> {
  // Last, a sector the duties name as the business the applicant heads (live
  // 2026-10-30: "Director" at "Super Bloks (Private) Limited" named its
  // trade only in "concrete block manufacturing…"). Only the sector rules,
  // on the duties alone (review of 508e7812).
  return (
    irccOccupationFor(title) ??
    (title && employer ? irccOccupationFor(`${title} ${employer}`) : undefined) ??
    irccOccupationFromDuties(title, duties)
  );
}

/**
 * One earlier period as IRCC's dialog asks it. Every period needs from, to
 * and an address with street, city and country (live 2026-10-19: even an
 * "Unemployed" row would not save without them); a job also needs an IRCC
 * occupation, employer and duties. A missing piece is listed, never guessed.
 */
function workRowGaps(e: Profile): {
  facts?: WorkRowFacts;
  missing: string[];
  /** A period of study: recorded under post-secondary education instead. */
  study?: boolean;
} {
  const from = tripMonth(pick(e, 'from', 'from_date', 'start_date', 'start'));
  const toRaw = pickText(e, 'to', 'to_date', 'end_date', 'end');
  // Still going: a second job held alongside the current one, or a period
  // without work that no current row writes (ongoingIsCurrent).
  const ongoing = !!toRaw && ONGOING.test(toRaw.trim());
  const to = ongoing ? undefined : tripMonth(toRaw);
  const what =
    pickText(e, 'activity', 'job_title', 'title', 'occupation', 'position') ?? '';
  // IRCC records studies in the post-secondary education section, not as a
  // work-history activity.
  if (STUDY.test(what) && !NO_JOB_ACTIVITY.some(([re]) => re.test(what)))
    return { missing: [], study: true };
  const noJob = NO_JOB_ACTIVITY.find(([re]) => re.test(what))?.[1];
  const employer = known(
    pickText(e, 'employer', 'employer_name', 'company', 'company_name', 'school', 'institution'),
  );
  const dutiesRaw = known(
    pickText(e, 'duties', 'job_duties', 'responsibilities', 'description'),
  );
  const occ = noJob ? undefined : occupationOf(what, employer, dutiesRaw);
  const duties = dutiesRaw ? plainWords(dutiesRaw, WORK_DUTIES_MAX) : undefined;
  const address = workRowAddress(e);
  const missing: string[] = [];
  if (!from) missing.push('month and year it began');
  if (!to && !ongoing) missing.push('month and year it ended');
  if (!what) missing.push('what you did (job title, unemployed, retired…)');
  else if (!noJob && !occ) missing.push(`the IRCC occupation for "${what}"`);
  if (!noJob) {
    if (!employer) missing.push('employer name');
    if (!duties) missing.push('your duties');
  }
  if (!address)
    missing.push(
      'the full address (street, city and country; in Canada also province and postal code)',
    );
  if (missing.length) return { missing };
  return {
    facts: {
      from: from!,
      ...(ongoing ? { ongoing: true } : { to: to! }),
      activity: noJob ?? occ!.activity,
      ...(noJob ? {} : { title: occ!.title, employer, duties }),
      address: address!,
    },
    missing,
  };
}

const workRowAt = (p: Profile, n: number) => {
  const e = earlierWorkPeriods(p)[n - 1];
  return e ? workRowGaps(e).facts : undefined;
};

function workRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_WORK_ROWS; n++) {
    const key = `ircc_work_${n}`;
    const f = (p: Profile) => workRowAt(p, n);
    out.push(
      ...dialogRow(
        ACTIVITIES,
        `${key}_row`,
        '#empHistoryTable_add_button',
        DIALOG_SAVE,
        `earlier period ${n} to work history`,
        'employment',
        (p) => {
          const w = f(p);
          return w
            ? `${w.employer ?? w.activity} ${w.from.slice(0, 7)} to ${w.to ? w.to.slice(0, 7) : 'now'}`
            : undefined;
        },
        [
          ...dateSelects(
            ACTIVITIES,
            `${key}_from`,
            'fromWork',
            `Earlier period ${n} — from`,
            'dates',
            { derive: (p) => f(p)?.from },
            false,
          ),
          ...dateSelects(
            ACTIVITIES,
            `${key}_to`,
            'toWork',
            `Earlier period ${n} — to`,
            'dates',
            { derive: (p) => f(p)?.to },
            false,
          ),
          // A second job still going: IRCC's "current" box, as on the
          // current-job row; the to-date selects then stay empty.
          check(
            ACTIVITIES,
            `${key}_ongoing`,
            '#isCurrentEmployer_chk-input',
            `Earlier period ${n} — ongoing`,
            'employment',
            (p) => (f(p)?.ongoing ? 'Yes' : undefined),
          ),
          optionText(
            ACTIVITIES,
            `${key}_activity`,
            '#activtyOccupation_select',
            `Earlier period ${n} — activity`,
            'employment',
            (p) => f(p)?.activity,
          ),
          optionText(
            ACTIVITIES,
            `${key}_title`,
            '#jobTitleActivity_select',
            `Earlier period ${n} — job title`,
            'employment',
            (p) => f(p)?.title,
          ),
          text(
            ACTIVITIES,
            `${key}_employer`,
            '#nameEmployerActivity_input',
            `Earlier period ${n} — employer`,
            'employment',
            (p) => f(p)?.employer,
          ),
          text(
            ACTIVITIES,
            `${key}_duties`,
            '#responsibilityActivity_input',
            `Earlier period ${n} — duties`,
            'employment',
            (p) => f(p)?.duties,
            { transform: 'plain_words', maxLength: WORK_DUTIES_MAX },
          ),
          ...addressFields(
            ACTIVITIES,
            `${key}_address`,
            'workHistoryAddress',
            `Earlier period ${n} — address`,
            (p) => f(p)?.address,
          ),
        ],
      ),
    );
  }
  return out;
}

/** "2019-05" → a month count, so periods can be laid end to end. */
const monthNo = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthYm = (n: number) =>
  `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;

/**
 * What the rows the assistant writes on /activities leave of IRCC's "last 10
 * years with no gaps": the current row (job, retirement or homemaker) plus
 * every earlier period workRows() writes — the same facts, so the Submit page
 * says what is actually left. Live 2026-10-19: all three rows (current + two
 * earlier) were written while the page still said "add earlier jobs, studies
 * and other periods yourself". `uncovered` lists the months no written row
 * reaches, as "YYYY-MM to YYYY-MM"; empty means the 10 years are covered.
 */
function workHistoryCoverage(p: Profile): {
  current?: string;
  earlier: number;
  uncovered: string[];
} {
  const now = monthNo(thisMonth());
  const spans: Array<[number, number]> = [];
  let current: string | undefined;
  const job = currentJob(p).facts;
  const since = job
    ? job.since
    : retiredRow(p)
      ? retirementDate(p)
      : homemakerRow(p)
        ? homemakerSince(p)
        : unemployedRow(p)
          ? unemployedSince(p)
          : undefined;
  if (since) {
    current = job
      ? 'your current job'
      : retiredRow(p)
        ? 'your retirement'
        : homemakerRow(p)
          ? 'your homemaker period'
          : 'your period without work';
    spans.push([monthNo(since), now]);
  }
  let earlier = 0;
  earlierWorkPeriods(p).forEach((e, i) => {
    const w = i < MAX_WORK_ROWS ? workRowGaps(e).facts : undefined;
    if (!w) return;
    earlier++;
    spans.push([monthNo(w.from), w.to ? monthNo(w.to) : now]);
  });
  // IRCC asks year and month: a period ending in May and the next starting
  // in June leave no gap.
  const start = now - 120;
  const uncovered: string[] = [];
  let next = start;
  for (const [from, to] of spans.sort((a, b) => a[0] - b[0])) {
    if (to < next) continue;
    if (from > next) uncovered.push(`${monthYm(next)} to ${monthYm(Math.min(from - 1, now))}`);
    next = Math.max(next, to + 1);
    if (next > now) break;
  }
  if (next <= now) uncovered.push(`${monthYm(next)} to ${monthYm(now)}`);
  return { current, earlier, uncovered };
}

/**
 * For a period the assistant cannot write: the uncovered months it falls in
 * (or all of them, when its own months are not known), said outright — IRCC
 * refuses /activities while the 10 years have a gap (live 2026-10-30: "You
 * can't save or continue until you include these details").
 */
function unwrittenGap(e: Profile, uncovered: string[]): string {
  if (!uncovered.length) return '';
  const from = tripMonth(pick(e, 'from', 'from_date', 'start_date', 'start'));
  const toRaw = pickText(e, 'to', 'to_date', 'end_date', 'end');
  const to = toRaw && ONGOING.test(toRaw.trim()) ? thisMonth() : tripMonth(toRaw);
  const hit =
    from && to
      ? uncovered.filter((r) => {
          const [a, b] = r.split(' to ');
          return monthNo(a) <= monthNo(to) && monthNo(b) >= monthNo(from);
        })
      : uncovered;
  if (!hit.length) return '';
  return ` Without it ${hit.join(', ')} ${hit.length === 1 ? 'is' : 'are'} not covered, and IRCC will not save or continue this page until it is.`;
}

/** The Submit-page note for the 10-year work history, from workHistoryCoverage. */
function workHistoryNote(cov: ReturnType<typeof workHistoryCoverage>): string {
  const { current, earlier, uncovered } = cov;
  const written = [
    ...(current ? [current] : []),
    ...(earlier
      ? [`${earlier} earlier period${earlier === 1 ? '' : 's'}`]
      : []),
  ];
  const adds = written.length
    ? `The assistant adds ${written.join(' and ')}.`
    : 'The assistant has no complete period to add.';
  const gaps = uncovered.length
    ? ` Not yet covered: ${uncovered.join(', ')}. IRCC will not save or continue this page until every month is covered. Add a period for each yourself (studies go under post-secondary education), including any period listed separately below.`
    : '';
  return `Cover the last 10 years with no gaps. ${adds}${gaps}`;
}

// ── travel history rows ─────────────────────────────────────────────────────
// IRCC sets no limit on trips and its grid pages them (extension 0.1.40), so
// the cap only bounds the mapping. 8 cut the 9th trip of a live E2E profile
// (2026-10-19) to an "add it yourself" note.
const MAX_TRIPS = 20;

interface TripFacts {
  from: string;
  to: string;
  country: string;
  location: string;
  purpose: string;
}

/** Trips of the last five years, as the interview records them (objects). */
function tripList(p: Profile): Profile[] {
  return people(p, 'travel_history', 'travel_history_countries', 'trips');
}

/** A month a trip started or ended: "2023-01" or a full date → YYYY-MM-01. */
function tripMonth(v: unknown): string | undefined {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}/.test(t) ? `${t.slice(0, 7)}-01` : undefined;
}

const tripFrom = (t: Profile) =>
  tripMonth(pick(t, 'from', 'from_date', 'start_date', 'departure_date', 'start'));
const tripTo = (t: Profile) =>
  tripMonth(pick(t, 'to', 'to_date', 'end_date', 'return_date', 'end'));
const tripCountry = (t: Profile) =>
  pickCountry(t, 'country', 'destination', 'country_visited');

/** Country and months: IRCC takes one row per country a month. */
function tripKey(t: Profile): string | undefined {
  const country = tripCountry(t);
  const from = tripFrom(t);
  const to = tripTo(t);
  return country && from && to ? `${country}|${from}|${to}` : undefined;
}

/**
 * IRCC's travel-history dialog caps the place at 50 characters and the
 * purpose at 100 (validators max50Chars / max100Chars on
 * travelHistoryLocation / travelHistoryPurposeOfTravel), and both must match
 * its GenericEnglishFrench pattern (tr-rt main.js, read 2026-10-20). A value
 * outside either fails the dialog's Save, so it is never written.
 */
const TRIP_PLACE_MAX = 50;
const TRIP_PURPOSE_MAX = 100;

/** "Business/Tourism" → "Business, Tourism"; dashes and curly quotes plain. */
const irccText = (t: string) =>
  t
    .replace(/\s*\/\s*/g, ', ')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

/**
 * Distinct texts (first spelling kept, compared without case or spacing),
 * joined with "; " as far as `max` allows. A text IRCC's field would refuse
 * (too long, or characters outside its pattern) or that no longer fits is
 * returned in `left` for the applicant; nothing is cut.
 */
function joinDistinct(
  values: (string | undefined)[],
  max: number,
): { text?: string; left: string[] } {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v ? irccText(v.trim().replace(/\s+/g, ' ')) : '';
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  const kept: string[] = [];
  const left: string[] = [];
  for (const t of seen.values()) {
    if (IRCC_GENERIC_TEXT.test(t) && [...kept, t].join('; ').length <= max)
      kept.push(t);
    else left.push(t);
  }
  return { text: kept.length ? kept.join('; ') : undefined, left };
}

/**
 * Trip i (0-based) as IRCC's travel-history dialog asks it (live 2026-10-18):
 * from and to (year and month), country, the city or place, and the purpose —
 * each required by the dialog, so a trip missing one is listed instead.
 *
 * IRCC asks for ONE entry per country a month ("If you travelled to a country
 * several times in a month, add only 1 entry in the table"), and two trips
 * with the same country and months would share a row summary, so the second
 * was taken for the first and skipped. The first such trip is the row and
 * carries every repeat's places and purposes; a repeat is `repeat` and never
 * a row or a note of its own. (A row an earlier fill already saved keeps what
 * it has: the assistant does not edit saved rows.)
 */
function tripGaps(
  list: Profile[],
  i: number,
): {
  facts?: TripFacts;
  missing: string[];
  repeat?: true;
  /** Places and purposes IRCC's fields would refuse, for the applicant. */
  overflow?: string[];
} {
  const t = list[i];
  const key = tripKey(t);
  if (key && list.findIndex((x) => tripKey(x) === key) !== i)
    return { missing: [], repeat: true };
  const group = key ? list.filter((x) => tripKey(x) === key) : [t];
  const from = tripFrom(t);
  const to = tripTo(t);
  const country = tripCountry(t);
  const places = joinDistinct(
    group.map((x) => pickText(x, 'city', 'location', 'place', 'cities')),
    TRIP_PLACE_MAX,
  );
  const purposes = joinDistinct(
    group.map((x) => pickText(x, 'purpose', 'reason', 'purpose_of_travel')),
    TRIP_PURPOSE_MAX,
  );
  // IRCC's "location" is free text; a trip recorded by country only (the
  // interview often gets "Thailand, May 2022") — or whose place IRCC would
  // refuse — is located in that country rather than the whole trip being
  // left for the applicant (live E2E 2026-10-19: 9 trips, none written).
  const location =
    places.text ?? (country ? displayCountry(country) : undefined);
  const purpose = purposes.text;
  const overflow = [
    ...places.left.map((x) => `place "${x}"`),
    ...purposes.left.map((x) => `purpose "${x}"`),
  ];
  const missing: string[] = [];
  if (!from) missing.push('month and year you left');
  if (!to) missing.push('month and year you returned');
  if (!country) missing.push('country');
  if (!location) missing.push('city or place');
  if (!purpose) missing.push('purpose');
  if (missing.length) return { missing, ...(overflow.length ? { overflow } : {}) };
  return {
    facts: {
      from: from!,
      to: to!,
      country: country!,
      location: location!,
      purpose: purpose!,
    },
    missing,
    ...(overflow.length ? { overflow } : {}),
  };
}

const tripAt = (p: Profile, n: number): TripFacts | undefined => {
  const list = tripList(p);
  return list[n - 1] ? tripGaps(list, n - 1).facts : undefined;
};

const anyTripRow = (p: Profile) =>
  Array.from({ length: MAX_TRIPS }, (_, i) => tripAt(p, i + 1)).some(Boolean);

function tripRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_TRIPS; n++) {
    const key = `ircc_trip_${n}`;
    const f = (p: Profile) => tripAt(p, n);
    out.push(
      ...dialogRow(
        TRAVEL_HISTORY,
        `${key}_row`,
        'main button[id*="add"]',
        DIALOG_SAVE,
        `trip ${n}`,
        'travel_history',
        (p) => {
          const t = f(p);
          return t
            ? `${displayCountry(t.country)} ${t.from.slice(0, 7)} to ${t.to.slice(0, 7)}`
            : undefined;
        },
        [
          ...dateSelects(
            TRAVEL_HISTORY,
            `${key}_from`,
            'fromtravelHistory',
            `Trip ${n} — from`,
            'dates',
            { derive: (p) => f(p)?.from },
            false,
          ),
          ...dateSelects(
            TRAVEL_HISTORY,
            `${key}_to`,
            'totravelHistory',
            `Trip ${n} — to`,
            'dates',
            { derive: (p) => f(p)?.to },
            false,
          ),
          country(
            TRAVEL_HISTORY,
            `${key}_country`,
            '#travelHistoryCountry_select',
            `Trip ${n} — country`,
            'travel_history',
            (p) => f(p)?.country,
          ),
          text(
            TRAVEL_HISTORY,
            `${key}_location`,
            '#travelHistoryLocation_input',
            `Trip ${n} — city or place`,
            'travel_history',
            (p) => f(p)?.location,
            // A last guard only: tripGaps keeps the text within IRCC's
            // limits. A silent dialog child resolving to nothing would still
            // open and save the row, which IRCC then refuses.
            { maxLength: TRIP_PLACE_MAX },
          ),
          text(
            TRAVEL_HISTORY,
            `${key}_purpose`,
            '#travelHistoryPurposeOfTravel_input',
            `Trip ${n} — purpose`,
            'travel_history',
            (p) => f(p)?.purpose,
            { maxLength: TRIP_PURPOSE_MAX },
          ),
        ],
        { reveal: true, parent: 'travelled_last_5_years', parentValue: 'Yes' },
      ),
    );
  }
  return out;
}

// ── other names rows ────────────────────────────────────────────────────────
const MAX_OTHER_NAMES = 4;
const NAME_TYPES: Record<string, string> = {
  'Nickname or alias': '01',
  'Name before marriage': '07',
  'Previous name': '15',
};

/**
 * A name used before, as IRCC's dialog asks it: which kind (alias, name before
 * marriage, previous name — never guessed), family and given name.
 */
function otherNameGaps(v: unknown): {
  facts?: { kind: string; family: string; given: string };
  missing: string[];
} {
  const o: Profile =
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Profile)
      : { name: v };
  const names = nameParts(
    {
      o_family_name: pickText(o, 'family_name', 'last_name', 'surname'),
      o_given_name: pickText(o, 'given_name', 'first_name'),
      o_name: pickText(o, 'name', 'full_name'),
    },
    'o',
  );
  const raw = (pickText(o, 'type', 'kind', 'name_type') ?? '').toLowerCase();
  const kind = /maiden|before marriage|birth name/.test(raw)
    ? 'Name before marriage'
    : /alias|nick/.test(raw)
      ? 'Nickname or alias'
      : /previous|former|old/.test(raw)
        ? 'Previous name'
        : undefined;
  const missing: string[] = [];
  if (!names.family) missing.push('the name');
  if (!kind)
    missing.push(
      'whether it is an alias, a name before marriage or a previous name',
    );
  if (missing.length) return { missing };
  return {
    facts: { kind: kind!, family: names.family!, given: names.given ?? '' },
    missing,
  };
}

/** The words of a name, case, spacing and punctuation aside, in order. */
const nameWords = (...parts: (string | undefined)[]) =>
  parts
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/**
 * An "other name" that is the applicant's current name (live 2026-10-30:
 * "Previous name — Ali / Chaudhary Zeeshan" for family ALI, given CHAUDHARY
 * ZEESHAN). Same family and given name, or — for a name recorded in one
 * piece — the same words.
 */
function isCurrentName(v: unknown, p: Profile): boolean {
  const family = pickText(p, 'family_name', 'last_name', 'surname');
  const given = pickText(p, 'given_name', 'first_name', 'given_names');
  if (!nameWords(family, given).length) return false;
  const o: Profile =
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Profile)
      : { name: v };
  const oFamily = pickText(o, 'family_name', 'last_name', 'surname');
  const oGiven = pickText(o, 'given_name', 'first_name');
  if (oFamily)
    return (
      nameWords(oFamily).join(' ') === nameWords(family).join(' ') &&
      nameWords(oGiven).join(' ') === nameWords(given).join(' ')
    );
  // In order only: "family given" or "given family". The same words in
  // another order ("Zeeshan Ali Chaudhary") are a real alias (review).
  const whole = nameWords(pickText(o, 'name', 'full_name')).join(' ');
  return (
    !!whole &&
    (whole === nameWords(family, given).join(' ') ||
      whole === nameWords(given, family).join(' '))
  );
}

/** The other names as recorded, less any that is the current name. */
const otherNameList = (p: Profile): unknown[] => {
  const v = pick(p, 'other_names', 'aliases', 'previous_names');
  const list = Array.isArray(v)
    ? v
    : typeof v === 'string' &&
        v.trim() &&
        declared(p, 'other_names') === undefined
      ? [v]
      : [];
  return list.filter((x) => !isCurrentName(x, p));
};
const otherNameAt = (p: Profile, n: number) => {
  const v = otherNameList(p)[n - 1];
  return v === undefined ? undefined : otherNameGaps(v).facts;
};

const anyOtherNameRow = (p: Profile) =>
  Array.from({ length: MAX_OTHER_NAMES }, (_, i) => otherNameAt(p, i + 1)).some(
    Boolean,
  );

function otherNameRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_OTHER_NAMES; n++) {
    const key = `ircc_other_name_${n}`;
    const f = (p: Profile) => otherNameAt(p, n);
    out.push(
      ...dialogRow(
        OTHER_NAMES,
        `${key}_row`,
        'main button[id*="add"]',
        DIALOG_SAVE,
        `other name ${n}`,
        'passport',
        (p) => {
          const o = f(p);
          return o ? `${o.given} ${o.family}`.trim() : undefined;
        },
        [
          radio(
            OTHER_NAMES,
            `${key}_kind`,
            'nameType',
            `Other name ${n} — kind`,
            'passport',
            NAME_TYPES,
            (p) => f(p)?.kind,
          ),
          text(
            OTHER_NAMES,
            `${key}_family_name`,
            '#lastName_input',
            `Other name ${n} — family name`,
            'passport',
            (p) => f(p)?.family,
          ),
          text(
            OTHER_NAMES,
            `${key}_given_name`,
            '#firstName_input',
            `Other name ${n} — given name`,
            'passport',
            (p) => f(p)?.given || undefined,
          ),
        ],
        { reveal: true, parent: 'has_other_names', parentValue: 'Yes' },
      ),
    );
  }
  return out;
}

// ── citizenship rows (/nationality, "more than one country": Yes) ───────────
// Live 2026-10-19: a Yes replaces the single citizenship select with a table
// ("Which countries or territories are you a citizen of?",
// #otherCountriesCitizenship_add_button) that must list EVERY citizenship,
// the passport's included. Its dialog reuses the page's ids
// (#countryOfCitizenship_select, #citizenFromBirth_chk-input,
// citizenFrom{Year,Month,Day}) and saves with #countryOfCitizenship_save_button.
// Ticking "since birth" fills the date with the date of birth; otherwise the
// date is required.
const MAX_CITIZENSHIPS = 5;

interface CitizenshipFacts {
  country: string;
  fromBirth: boolean;
  since?: string;
}

/** One citizenship as the dialog asks it, or what it still lacks. */
function citizenshipGaps(
  country: string | undefined,
  fromBirth: 'Yes' | 'No' | undefined,
  since: string | undefined,
): { facts?: CitizenshipFacts; missing: string[] } {
  const missing: string[] = [];
  if (!country) missing.push('the country');
  if (!fromBirth) missing.push('whether you have been a citizen since birth');
  else if (fromBirth === 'No' && !since)
    missing.push('the date you became a citizen');
  if (missing.length) return { missing };
  return {
    facts: {
      country: country!,
      fromBirth: fromBirth === 'Yes',
      ...(fromBirth === 'No' ? { since } : {}),
    },
    missing,
  };
}

/**
 * Every citizenship the table must list: the passport's first (from birth,
 * or since `citizenship_acquired_date`), then each other one the interview
 * recorded (a bare country name lacks whether it is from birth).
 */
function citizenshipEntries(
  p: Profile,
): Array<{ label: string; facts?: CitizenshipFacts; missing: string[] }> {
  const primary = nationality(p);
  const out = [
    {
      label: displayCountry(primary) ?? 'Your passport country',
      ...citizenshipGaps(primary, citizenFromBirth(p), citizenshipDate(p)),
    },
  ];
  const raw = pick(
    p,
    'other_citizenships',
    'other_citizenship',
    'additional_citizenships',
  );
  for (const v of Array.isArray(raw) ? raw : []) {
    const o: Profile =
      v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Profile)
        : { country: v };
    const country = pickCountry(o, 'country');
    if (country && country === primary) continue; // already the first row
    out.push({
      label:
        displayCountry(country) ??
        pickText(o, 'country') ??
        'Other citizenship',
      ...citizenshipGaps(
        country,
        declared(o, 'from_birth', 'since_birth'),
        pickDate(o, 'since', 'citizen_since', 'date'),
      ),
    });
  }
  return out;
}

/** The table's rows when every one is complete (and more than one), else undefined. */
function citizenshipRowsComplete(p: Profile): CitizenshipFacts[] | undefined {
  const all = citizenshipEntries(p);
  if (all.length < 2 || all.length > MAX_CITIZENSHIPS) return undefined;
  return all.every((e) => e.facts) ? all.map((e) => e.facts!) : undefined;
}

function citizenshipRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_CITIZENSHIPS; n++) {
    const key = `ircc_citizenship_${n}`;
    const f = (p: Profile) => citizenshipRowsComplete(p)?.[n - 1];
    out.push(
      ...dialogRow(
        NATIONALITY,
        `${key}_row`,
        '#otherCountriesCitizenship_add_button',
        DIALOG_SAVE,
        `citizenship ${n}`,
        'passport',
        (p) => {
          const c = f(p);
          return c
            ? `${displayCountry(c.country)} ${c.fromBirth ? 'since birth' : `since ${c.since}`}`
            : undefined;
        },
        [
          country(
            NATIONALITY,
            `${key}_country`,
            '#countryOfCitizenship_select',
            `Citizenship ${n} — country`,
            'passport',
            (p) => f(p)?.country,
          ),
          check(
            NATIONALITY,
            `${key}_from_birth`,
            '#citizenFromBirth_chk-input',
            `Citizenship ${n} — since birth`,
            'passport',
            (p) => (f(p)?.fromBirth ? 'Yes' : undefined),
          ),
          ...dateSelects(
            NATIONALITY,
            `${key}_since`,
            'citizenFrom',
            `Citizenship ${n} — since`,
            'passport',
            { derive: (p) => f(p)?.since },
          ),
        ],
        { reveal: true, parent: 'multiple_citizenship', parentValue: 'Yes' },
      ),
    );
  }
  return out;
}

// ── education rows (/activities, post-secondary education: Yes) ─────────────
// Live 2026-10-19: #educationHistory_add_button opens the dialog —
// #nameSchoolEdu_input, fromEdu / toEdu (year and month, no day),
// #isOngoingEducation_chk-input, #levelStudyEdu_select, #fieldStudyEdu_select,
// #country_addressEducation, #streetAddress_addressEducation,
// #city_addressEducation; saved with #nameSchoolEdu_save_button. Every field
// is required. Level and field are IRCC's own lists, chosen only on an exact
// option or a clear synonym.
const MAX_SCHOOLS = 4;

/** IRCC's level-of-study options (live 2026-10-19). */
export const IRCC_EDUCATION_LEVELS = [
  'CEGEP - Pre-university',
  'CEGEP - Technical',
  'College - Applied degree',
  'College - Certificate',
  'College - Diploma',
  'ESL or FSL',
  'ESL or FSL and College',
  'ESL or FSL and University',
  'Not Applicable',
  'Other Studies',
  'Primary School',
  'PTC or TCST or DVS or AVS',
  'Secondary School',
  "University - Bachelor's Deg.",
  'University - Doctorate',
  "University - Master's Deg.",
  'University - Other Studies',
] as const;

/** IRCC's field-of-study options (live 2026-10-19). */
export const IRCC_EDUCATION_FIELDS = [
  'Agriculture, Agriculture Operations and Related Sciences',
  'Architecture and Related Services',
  'Arts or Humanities or Social Science',
  'Arts, Fine or Visual or Performing',
  'Biological and Biomedical Sciences',
  'Business or Commerce',
  'Business, Management, Marketing and Related Support Services',
  'Computing or Information Technology',
  'English or French as Second Language',
  'Flight Training',
  'Hospitality or Tourism',
  'Law',
  'Medicine',
  'Other',
  'Science, Applied',
  'Sciences, General',
  'Sciences, Health',
  'Theology or Religious Studies',
  'Trades or Vocational',
] as const;

const exactOptionOf = (list: readonly string[], raw: string) =>
  list.find((o) => o.toLowerCase() === raw.trim().toLowerCase());

/** A level of study as IRCC's option, or undefined when not clear. */
export function educationLevelOption(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const exact = exactOptionOf(IRCC_EDUCATION_LEVELS, raw);
  if (exact) return exact;
  const t = raw.toLowerCase();
  if (/\b(ph\.?\s?d|doctorate|doctoral|d\.?\s?phil)\b/.test(t))
    return 'University - Doctorate';
  if (
    /\b(master'?s?|m\.?\s?sc|mba|m\.?\s?phil|llm|m\.?\s?eng|m\.?\s?com|mcs)\b/.test(
      t,
    )
  )
    return "University - Master's Deg.";
  if (
    /\b(bachelor'?s?|b\.?\s?sc|bba|b\.?\s?com|b\.?\s?eng|bcs|llb|mbbs|bds)\b/.test(
      t,
    )
  )
    return "University - Bachelor's Deg.";
  // A postgraduate diploma is university study, not a college diploma.
  if (/\bdiploma\b/.test(t) && !/\b(post-?\s?graduate|pg)\b/.test(t))
    return 'College - Diploma';
  return undefined;
}

/** A field of study as IRCC's option, or undefined when not clear. */
export function educationFieldOption(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const exact = exactOptionOf(IRCC_EDUCATION_FIELDS, raw);
  if (exact) return exact;
  const t = raw.toLowerCase();
  if (
    /\b(computer science|computing|computers?|information technology|software)\b/.test(
      t,
    ) ||
    /^i\.?t\.?$/.test(t.trim())
  )
    return 'Computing or Information Technology';
  if (/\b(business|commerce|mba|bba|b\.?\s?com|m\.?\s?com)\b/.test(t))
    return 'Business or Commerce';
  if (/\b(medicine|mbbs)\b/.test(t)) return 'Medicine';
  if (/\b(law|llb|llm)\b/.test(t)) return 'Law';
  if (/\bengineering\b/.test(t)) return 'Science, Applied';
  return undefined;
}

/**
 * A school's Canadian, U.S. or Mexican address as the education dialog's
 * manual-entry form asks it (live 2026-10-31): the manual-entry box
 * (`#manualEntryaddress_addressEducation-input`, which removes the Canada
 * Post lookup), streetNum, street, apartmentNumber, city and the province
 * (Canada), state (U.S., a list) or mexicoState (Mexico, typed). No postal
 * code was seen in this dialog, so none is written.
 */
interface SchoolManualAddress {
  streetNumber: string;
  streetName: string;
  apartment?: string;
  province?: string;
  state?: string;
  mexicoState?: string;
}

interface SchoolFacts {
  school: string;
  from: string;
  to?: string;
  ongoing: boolean;
  level: string;
  field: string;
  country: string;
  /** Every other country: the one street line. */
  street?: string;
  /** Canada, the U.S. and Mexico: the manual-entry parts. */
  manual?: SchoolManualAddress;
  city: string;
}

/**
 * The manual-entry parts of a school's North American address, or what they
 * lack. The street number and street must be given apart: "88 Harbour
 * Street" is never split, since a wrong split is a wrong address.
 */
function schoolManualAddress(
  e: Profile,
  country: string,
): { parts?: SchoolManualAddress; missing: string[] } {
  const streetNumber = known(
    pickText(e, 'street_number', 'civic_number', 'house_number', 'building_number'),
  );
  const streetName = known(pickText(e, 'street_name'));
  const aptRaw = known(pickText(e, 'apartment', 'unit', 'apartment_number', 'suite'));
  const region = known(pickText(e, 'province', 'state', 'region'));
  const missing: string[] = [];
  if (!streetNumber || !streetName)
    missing.push(
      "the school's street number and street name, each on its own (IRCC asks them apart)",
    );
  if (aptRaw && aptRaw.length > 10)
    missing.push('an apartment / unit of at most 10 characters');
  let province: string | undefined;
  let state: string | undefined;
  let mexicoState: string | undefined;
  if (country === 'CAN') {
    province = region
      ? (CA_PROVINCE_NAMES[region.toUpperCase()] ??
        Object.values(CA_PROVINCE_NAMES).find(
          (n) => n.toLowerCase() === region.toLowerCase(),
        ))
      : undefined;
    if (!province) missing.push('the province');
  } else if (country === 'USA') {
    state = region
      ? (US_STATES[region.toUpperCase()] ??
        Object.values(US_STATES).find(
          (n) => n.toLowerCase() === region.toLowerCase(),
        ))
      : undefined;
    if (!state) missing.push('the state');
  } else {
    mexicoState = region;
    if (!mexicoState) missing.push('the state');
  }
  if (missing.length) return { missing };
  return {
    parts: {
      streetNumber: streetNumber!,
      streetName: streetName!,
      ...(aptRaw ? { apartment: aptRaw } : {}),
      ...(province ? { province } : {}),
      ...(state ? { state } : {}),
      ...(mexicoState ? { mexicoState } : {}),
    },
    missing,
  };
}

/** One school as IRCC's dialog asks it, or what it still lacks. */
function schoolGaps(e: Profile): { facts?: SchoolFacts; missing: string[] } {
  const school = known(pickText(e, 'school', 'institution', 'name'));
  const from = tripMonth(pick(e, 'from', 'from_date', 'start_date', 'start'));
  const toRaw = pickText(e, 'to', 'to_date', 'end_date', 'end');
  const ongoing = !!toRaw && ONGOING.test(toRaw.trim());
  const to = ongoing ? undefined : tripMonth(toRaw);
  const levelRaw = known(pickText(e, 'level', 'level_of_study'));
  const fieldRaw = known(pickText(e, 'field_of_study', 'field'));
  const level = educationLevelOption(levelRaw);
  const field = educationFieldOption(fieldRaw);
  const country = pickCountry(e, 'country');
  const street = known(pickText(e, 'street_address', 'street', 'address'));
  const city = known(pickText(e, 'city', 'town'));
  const missing: string[] = [];
  if (!school) missing.push('the school name');
  if (!from) missing.push('month and year you started');
  if (!to && !ongoing)
    missing.push('month and year you finished (or that you still study there)');
  if (!level)
    missing.push(
      levelRaw ? `the IRCC level of study for "${levelRaw}"` : 'level of study',
    );
  if (!field)
    missing.push(
      fieldRaw ? `the IRCC field of study for "${fieldRaw}"` : 'field of study',
    );
  if (!country) missing.push('country');
  // A Canadian, U.S. or Mexican address takes IRCC's manual-entry form
  // (matrix B A4, live 2026-10-31); every other country one street line.
  const northAmerican = !!country && MANUAL_ENTRY_COUNTRIES.includes(country);
  const manual = northAmerican ? schoolManualAddress(e, country!) : undefined;
  if (manual) missing.push(...manual.missing);
  else if (!street) missing.push('street address');
  if (!city) missing.push('city');
  if (missing.length) return { missing };
  return {
    facts: {
      school: school!,
      from: from!,
      ...(to ? { to } : {}),
      ongoing,
      level: level!,
      field: field!,
      country: country!,
      ...(manual ? { manual: manual.parts! } : { street: street! }),
      city: city!,
    },
    missing,
  };
}

const schoolList = (p: Profile) =>
  people(p, 'education_history', 'schools', 'post_secondary_schools');
const schoolAt = (p: Profile, n: number) => {
  const e = schoolList(p)[n - 1];
  return e ? schoolGaps(e).facts : undefined;
};
const anyEducationRow = (p: Profile) =>
  Array.from({ length: MAX_SCHOOLS }, (_, i) => schoolAt(p, i + 1)).some(
    Boolean,
  );

function educationRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_SCHOOLS; n++) {
    const key = `ircc_school_${n}`;
    const f = (p: Profile) => schoolAt(p, n);
    out.push(
      ...dialogRow(
        ACTIVITIES,
        `${key}_row`,
        '#educationHistory_add_button',
        DIALOG_SAVE,
        `school ${n}`,
        'employment',
        (p) => {
          const s = f(p);
          return s
            ? `${s.school} ${s.from.slice(0, 7)} to ${s.ongoing ? 'now' : s.to!.slice(0, 7)}`
            : undefined;
        },
        [
          text(
            ACTIVITIES,
            `${key}_name`,
            '#nameSchoolEdu_input',
            `School ${n} — name`,
            'employment',
            (p) => f(p)?.school,
          ),
          ...dateSelects(
            ACTIVITIES,
            `${key}_from`,
            'fromEdu',
            `School ${n} — from`,
            'dates',
            { derive: (p) => f(p)?.from },
            false,
          ),
          check(
            ACTIVITIES,
            `${key}_ongoing`,
            '#isOngoingEducation_chk-input',
            `School ${n} — still studying`,
            'employment',
            (p) => (f(p)?.ongoing ? 'Yes' : undefined),
          ),
          ...dateSelects(
            ACTIVITIES,
            `${key}_to`,
            'toEdu',
            `School ${n} — to`,
            'dates',
            { derive: (p) => f(p)?.to },
            false,
          ),
          optionText(
            ACTIVITIES,
            `${key}_level`,
            '#levelStudyEdu_select',
            `School ${n} — level of study`,
            'employment',
            (p) => f(p)?.level,
          ),
          optionText(
            ACTIVITIES,
            `${key}_field`,
            '#fieldStudyEdu_select',
            `School ${n} — field of study`,
            'employment',
            (p) => f(p)?.field,
          ),
          country(
            ACTIVITIES,
            `${key}_country`,
            '#country_addressEducation',
            `School ${n} — country`,
            'addresses',
            (p) => f(p)?.country,
          ),
          // Canada / U.S. / Mexico: the manual-entry form (live 2026-10-31).
          check(
            ACTIVITIES,
            `${key}_manual`,
            '#manualEntryaddress_addressEducation-input',
            `School ${n} — enter the address manually`,
            'addresses',
            (p) => (f(p)?.manual ? 'Yes' : undefined),
          ),
          text(
            ACTIVITIES,
            `${key}_street_number`,
            '#streetNum_addressEducation',
            `School ${n} — street number`,
            'addresses',
            (p) => f(p)?.manual?.streetNumber,
          ),
          text(
            ACTIVITIES,
            `${key}_street_name`,
            '#street_addressEducation',
            `School ${n} — street`,
            'addresses',
            (p) => f(p)?.manual?.streetName,
          ),
          text(
            ACTIVITIES,
            `${key}_apartment`,
            '#apartmentNumber_addressEducation',
            `School ${n} — apartment / unit`,
            'addresses',
            (p) => f(p)?.manual?.apartment,
          ),
          text(
            ACTIVITIES,
            `${key}_street`,
            '#streetAddress_addressEducation',
            `School ${n} — street address`,
            'addresses',
            (p) => f(p)?.street,
          ),
          text(
            ACTIVITIES,
            `${key}_city`,
            '#city_addressEducation',
            `School ${n} — city`,
            'addresses',
            (p) => f(p)?.city,
          ),
          optionText(
            ACTIVITIES,
            `${key}_province`,
            '#province_addressEducation',
            `School ${n} — province`,
            'addresses',
            (p) => f(p)?.manual?.province,
          ),
          optionText(
            ACTIVITIES,
            `${key}_state`,
            '#state_addressEducation',
            `School ${n} — state`,
            'addresses',
            (p) => f(p)?.manual?.state,
          ),
          text(
            ACTIVITIES,
            `${key}_mexico_state`,
            '#mexicoState_addressEducation',
            `School ${n} — state`,
            'addresses',
            (p) => f(p)?.manual?.mexicoState,
          ),
        ],
        {
          reveal: true,
          parent: 'has_post_secondary_education',
          parentValue: 'Yes',
        },
      ),
    );
  }
  return out;
}

// ── military or police service rows (/activities, served: Yes) ──────────────
// Live 2026-10-19: "Add military or police service" (#workHistory_add_button)
// — #locationStationed_input, #countryService_select, fromService / toService
// (year and month), #isOngoing_chk-input, #serviceDetails_txtArea (at most
// 100 characters); saved with #locationStationed_save_button. All required.
const MAX_SERVICE_ROWS = 4;
const SERVICE_DETAILS_MAX = 100;

interface ServiceFacts {
  location: string;
  country: string;
  from: string;
  to?: string;
  ongoing: boolean;
  details: string;
}

const serviceList = (p: Profile) =>
  people(p, 'military_service_history', 'military_service_periods');

/** One period of service as IRCC's dialog asks it, or what it still lacks. */
function serviceGaps(e: Profile): { facts?: ServiceFacts; missing: string[] } {
  const location = known(pickText(e, 'location', 'stationed', 'place'));
  const country = pickCountry(e, 'country');
  const from = tripMonth(pick(e, 'from', 'from_date', 'start_date', 'start'));
  const toRaw = pickText(e, 'to', 'to_date', 'end_date', 'end');
  const ongoing = !!toRaw && ONGOING.test(toRaw.trim());
  const to = ongoing ? undefined : tripMonth(toRaw);
  const details = known(pickText(e, 'details', 'unit', 'description'));
  const missing: string[] = [];
  if (!location) missing.push('where you were stationed');
  if (!country) missing.push('country');
  if (!from) missing.push('month and year it began');
  if (!to && !ongoing)
    missing.push('month and year it ended (or that you still serve)');
  if (!details) missing.push('your unit, rank and duties');
  else if (details.length > SERVICE_DETAILS_MAX)
    missing.push(
      `a description of your unit, rank and duties of at most ${SERVICE_DETAILS_MAX} characters`,
    );
  if (missing.length) return { missing };
  return {
    facts: {
      location: location!,
      country: country!,
      from: from!,
      ...(to ? { to } : {}),
      ongoing,
      details: details!,
    },
    missing,
  };
}

const serviceAt = (p: Profile, n: number) => {
  const e = serviceList(p)[n - 1];
  return e ? serviceGaps(e).facts : undefined;
};
const anyServiceRow = (p: Profile) =>
  Array.from({ length: MAX_SERVICE_ROWS }, (_, i) => serviceAt(p, i + 1)).some(
    Boolean,
  );

function serviceRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_SERVICE_ROWS; n++) {
    const key = `ircc_service_${n}`;
    const f = (p: Profile) => serviceAt(p, n);
    out.push(
      ...dialogRow(
        ACTIVITIES,
        `${key}_row`,
        '#workHistory_add_button',
        DIALOG_SAVE,
        `military or police service ${n}`,
        'employment',
        (p) => {
          const s = f(p);
          return s
            ? `${s.location} ${s.from.slice(0, 7)} to ${s.ongoing ? 'now' : s.to!.slice(0, 7)}`
            : undefined;
        },
        [
          text(
            ACTIVITIES,
            `${key}_location`,
            '#locationStationed_input',
            `Service ${n} — where stationed`,
            'employment',
            (p) => f(p)?.location,
          ),
          country(
            ACTIVITIES,
            `${key}_country`,
            '#countryService_select',
            `Service ${n} — country`,
            'employment',
            (p) => f(p)?.country,
          ),
          ...dateSelects(
            ACTIVITIES,
            `${key}_from`,
            'fromService',
            `Service ${n} — from`,
            'dates',
            { derive: (p) => f(p)?.from },
            false,
          ),
          check(
            ACTIVITIES,
            `${key}_ongoing`,
            '#isOngoing_chk-input',
            `Service ${n} — still serving`,
            'employment',
            (p) => (f(p)?.ongoing ? 'Yes' : undefined),
          ),
          ...dateSelects(
            ACTIVITIES,
            `${key}_to`,
            'toService',
            `Service ${n} — to`,
            'dates',
            { derive: (p) => f(p)?.to },
            false,
          ),
          text(
            ACTIVITIES,
            `${key}_details`,
            '#serviceDetails_txtArea',
            `Service ${n} — unit, rank and duties`,
            'employment',
            (p) => f(p)?.details,
            { maxLength: SERVICE_DETAILS_MAX },
          ),
        ],
        { reveal: true, parent: 'military_service', parentValue: 'Yes' },
      ),
    );
  }
  return out;
}

function noTravel5y(p: Profile): 'No' | undefined {
  const list = pick(p, 'travel_history_countries', 'travel_history');
  if (Array.isArray(list) && list.length === 0) return 'No';
  if (
    declared(p, 'has_travel_history') === 'No' ||
    declared(p, 'no_travel_history') === 'Yes'
  )
    return 'No';
  if (typeof list === 'string' && /^(none|no|never)$/i.test(list.trim()))
    return 'No';
  return undefined;
}

const REFUSED_KEYS = [
  'previous_visa_refused',
  'previous_visa_refusal',
  'previous_visa_denied',
  'visa_refused',
  'has_prior_refusal',
  // The interview's own answer keys (live 2026-10-18, super visa).
  'visa_refusal_history',
  'refused_visa_or_denied_entry',
];
const DENIED_ENTRY_KEYS = [
  'denied_entry',
  'refused_entry',
  'denied_entry_to_any_country',
  'denied_entry_history',
];
const ORDERED_TO_LEAVE_KEYS = [
  'removal_orders',
  'ordered_to_leave',
  'deported',
  'removed_from_country',
  'ordered_to_leave_country',
];

/** Answers about Canada in particular: a "Yes" to any one of them. */
export const CANADA_REFUSED_KEYS = [
  'refused_by_canada',
  'refused_visa_or_permit_or_denied_entry_to_canada',
  'canada_refusal',
  'refused_canada',
  'previously_refused_canada',
  'canadian_visa_refused',
];
export const refusedByCanada = (p: Profile): boolean =>
  CANADA_REFUSED_KEYS.some((k) => declared(p, k) === 'Yes');

/**
 * IRCC asks one question for three facts: refused a visa or permit, denied
 * entry, or ordered to leave any country. "Yes" when the applicant said yes to
 * any; "No" only when they said no to all three.
 */
export function refusedOrOrderedToLeave(p: Profile): 'Yes' | 'No' | undefined {
  const own = declared(p, 'refused_or_ordered_to_leave');
  if (own) return own;
  // A refusal by Canada is a refusal by "any country": its "Yes" wins over
  // "No" to the three general parts (review 2026-10-18).
  if (refusedByCanada(p)) return 'Yes';
  const answers = [
    declared(p, ...REFUSED_KEYS),
    declared(p, ...DENIED_ENTRY_KEYS),
    declared(p, ...ORDERED_TO_LEAVE_KEYS),
  ];
  if (answers.includes('Yes')) return 'Yes';
  if (answers.every((a) => a === 'No')) return 'No';
  return undefined;
}

/**
 * The interview records several refusals as a list of records, e.g.
 * `[{country: 'Canada', what_was_refused: 'visitor visa', month_year:
 * '2023-10', reason: '…'}]` (live E2E 2026-10-18). One sentence each.
 */
function refusalRecordsText(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined;
  const str = (r: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) {
      const x = r[k];
      if (typeof x === 'string' && x.trim()) return x.trim();
    }
    return undefined;
  };
  const lines = v
    .map((r) => {
      if (typeof r === 'string') return r.trim() || undefined;
      if (!r || typeof r !== 'object') return undefined;
      const rec = r as Record<string, unknown>;
      const country = str(rec, 'country', 'refusing_country');
      const what = str(rec, 'what_was_refused', 'type', 'application_type');
      const when = str(rec, 'month_year', 'date', 'when');
      const reason = str(rec, 'reason', 'reason_given');
      // Where it happened, when the applicant said (live 2026-10-19: "in
      // Mexico City" was dropped — the record had nowhere to keep it).
      const where = str(rec, 'where', 'place', 'city', 'location', 'consulate');
      if (!country && !what && !when) return undefined;
      const head = `${what ? what.charAt(0).toUpperCase() + what.slice(1) : 'Visa'} refused${country ? ` by ${country}` : ''}${where ? ` in ${where}` : ''}${when ? ` in ${when}` : ''}.`;
      if (!reason) return head;
      if (/^(no|none|not)\b.*\breason\b|^none$/i.test(reason))
        return `${head} No reason was given.`;
      return `${head} Reason given: ${reason.replace(/\.$/, '')}.`;
    })
    .filter((x): x is string => !!x);
  return lines.length ? lines.join(' ') : undefined;
}

/**
 * The refusal details box. The flat `previous_visa_refusal_*` record is used
 * whenever the question it sits under was answered "Yes" — not only when the
 * "yes" came from a visa-refusal key: a "yes" given as denied entry, ordered
 * to leave or refused by Canada left the box blank beside a full record
 * (audit 2026-10-19). `refused` lets a form whose question reads other keys
 * (the eTA) say so.
 */
export function refusalDetails(
  p: Profile,
  refused: boolean = declared(p, ...REFUSED_KEYS) === 'Yes' ||
    refusedOrOrderedToLeave(p) === 'Yes',
): string | undefined {
  const explicit =
    pickText(p, 'refusal_details', 'previous_visa_refusal_details') ??
    refusalRecordsText(p.refusal_details) ??
    refusalRecordsText(p.previous_visa_refusal_details);
  if (explicit) return explicit;
  if (!refused) return undefined;
  let country =
    displayCountry(
      pickCountry(p, 'previous_visa_refusal_country', 'refusal_country'),
    ) ?? pickText(p, 'previous_visa_refusal_country', 'refusal_country');
  const date = pickDate(p, 'previous_visa_refusal_date', 'refusal_date');
  const number = pickText(
    p,
    'previous_visa_refusal_number',
    'previous_visa_application_number',
    'refusal_application_number',
    'refusal_number',
  );
  const reason = pickText(p, 'previous_visa_refusal_reason', 'refusal_reason');
  // A refusal the record itself places in Canada: an IRCC application number
  // (a letter and nine digits, e.g. V403886015) or a reason citing Canada's
  // immigration regulations. Without a country the details read "Visa
  // refused on …" with no refusing country (dry run 2026-10-16).
  const canadian =
    !country &&
    ((number && /^[A-Z]\d{9}$/.test(number.trim())) ||
      (reason && /\bIRP[RA]\b/.test(reason)));
  if (canadian) country = 'Canada';
  if (!country && !date && !reason) return undefined;
  return sentence(
    `Visa refused${country ? ` by ${country}` : ''}${date ? ` on ${date}` : ''}${number ? ` (application ${number})` : ''}.`,
    reason ? `Reason given: ${reason.replace(/\.$/, '')}.` : undefined,
  );
}

// Charged / convicted are covered exactly by an explicit "no charges or
// convictions"; committed / arrested are not, and need their own answer.
const noChargesOrConvictions = (p: Profile) =>
  declared(p, 'criminal_charges_or_convictions') === 'No' ? 'No' : undefined;

function maritalStatus(p: Profile): string | undefined {
  const s = pickText(p, 'marital_status', 'civil_status')?.toLowerCase();
  if (!s) return undefined;
  if (/annul/.test(s)) return 'Annulled Marriage';
  if (/common/.test(s)) return 'Common-Law';
  if (/divorc/.test(s)) return 'Divorced';
  if (/separat/.test(s)) return 'Separated';
  if (/widow/.test(s)) return 'Widowed';
  if (/^(single|never married|unmarried)$/.test(s)) return 'Single';
  if (/^married$/.test(s)) return 'Married';
  return undefined;
}

/** Spouse questions IRCC shows: the living partner's details (Married, Common-Law). */
const SPOUSE_LIVING = ['Married', 'Common-Law'];
/**
 * The union ended: Divorced, Separated, Annulled and Widowed all reveal the
 * same block live (2026-10-31, tr-rt draft): dateOfDating*, lastName_input,
 * firstName_input, dateOfBirthPartner*, countryOfBirthPartner_select and
 * endDatePartner*. (The 2026-10-15 note that the first three showed only
 * endDatePartner was wrong.)
 */
const UNION_ENDED = ['Divorced', 'Separated', 'Annulled Marriage', 'Widowed'];
/** Name, birth and union date: the living spouse's, or the former / late one's. */
const SPOUSE_KNOWN = ['Married', 'Common-Law', ...UNION_ENDED];
const unionEnded = (p: Profile) => UNION_ENDED.includes(maritalStatus(p) ?? '');
/** The former or late spouse's own answers (intake `previous_spouse_*`), when the union ended. */
const previousSpouseNames = (p: Profile) =>
  unionEnded(p)
    ? nameParts(
        {
          spouse_family_name: pickText(
            p,
            'previous_spouse_family_name',
            'former_spouse_family_name',
          ),
          spouse_given_name: pickText(
            p,
            'previous_spouse_given_name',
            'former_spouse_given_name',
          ),
          spouse_name: pickText(
            p,
            'previous_spouse_name',
            'former_spouse_name',
            'late_spouse_name',
          ),
        },
        'spouse',
      )
    : {};
const previousMarriageDate = (p: Profile) =>
  unionEnded(p)
    ? pickDate(
        p,
        'previous_marriage_date',
        'former_marriage_date',
        'date_of_previous_marriage',
      )
    : undefined;

const spouse = (p: Profile): Profile => {
  const o = pick(p, 'spouse', 'partner');
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Profile) : {};
};
const spouseNames = (p: Profile) => {
  const prev = previousSpouseNames(p);
  if (prev.family || prev.given) return prev;
  const s = spouse(p);
  const merged: Profile = {
    spouse_family_name:
      pickText(p, 'spouse_family_name', 'spouse_last_name') ??
      pickText(s, 'family_name', 'last_name'),
    spouse_given_name:
      pickText(p, 'spouse_given_name', 'spouse_first_name') ??
      pickText(s, 'given_name', 'first_name'),
    spouse_name:
      pickText(p, 'spouse_name', 'spouse_full_name') ??
      pickText(s, 'name', 'full_name'),
  };
  return nameParts(merged, 'spouse');
};
const PREVIOUS_SPOUSE_DOB_KEYS = [
  'previous_spouse_date_of_birth',
  'former_spouse_date_of_birth',
  'late_spouse_date_of_birth',
];
const spouseDob = (p: Profile) =>
  (unionEnded(p)
    ? (pickDate(p, ...PREVIOUS_SPOUSE_DOB_KEYS) ??
      // The partner's month and day selects have "Unknown" (live
      // 2026-10-31), so a year or year-month alone is enough.
      PREVIOUS_SPOUSE_DOB_KEYS.map((k) =>
        childBirthYearDob({ date_of_birth: p[k] }),
      ).find(Boolean))
    : undefined) ??
  pickDate(p, 'spouse_date_of_birth', 'spouse_dob', 'spouse_birth_date') ??
  pickDate(spouse(p), 'date_of_birth', 'dob', 'birth_date');
const spouseBirthCountry = (p: Profile) =>
  (unionEnded(p)
    ? pickCountry(
        p,
        'previous_spouse_country_of_birth',
        'former_spouse_country_of_birth',
        'late_spouse_country_of_birth',
      )
    : undefined) ??
  pickCountry(p, 'spouse_country_of_birth', 'spouse_birth_country') ??
  splitPlace(pick(p, 'spouse_place_of_birth')).country ??
  pickCountry(spouse(p), 'country_of_birth', 'birth_country') ??
  splitPlace(spouse(p).place_of_birth).country;
/** The date the union ended (`endDatePartner`): the full date only. */
const unionEndDate = (p: Profile) =>
  maritalStatus(p) === 'Widowed'
    ? pickDate(p, 'spouse_date_of_death', 'marriage_end_date')
    : pickDate(
        p,
        'marriage_end_date',
        'divorce_date',
        'separation_date',
        'annulment_date',
      );
/** The marriage / relationship date (`dateOfDating`): the full date only (no "Unknown"). */
const unionStartDate = (p: Profile) =>
  (maritalStatus(p) === 'Common-Law'
    ? pickDate(p, 'common_law_since', 'relationship_start_date')
    : pickDate(p, 'date_of_marriage', 'wedding_date')) ??
  previousMarriageDate(p);
/** What the former or late spouse's block still lacks, in IRCC's order. */
function previousSpouseGaps(p: Profile): string[] {
  const gaps: string[] = [];
  if (!unionStartDate(p))
    gaps.push('the full date of the marriage or relationship (day, month and year)');
  const n = spouseNames(p);
  if (!n.family || !n.given) gaps.push("their family and given names");
  if (!spouseDob(p)) gaps.push('their date of birth (at least the year)');
  if (!spouseBirthCountry(p)) gaps.push('their country of birth');
  if (!unionEndDate(p))
    gaps.push('the full date the marriage or relationship ended');
  return gaps;
}

/**
 * `#partnerOccupation_select` takes the same list as the work-history
 * activity (`getLov(WP_Occupation)` for both in the IRCC bundle, checked
 * 2026-10-31), so a working spouse's job title is placed by the same rules in
 * ircc-occupations.ts. A title the rules cannot place is left blank for the
 * applicant: a wrong occupation is worse than none.
 */
function spouseOccupationOption(p: Profile): string | undefined {
  const raw =
    pickText(p, 'spouse_occupation') ?? pickText(spouse(p), 'occupation');
  const o = raw?.toLowerCase().trim();
  if (!o) return undefined;
  if (
    /^(homemaker|housewife|househusband|home maker|stay[- ]at[- ]home)/.test(o)
  )
    return IRCC_ACTIVITY.homemaker;
  // Anywhere in the text: "teacher (unemployed)" is not Education.
  if (/\b(un-?employed|not (employed|working)|jobless)\b/.test(o))
    return IRCC_ACTIVITY.unemployed;
  if (/\bretired\b/.test(o)) return IRCC_ACTIVITY.retired;
  return irccOccupationFor(raw)?.activity;
}

// ── children ────────────────────────────────────────────────────────────────
const MAX_CHILDREN = 6;
const childList = (p: Profile) =>
  people(p, 'children', 'kids', 'dependent_children');

function hasChildren(p: Profile): 'Yes' | 'No' | undefined {
  const yn = declared(p, 'has_children');
  if (yn) return yn;
  const n = pick(p, 'number_of_children');
  if (n === 0 || n === '0') return 'No';
  const list = pick(p, 'children', 'kids', 'dependent_children');
  if (Array.isArray(list)) return list.length > 0 ? 'Yes' : 'No';
  return undefined;
}

interface ChildFacts {
  family: string;
  given: string;
  dob: string;
  relationship: string;
  birthCountry: string;
  /**
   * The child has died: `#firstChildIsDeceased_chk-input` is ticked, which
   * hides hasSameAddress and childComingCanada; IRCC asks no date of death
   * (live 2026-10-31: a deceased son, DOB 2010-Unknown-Unknown, SAVED).
   */
  deceased: boolean;
  sameAddress?: 'Yes' | 'No';
  coming?: 'Yes' | 'No';
  /** Where they live, when not with the applicant. */
  address?: Address;
}

function childRelationship(c: Profile): string | undefined {
  const r = pickText(c, 'relationship', 'relation')?.toLowerCase() ?? '';
  const sex = pickText(c, 'sex', 'gender')?.toLowerCase() ?? '';
  const step = /step/.test(r);
  const son =
    /\bson\b|stepson/.test(r) ||
    (!r.match(/daughter/) && /^(m|male)$/.test(sex));
  const daughter =
    /daughter/.test(r) || (!r.match(/\bson\b/) && /^(f|female)$/.test(sex));
  if (son === daughter) return undefined;
  if (son) return step ? 'Step-Son' : 'Son';
  return step ? 'Step-Daughter' : 'Daughter';
}

/**
 * A date of birth as IRCC's children and parents grids show it: an unknown
 * month or day is "**" ("2000-**-**"), so a re-run recognises the row it
 * added. "born 2000" never matched, and the row was added again on every
 * re-run (review of #240, 2026-10-19). Recorded on the children grid; the
 * parents grid is the same component and is assumed to show it the same way.
 */
const rowDob = (dob: string) => dob.replace(/-Unknown/g, '-**');

/**
 * A child's date of birth when only the YEAR is known, as
 * "<year>-Unknown-Unknown": IRCC's children dialog has an "Unknown" option in
 * its month and day selects (`dateOfBirthChild{Month,Day}_sltDate*`), so a
 * year is enough to add the child. Dry run 2026-10-15: the applicant gave his
 * son's birth year, and the child was listed as "missing: date of birth".
 */
function childBirthYearDob(c: Profile): string | undefined {
  for (const k of [
    'birth_year',
    'year_of_birth',
    'date_of_birth',
    'dob',
    'birth_date',
  ]) {
    const v = c[k];
    const t =
      typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (/^(19|20)\d{2}$/.test(t)) return `${t}-Unknown-Unknown`;
    // Known to the month only ("1960-05"): the day select's "Unknown".
    if (/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(t)) return `${t}-Unknown`;
  }
  return undefined;
}

/**
 * An answer given once for a whole list of people: "which of your children
 * live with you?" → `children_living_with_you: ["Sajawal"]`. Yes when the
 * person is named, No when the answer names others or nobody ("none", [],
 * false); undefined when the answer cannot be read for this person.
 */
export function listAnswer(
  p: Profile,
  key: string,
  name: string,
  everyone: number,
): 'Yes' | 'No' | undefined {
  const v = p[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') {
    if (!v) return 'No';
    return everyone === 1 ? 'Yes' : undefined;
  }
  let names: string[];
  if (Array.isArray(v)) {
    names = v.filter((x): x is string => typeof x === 'string');
    if (names.length !== v.length) return undefined;
  } else if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (/^(none|no|nobody|no one|neither|n\/a)$/.test(t)) return 'No';
    if (/^(all|everyone|both|yes|all of them)$/.test(t)) return 'Yes';
    names = v.split(/,|\band\b|&/).map((x) => x.trim());
  } else {
    return undefined;
  }
  return names.some((n) => n && isSamePerson(n, name)) ? 'Yes' : 'No';
}

/**
 * The applicant said this child has died: on the child, or in the intake's
 * `children_deceased` list of names. Only an explicit answer.
 */
function childDeceased(c: Profile, p: Profile): boolean {
  const name = pickText(c, 'name', 'full_name') ?? '';
  return (
    (declared(c, 'deceased', 'is_deceased') ??
      listAnswer(p, 'children_deceased', name, childList(p).length)) === 'Yes'
  );
}

/** Missing facts for a child, in the order IRCC's dialog asks for them. */
function childGaps(
  c: Profile,
  p: Profile = {},
): { facts?: ChildFacts; missing: string[] } {
  const everyone = childList(p).length;
  const childName = pickText(c, 'name', 'full_name') ?? '';
  const names = nameParts(
    {
      c_family_name: pickText(c, 'family_name', 'last_name', 'surname'),
      c_given_name: pickText(c, 'given_name', 'first_name', 'given_names'),
      c_name: pickText(c, 'name', 'full_name'),
    },
    'c',
  );
  const dob =
    pickDate(c, 'date_of_birth', 'dob', 'birth_date') ?? childBirthYearDob(c);
  const relationship = childRelationship(c);
  const birthCountry =
    pickCountry(c, 'country_of_birth', 'birth_country') ??
    splitPlace(c.place_of_birth).country;
  const sameAddress =
    declared(
      c,
      'same_address',
      'lives_with_applicant',
      'same_address_as_applicant',
    ) ??
    listAnswer(p, 'children_living_with_you', childName, everyone) ??
    // A child living outside the applicant's home country cannot share the
    // applicant's address there.
    (declared(c, 'in_home_country') === 'No' ? 'No' : undefined);
  const coming =
    declared(
      c,
      'coming_to_canada',
      'accompanying',
      'travelling_with_applicant',
      'traveling_with_applicant',
    ) ?? listAnswer(p, 'children_accompanying', childName, everyone);
  // A child who has died (matrix C row 35): the deceased box hides the
  // address and coming-to-Canada questions, and no date of death follows
  // (live 2026-10-31), so neither is asked or written.
  const deceased = childDeceased(c, p);
  const missing: string[] = [];
  if (!names.family || !names.given) missing.push('full name');
  if (!dob) missing.push('date of birth');
  if (!relationship) missing.push('son or daughter');
  if (!birthCountry) missing.push('country of birth');
  if (!deceased && !sameAddress)
    missing.push('whether they live at your address');
  if (!deceased && !coming) missing.push('whether they are coming to Canada');
  const address =
    !deceased && sameAddress === 'No'
      ? personAddress(c, childName, p)
      : undefined;
  if (!deceased && sameAddress === 'No' && !address)
    missing.push('their address');
  if (missing.length) return { missing };
  return {
    facts: {
      family: names.family!,
      given: names.given!,
      dob: dob!,
      relationship: relationship!,
      birthCountry: birthCountry!,
      deceased,
      ...(deceased ? {} : { sameAddress: sameAddress!, coming: coming! }),
      address,
    },
    missing,
  };
}

/**
 * Where a family member who does not live with the applicant lives: their own
 * address, or the host's when they are the host (the son the applicant is
 * visiting). Undefined when not complete enough for IRCC.
 */
function personAddress(
  c: Profile,
  name: string,
  p: Profile,
): Address | undefined {
  const own = anyAddress(
    pick(c, 'address', 'residential_address', 'home_address'),
    pickCountry(c, 'country_of_residence', 'lives_in', 'residence_country'),
  );
  if (own) return own;
  const host = inviter(p);
  const hostName =
    typeof host.name === 'string'
      ? host.name
      : [host.given_name, host.family_name].filter(Boolean).join(' ');
  if (name && hostName && isSamePerson(name, hostName)) {
    const a = inviterAddress(p);
    if (a) return { ...a, country: 'CAN' };
  }
  return undefined;
}

const childAt = (p: Profile, n: number) => {
  const c = childList(p)[n - 1];
  return c ? childGaps(c, p).facts : undefined;
};

const anyChildRow = (p: Profile) =>
  Array.from({ length: MAX_CHILDREN }, (_, i) => childAt(p, i + 1)).some(
    Boolean,
  );

function childRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_CHILDREN; n++) {
    const key = `ircc_child_${n}`;
    const f = (p: Profile) => childAt(p, n);
    out.push(
      ...dialogRow(
        CHILDREN,
        `${key}_row`,
        'main button[id*="add"]',
        DIALOG_SAVE,
        `child ${n}`,
        'passport',
        (p) => {
          const c = f(p);
          return c
            ? `${c.given} ${c.family} (${c.relationship}, born ${rowDob(c.dob)})`
            : undefined;
        },
        [
          text(
            CHILDREN,
            `${key}_family_name`,
            '#lastName_input',
            `Child ${n} — family name`,
            'passport',
            (p) => f(p)?.family,
          ),
          text(
            CHILDREN,
            `${key}_given_name`,
            '#firstName_input',
            `Child ${n} — given name`,
            'passport',
            (p) => f(p)?.given,
          ),
          ...dateSelects(
            CHILDREN,
            `${key}_date_of_birth`,
            'dateOfBirthChild',
            `Child ${n} — date of birth`,
            'dates',
            { derive: (p) => f(p)?.dob },
          ),
          // Between the date of birth and the relationship, as IRCC's dialog
          // orders it. Ticked only for a child the applicant said has died.
          check(
            CHILDREN,
            `${key}_deceased`,
            '#firstChildIsDeceased_chk-input',
            `Child ${n} — deceased`,
            'passport',
            (p) => (f(p)?.deceased ? 'Yes' : undefined),
          ),
          optionText(
            CHILDREN,
            `${key}_relationship`,
            '#relationshipChild_select',
            `Child ${n} — relationship`,
            'passport',
            (p) => f(p)?.relationship,
          ),
          country(
            CHILDREN,
            `${key}_country_of_birth`,
            '#countryOfBirthChild_select',
            `Child ${n} — country of birth`,
            'passport',
            (p) => f(p)?.birthCountry,
          ),
          yesNo(
            CHILDREN,
            `${key}_same_address`,
            'hasSameAddress',
            `Child ${n} — lives at your address`,
            'addresses',
            (p) => f(p)?.sameAddress,
          ),
          ...addressFields(
            CHILDREN,
            `${key}_address`,
            'childInfoAddress',
            `Child ${n} — address`,
            (p) => f(p)?.address,
          ),
          yesNo(
            CHILDREN,
            `${key}_coming_to_canada`,
            'childComingCanada',
            `Child ${n} — coming to Canada with you`,
            'travel_history',
            (p) => f(p)?.coming,
          ),
        ],
        { reveal: true, parent: 'has_children', parentValue: 'Yes' },
      ),
    );
  }
  return out;
}

// ── parents ─────────────────────────────────────────────────────────────────
const MAX_PARENTS = 2;
const PARENT_ROLES = ['father', 'mother'] as const;

/**
 * The applicant's parents: a `parents` list from the interview, plus any
 * parent recorded only under flat keys (`father_name` from a CNIC,
 * `mother_date_of_birth`, …). A flat parent joins the list unless the list
 * already has someone in that role; then the flat keys only complete what
 * that row leaves out (the Forms page asks `father_occupation` and friends of
 * an applicant whose interview named the parent but not the rest).
 */
const PARENT_FLAT_ATTRS = [
  'date_of_birth',
  'birth_year',
  'country_of_birth',
  'place_of_birth',
  'occupation',
  'deceased',
  'same_address',
  'coming_to_canada',
  'address',
  'date_of_death',
] as const;

function withFlatParentKeys(
  row: Profile,
  p: Profile,
  role: (typeof PARENT_ROLES)[number],
): Profile {
  const out: Profile = { ...row };
  for (const k of PARENT_FLAT_ATTRS) {
    const cur = out[k];
    if (cur !== undefined && cur !== null && cur !== '') continue;
    const v = p[`${role}_${k}`];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

function parentList(p: Profile): Profile[] {
  const list = people(p, 'parents').map((x) => {
    const role = parentRole(x);
    return role ? withFlatParentKeys(x, p, role) : x;
  });
  const out = [...list];
  for (const role of PARENT_ROLES) {
    if (out.some((x) => parentRole(x) === role)) continue;
    const name =
      pickText(p, `${role}_name`, `${role}_full_name`) ??
      // The Forms page keeps the two halves (father_given_name +
      // father_family_name).
      ([pickText(p, `${role}_given_name`), pickText(p, `${role}_family_name`)]
        .filter(Boolean)
        .join(' ') ||
        undefined);
    if (!name) continue;
    out.push(withFlatParentKeys({ name, relationship: role }, p, role));
  }
  return out;
}

function parentRole(c: Profile): 'father' | 'mother' | undefined {
  const r =
    pickText(c, 'relationship', 'relation', 'role')?.toLowerCase() ?? '';
  if (/father|dad/.test(r)) return 'father';
  if (/mother|mum|mom/.test(r)) return 'mother';
  return undefined;
}

interface ParentFacts {
  family: string;
  given: string;
  relationship: 'Father' | 'Mother';
  dob: string;
  birthCountry: string;
  /** A deceased parent: date of death instead of the living-parent questions. */
  deceased: boolean;
  dateOfDeath?: string;
  occupation?: string;
  sameAddress?: 'Yes' | 'No';
  coming?: 'Yes' | 'No';
  address?: Address;
}

/** Missing facts for a parent, in the order IRCC's dialog asks for them. */
function parentGaps(
  c: Profile,
  p: Profile,
): { facts?: ParentFacts; missing: string[] } {
  const names = nameParts(
    {
      c_family_name: pickText(c, 'family_name', 'last_name', 'surname'),
      c_given_name: pickText(c, 'given_name', 'first_name', 'given_names'),
      c_name: pickText(c, 'name', 'full_name'),
    },
    'c',
  );
  const name = pickText(c, 'name', 'full_name') ?? '';
  const everyone = parentList(p).length;
  const role = parentRole(c);
  const dob =
    pickDate(c, 'date_of_birth', 'dob', 'birth_date') ?? childBirthYearDob(c);
  const birthCountry =
    pickCountry(c, 'country_of_birth', 'birth_country') ??
    splitPlace(c.place_of_birth).country;
  const occupation = pickText(c, 'occupation', 'job', 'profession');
  const sameAddress =
    declared(c, 'same_address', 'lives_with_applicant') ??
    listAnswer(p, 'parents_living_with_you', name, everyone);
  const coming =
    declared(c, 'coming_to_canada', 'accompanying') ??
    listAnswer(p, 'parents_accompanying', name, everyone);
  const missing: string[] = [];
  if (!names.family || !names.given) missing.push('full name');
  if (!role) missing.push('father or mother');
  if (!dob) missing.push('date of birth');
  if (!birthCountry) missing.push('country of birth');
  // IRCC asks a deceased parent's date of death and nothing about where they
  // live or whether they travel (live 2026-10-18).
  const deceased = declared(c, 'deceased', 'is_deceased') === 'Yes';
  // Only the full date: IRCC's dateOfDeath{Year,Month,Day} selects have no
  // "Unknown" option (the birth-date selects do), so a year or month alone is
  // never written as "YYYY-Unknown-Unknown" (matrix C row 46).
  const dateOfDeath = deceased
    ? pickDate(c, 'date_of_death', 'death_date')
    : undefined;
  let address: Address | undefined;
  if (deceased) {
    if (!dateOfDeath)
      missing.push(
        childBirthYearDob({
          birth_year: pick(
            c,
            'year_of_death',
            'death_year',
            'date_of_death',
            'death_date',
          ),
        })
          ? 'the full date of death (IRCC needs the day, month and year)'
          : 'date of death',
      );
  } else {
    if (!occupation) missing.push('occupation');
    if (!sameAddress) missing.push('whether they live at your address');
    if (!coming) missing.push('whether they are coming to Canada');
    if (sameAddress === 'No') {
      address = personAddress(c, name, p);
      if (!address) missing.push('their address');
    }
  }
  if (missing.length) return { missing };
  return {
    facts: {
      family: names.family!,
      given: names.given!,
      relationship: role === 'father' ? 'Father' : 'Mother',
      dob: dob!,
      birthCountry: birthCountry!,
      deceased,
      dateOfDeath,
      occupation: deceased ? undefined : occupation,
      sameAddress: deceased ? undefined : sameAddress,
      coming: deceased ? undefined : coming,
      address,
    },
    missing,
  };
}

/** The applicant said they do not know who their parents are, and named none. */
const parentsUnknown = (p: Profile) =>
  declared(p, 'parents_unknown', 'does_not_know_parents', 'parents_not_known') ===
    'Yes' && parentList(p).length === 0;

const parentAt = (p: Profile, n: number) => {
  const c = parentList(p)[n - 1];
  return c ? parentGaps(c, p).facts : undefined;
};

function parentRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_PARENTS; n++) {
    const key = `ircc_parent_${n}`;
    const f = (p: Profile) => parentAt(p, n);
    out.push(
      ...dialogRow(
        PARENTS,
        `${key}_row`,
        '#parentInfoGrid_add_button',
        DIALOG_SAVE,
        `parent ${n}`,
        'passport',
        (p) => {
          const c = f(p);
          return c
            ? `${c.given} ${c.family} (${c.relationship}, born ${rowDob(c.dob)})`
            : undefined;
        },
        [
          text(
            PARENTS,
            `${key}_family_name`,
            '#lastName_input',
            `Parent ${n} — family name`,
            'passport',
            (p) => f(p)?.family,
          ),
          text(
            PARENTS,
            `${key}_given_name`,
            '#firstName_input',
            `Parent ${n} — given name`,
            'passport',
            (p) => f(p)?.given,
          ),
          optionText(
            PARENTS,
            `${key}_relationship`,
            '#relationshipParents_select',
            `Parent ${n} — relationship`,
            'passport',
            (p) => f(p)?.relationship,
          ),
          ...dateSelects(
            PARENTS,
            `${key}_date_of_birth`,
            'dateOfBirth',
            `Parent ${n} — date of birth`,
            'dates',
            { derive: (p) => f(p)?.dob },
          ),
          check(
            PARENTS,
            `${key}_deceased`,
            '#isDeathParent_chk-input',
            `Parent ${n} — deceased`,
            'passport',
            (p) => (f(p)?.deceased ? 'Yes' : undefined),
          ),
          ...dateSelects(
            PARENTS,
            `${key}_date_of_death`,
            'dateOfDeath',
            `Parent ${n} — date of death`,
            'dates',
            { derive: (p) => f(p)?.dateOfDeath },
          ),
          country(
            PARENTS,
            `${key}_country_of_birth`,
            '#parentCountryOfBirth_select',
            `Parent ${n} — country of birth`,
            'passport',
            (p) => f(p)?.birthCountry,
          ),
          text(
            PARENTS,
            `${key}_occupation`,
            '#parentOccupation_input',
            `Parent ${n} — occupation`,
            'employment',
            (p) => f(p)?.occupation,
          ),
          yesNo(
            PARENTS,
            `${key}_same_address`,
            'addressParent',
            `Parent ${n} — lives at your address`,
            'addresses',
            (p) => f(p)?.sameAddress,
          ),
          ...addressFields(
            PARENTS,
            `${key}_address`,
            'residentialAddress',
            `Parent ${n} — address`,
            (p) => f(p)?.address,
          ),
          yesNo(
            PARENTS,
            `${key}_coming_to_canada`,
            'parentComingCanada',
            `Parent ${n} — coming to Canada with you`,
            'travel_history',
            (p) => f(p)?.coming,
          ),
        ],
      ),
    );
  }
  return out;
}

// ── language and contact ────────────────────────────────────────────────────
/** IRCC's "Specify" box takes English/French letters only (AlphaEnglishFrench). */
const IRCC_LETTERS =
  /^[a-zA-ZáàâäéèêëíìîïóòôöúùûüçÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÇŒœŸÿ]{1,100}$/;

/** Answers that name no language: left for the applicant, never typed in. */
const NOT_A_LANGUAGE =
  /^(none|no|na|n\/a|nil|unknown|same|other|others|not sure|interp\. not required)$/i;

/** Other names for a language IRCC lists under one name. */
const LANGUAGE_ALIASES: Record<string, string> = {
  panjabi: 'Punjabi',
  bangla: 'Bengali',
  filipino: 'Tagalog',
};

/** Listed entries that are kinds of `name` ("Balochi East/South/West Pak"). */
const languageVariants = (name: string) =>
  IRCC_NATIVE_LANGUAGES.filter((l) => {
    const t = l.toLowerCase();
    return t !== name && (t.startsWith(`${name},`) || t.startsWith(`${name} `));
  });

/**
 * The native language as IRCC's list names it (IRCC_NATIVE_LANGUAGES, exact
 * option text): the same name, a known other name, or the one entry
 * "Name, …". A name IRCC lists in several kinds ("Balochi …") is the
 * applicant's to choose. Any other one word is "Other" with the language
 * typed in, when IRCC's letters-only box takes it.
 */
function nativeLanguage(
  p: Profile,
): { option: string; other?: string } | undefined {
  const raw = pickText(p, 'native_language', 'mother_tongue', 'first_language');
  if (!raw || NOT_A_LANGUAGE.test(raw.trim())) return undefined;
  const want = raw.trim().toLowerCase();
  const exact = IRCC_NATIVE_LANGUAGES.find((l) => l.toLowerCase() === want);
  if (exact) return { option: exact };
  if (LANGUAGE_ALIASES[want]) return { option: LANGUAGE_ALIASES[want] };
  const kinds = languageVariants(want);
  if (kinds.length === 1 && kinds[0].toLowerCase().startsWith(`${want},`))
    return { option: kinds[0] };
  if (kinds.length > 0) return undefined;
  const typed = raw.trim();
  return IRCC_LETTERS.test(typed)
    ? { option: 'Other', other: typed }
    : undefined;
}

function officialLanguages(p: Profile): string | undefined {
  const said = pickText(
    p,
    'official_language_ability',
    'english_french_ability',
    'official_languages',
  )?.toLowerCase();
  let en: boolean | undefined;
  let fr: boolean | undefined;
  if (said) {
    if (/both/.test(said)) return 'Both';
    if (/neither|none/.test(said)) return 'Neither';
    en = /english/.test(said);
    fr = /french|fran/.test(said);
  } else {
    const spoken = pick(p, 'languages_spoken', 'languages');
    if (!Array.isArray(spoken)) return undefined;
    const list = spoken.map((x) => String(x).toLowerCase());
    en = list.some((x) => /english/.test(x));
    fr = list.some((x) => /french|fran/.test(x));
  }
  if (en && fr) return 'Both';
  if (en) return 'English';
  if (fr) return 'French';
  return said ? undefined : 'Neither';
}

function preferredLanguage(p: Profile): string | undefined {
  const said = pickText(
    p,
    'preferred_contact_language',
    'preferred_language',
  )?.toLowerCase();
  if (said && /english/.test(said)) return 'English';
  if (said && /french|fran/.test(said)) return 'French';
  // Only one of the two to choose from.
  const ability = officialLanguages(p);
  return ability === 'English' || ability === 'French' ? ability : undefined;
}

const applicantEmail = (p: Profile) =>
  pickText(p, 'email', 'applicant_email', 'contact_email', 'email_address');
const applicantPhone = (p: Profile) =>
  pickText(
    p,
    'phone_number',
    'telephone',
    'phone',
    'contact_phone',
    'applicant_phone',
  );
const applicantPhoneType = (p: Profile) =>
  phoneTypeOption(pickText(p, 'phone_type', 'telephone_type'));

/** Where the applicant lives: the home address's country, else the stated one. */
const residenceCountry = (p: Profile) =>
  residentialAddress(p)?.country ??
  pickCountry(
    p,
    'country_of_residence',
    'current_country_of_residence',
    'residence_country',
  );

/**
 * The applicant's phone row: its type and the number placed for IRCC
 * (phone-numbers.ts) — a +CC in the number, a code the Forms page recorded
 * beside it, else the applicant's country of residence.
 */
function applicantPhoneRow(
  p: Profile,
): { type: string; phone: PlacedPhone } | undefined {
  const phone = placePhone(applicantPhone(p), {
    country: residenceCountry(p),
    countryCode: pickText(p, 'telephone_country_code', 'phone_country_code'),
  });
  const type = applicantPhoneType(p);
  return phone && type ? { type, phone } : undefined;
}

/** Rows past the applicant's main number: the same live dialog, two more. */
const MAX_EXTRA_PHONES = 2;

/** A type word in free text; unlike phoneTypeOption, no word is no type. */
const PHONE_TYPE_WORD = /\b(cell|mobile|home|residen\w*|landline|work|office|business|other)\b/i;

interface ExtraPhone {
  /** What the applicant wrote, for the note. */
  raw: string;
  type?: string;
  phone?: PlacedPhone;
}

/**
 * The applicant's other telephone numbers (matrix C row 62), each placed as
 * the main one is. The main number again is not another row.
 */
function extraPhones(p: Profile): ExtraPhone[] {
  const v =
    p.other_phone_numbers ??
    p.additional_phone_numbers ??
    p.additional_phones ??
    p.alternate_phone_numbers ??
    p.alternate_phone;
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const main = applicantPhoneRow(p)?.phone;
  const sameDigits = (a?: PlacedPhone, b?: PlacedPhone) =>
    !!a && !!b && a.number === b.number && a.countryCode === b.countryCode;
  const out: ExtraPhone[] = [];
  for (const x of list) {
    let raw: string | undefined;
    let typeText: string | undefined;
    let code: string | undefined;
    if (typeof x === 'string' || typeof x === 'number') {
      raw = String(x).trim();
      typeText = PHONE_TYPE_WORD.exec(raw)?.[1];
    } else if (x && typeof x === 'object' && !Array.isArray(x)) {
      const o = x as Profile;
      raw = pickText(o, 'number', 'phone_number', 'phone', 'telephone');
      typeText = pickText(o, 'type', 'phone_type', 'telephone_type');
      code = pickText(o, 'country_code', 'telephone_country_code');
    }
    if (!raw || /^(none|no|n\/a)$/i.test(raw)) continue;
    // A type word written beside the number ("home: +92 …") is not digits.
    const numberText = raw.replace(PHONE_TYPE_WORD, ' ').replace(/^[\s:,-]+/, '');
    const phone = placePhone(numberText, {
      country: residenceCountry(p),
      countryCode: code,
    });
    if (sameDigits(phone, main)) continue;
    out.push({ raw, type: phoneTypeOption(typeText), phone });
  }
  return out;
}

/** An extra phone the assistant writes as row n (2, 3), or undefined. */
function extraPhoneRow(
  p: Profile,
  n: number,
): { type: string; phone: PlacedPhone } | undefined {
  if (!applicantPhoneRow(p)) return undefined;
  const e = extraPhones(p)[n - 2];
  return e?.type && e.phone ? { type: e.type, phone: e.phone } : undefined;
}

/**
 * A phone row's dialog: type, location, code, number and extension (all
 * recorded live; `#telExt_telNumContactInfo` 2026-10-31).
 */
function phoneRow(
  n: number,
  row: (p: Profile) => { type: string; phone: PlacedPhone } | undefined,
  extension: (p: Profile) => string | undefined = (p) =>
    row(p)?.phone.extension,
): FillFieldMapping[] {
  const k = n === 1 ? 'ircc_phone' : `ircc_phone_${n}`;
  const lead = n === 1 ? 'Telephone' : `Telephone ${n}`;
  return dialogRow(
    TELEPHONE,
    `${k}_row`,
    '#contactInfoTel_add_button',
    DIALOG_SAVE,
    n === 1 ? 'telephone number' : `telephone number ${n}`,
    'addresses',
    (p) => {
      const r = row(p);
      return r ? `${r.type} ${phoneSummary(r.phone)}` : undefined;
    },
    [
      radio(
        TELEPHONE,
        `${k}_type`,
        'telType_telNumContactInfo',
        `${lead} type`,
        'addresses',
        { Residence: '01', Cellular: '02', Other: '05' },
        (p) => row(p)?.type,
      ),
      ...telephone(
        TELEPHONE,
        { location: `${k}_location`, number: `${k}_number` },
        'telNumContactInfo',
        {
          location: `${lead} location`,
          code: `${lead} country code`,
          number: `${lead} number`,
        },
        (p) => row(p)?.phone,
      ),
      // The extension kept apart from the number (splitPhoneExtension).
      text(
        TELEPHONE,
        `${k}_extension`,
        '#telExt_telNumContactInfo',
        `${lead} extension`,
        'addresses',
        (p) => (row(p) ? extension(p) || undefined : undefined),
      ),
    ],
  );
}

/**
 * The extension of the applicant's number: written after it ("ext 12") or
 * recorded apart (matrix C row 61). Written to `#telExt_telNumContactInfo`.
 */
const applicantPhoneExtension = (p: Profile) =>
  pickText(p, 'phone_extension', 'telephone_extension', 'phone_ext')?.replace(
    /\D/g,
    '',
  ) || applicantPhoneRow(p)?.phone.extension;

// ── the mapping ─────────────────────────────────────────────────────────────
const contact = contactAddress;
/**
 * The mailing address as one street line — for every country but Canada, the
 * U.S. and Mexico, which IRCC asks in its manual-entry form instead.
 */
const streetLineMailing = (p: Profile) => {
  const a = contact(p)?.address;
  return a?.country && MANUAL_ENTRY_COUNTRIES.includes(a.country)
    ? undefined
    : a;
};
const homeForWork = (p: Profile) => residentialAddress(p);

/**
 * The tr-rt boxes that take the applicant's own words: every details
 * textarea (refusal, overstay, crime, security, funds, service, purpose) and
 * the free-text inputs (employer, school, place stationed, a parent's
 * occupation, an inviting organization, city of birth). Names, e-mails,
 * document numbers, phone numbers and address parts are not among them.
 */
const IRCC_FREE_TEXT =
  /_txtArea$|^#(nameEmployerActivity|nameSchoolEdu|locationStationed|parentOccupation|nameOfOrgInviter(Two)?|cityBirth)_input$/;

/**
 * IRCC refuses any character outside its GenericEnglishFrench pattern (live
 * 2026-10-30: "B1/B2" in the refusal details — "Only characters from the
 * Roman script/alphabet can be entered on this field"). Every free-text box
 * without a transform of its own writes through irccRomanText.
 */
function withRomanText(mapping: FillFieldMapping[]): FillFieldMapping[] {
  return mapping.map((f) =>
    f.action === 'fill' && !f.op && !f.transform && IRCC_FREE_TEXT.test(f.selector)
      ? { ...f, transform: 'ircc_text' }
      : f,
  );
}

/** The earlier-residence dialog rows (see earlierResidenceRow). */
function earlierResidenceRows(): FillFieldMapping[] {
  const out: FillFieldMapping[] = [];
  for (let n = 1; n <= MAX_EARLIER_RESIDENCES; n++) {
    const key = `ircc_earlier_residence_${n}`;
    const f = (p: Profile) => earlierResidenceAt(p, n);
    out.push(
      ...dialogRow(
        CONTACT,
        `${key}_row`,
        '#otherCountriesResidences_add_button',
        '#countryOfResidence_save_button',
        `earlier country of residence ${n}`,
        'addresses',
        (p) => {
          const r = f(p);
          return r
            ? `${displayCountry(r.country)} — ${r.status} ${r.from} to ${r.to}`
            : undefined;
        },
        [
          country(
            CONTACT,
            `${key}_country`,
            '#countryOfResidence_select',
            `Earlier residence ${n} — country`,
            'addresses',
            (p) => f(p)?.country,
          ),
          optionText(
            CONTACT,
            `${key}_status`,
            '#statusResidence_select',
            `Earlier residence ${n} — status`,
            'addresses',
            (p) => f(p)?.status,
          ),
          text(
            CONTACT,
            `${key}_status_detail`,
            '#statusResidenceDetail_input',
            `Earlier residence ${n} — status details`,
            'addresses',
            (p) => f(p)?.detail,
            {
              reveal: true,
              parent: `${key}_status`,
              parentValue: 'Other',
              maxLength: RESIDENCE_DETAIL_MAX,
              transform: 'ircc_text',
            },
          ),
          ...dateSelects(
            CONTACT,
            `${key}_from`,
            'datesFromResidence',
            `Earlier residence ${n} — from`,
            'dates',
            { derive: (p) => f(p)?.from },
          ),
          ...dateSelects(
            CONTACT,
            `${key}_to`,
            'datesToResidence',
            `Earlier residence ${n} — to`,
            'dates',
            { derive: (p) => f(p)?.to },
          ),
        ],
      ),
    );
  }
  return out;
}

export const IRCC_MAPPING: FillFieldMapping[] = forChildren(withRomanText([
  // ── Group application (live 2026-10-18, before Purpose) ──────────────────
  // The question's own key is read first (a radio is always derived, so a
  // Forms or consultant "Yes" must be read here or it would be overwritten).
  // A group or family application leaves the question to the applicant: the
  // group's type and name are theirs to give. When nothing is said, "No" —
  // the default, not a guess: a VisaAI application is one applicant.
  yesNo(
    GROUP,
    'ircc_group_application',
    'hasGroup',
    'Applying for more than one person at the same time',
    'travel_history',
    (p) => (isGroupApplication(p) ? undefined : 'No'),
  ),

  // ── Purpose ───────────────────────────────────────────────────────────────
  // A new draft shows only "I want to apply for" (live 2026-10-18); the visa
  // purpose, description and dates appear once it is answered.
  radio(
    PURPOSE,
    'ircc_applying_for',
    'applyingFor',
    'What you are applying for',
    'travel_history',
    { 'Visitor visa': '464' },
    (p) => (isTransit(p) ? undefined : 'Visitor visa'),
  ),
  radio(
    PURPOSE,
    'ircc_visa_purpose',
    'visaPurpose',
    'Why you need a visa',
    'travel_history',
    VISA_PURPOSE_CODES,
    visaPurposeOption,
    { reveal: true, parent: 'ircc_applying_for' },
  ),
  {
    page: PURPOSE,
    profileKey: 'purpose_of_visit',
    selector: '#visitDetails_txtArea',
    action: 'fill',
    label: 'Purpose of visit',
    category: 'travel_history',
    reveal: true,
    // Shown once "I want to apply for" is answered; a transit applicant
    // answers it themselves, so nothing here is waited for.
    parent: 'ircc_applying_for',
  },
  ...dateSelects(
    PURPOSE,
    'planned_entry_date',
    'dateComingToCanada',
    'Date entering Canada',
    'dates',
    { reveal: true, parent: 'ircc_applying_for' },
  ),
  ...dateSelects(
    PURPOSE,
    'planned_departure_date',
    'dateComingToCanadaTo',
    'Date leaving Canada',
    'dates',
    { reveal: true, parent: 'ircc_applying_for' },
  ),

  // ── Representative ────────────────────────────────────────────────────────
  // Details are silent in coverage: what the assistant cannot enter here is
  // listed by the notes in leftForApplicant (relationship, paid, address).
  yesNo(
    REPRESENTATIVE,
    'uses_representative',
    'hasRepresentative',
    'Applying on behalf of someone else (representative)',
    'addresses',
    usesRepresentative,
  ),
  optionText(
    REPRESENTATIVE,
    'ircc_rep_relationship',
    '#unpaidType_select',
    'Representative — relationship to the applicant',
    'addresses',
    representativeRelationship,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_family_name',
    '#lastName_input',
    'Representative — family name',
    'addresses',
    (p) => representativeNames(p).family,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_given_name',
    '#firstName_input',
    'Representative — given name',
    'addresses',
    (p) => representativeNames(p).given,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),
  radio(
    REPRESENTATIVE,
    'ircc_rep_phone_type',
    'telType_phoneNumberRep',
    'Representative — telephone type',
    'addresses',
    { Residence: '01', Cellular: '02', Other: '05' },
    representativePhoneType,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),
  ...telephone(
    REPRESENTATIVE,
    { location: 'ircc_rep_phone_location', number: 'ircc_rep_phone' },
    'phoneNumberRep',
    {
      location: 'Representative — telephone location',
      code: 'Representative — telephone country code',
      number: 'Representative — telephone number',
    },
    representativePhone,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),
  country(
    REPRESENTATIVE,
    'ircc_rep_address_country',
    '#country_representativeAddress',
    'Representative — address country',
    'addresses',
    (p) => representativeAddress(p)?.country,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),
  check(
    REPRESENTATIVE,
    'ircc_rep_manual_address',
    '#manualEntryaddress_representativeAddress-input',
    'Representative — enter the address manually',
    'addresses',
    (p) => (representativeAddress(p) ? 'Yes' : undefined),
    { reveal: true, parent: 'ircc_rep_address_country', silent: true },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_street_number',
    '#streetNum_representativeAddress',
    'Representative — street number',
    'addresses',
    (p) => representativeAddress(p)?.streetNumber,
    { reveal: true, parent: 'ircc_rep_manual_address', silent: true },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_street',
    '#street_representativeAddress',
    'Representative — street',
    'addresses',
    (p) => representativeAddress(p)?.streetName,
    { reveal: true, parent: 'ircc_rep_manual_address', silent: true },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_apartment',
    '#apartmentNumber_representativeAddress',
    'Representative — apartment / unit',
    'addresses',
    (p) => representativeAddress(p)?.apartment,
    { reveal: true, parent: 'ircc_rep_manual_address', silent: true },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_city',
    '#city_representativeAddress',
    'Representative — city',
    'addresses',
    (p) => representativeAddress(p)?.city,
    { reveal: true, parent: 'ircc_rep_manual_address', silent: true },
  ),
  optionText(
    REPRESENTATIVE,
    'ircc_rep_province',
    '#province_representativeAddress',
    'Representative — province',
    'addresses',
    (p) => representativeAddress(p)?.province,
    { reveal: true, parent: 'ircc_rep_manual_address', silent: true },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_postal_code',
    '#postalcode_representativeAddress',
    'Representative — postal code',
    'addresses',
    (p) => representativeAddress(p)?.postalCode,
    { reveal: true, parent: 'ircc_rep_manual_address', silent: true },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_email',
    '#emailContactInfo_input',
    'Representative — email',
    'addresses',
    representativeEmail,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),
  text(
    REPRESENTATIVE,
    'ircc_rep_email_confirm',
    '#emailContactInfoRepeat_input',
    'Representative — email (confirm)',
    'addresses',
    representativeEmail,
    {
      reveal: true,
      parent: 'uses_representative',
      parentValue: 'Yes',
      silent: true,
    },
  ),

  // ── Personal details: applicant identity ──────────────────────────────────
  text(BIO, 'family_name', '#lastName_input', 'Family name', 'passport'),
  // Optional on IRCC: an applicant with one name has only a family name, and
  // the blank given name is not listed as missing (leftForApplicant).
  text(
    BIO,
    'given_name',
    '#firstName_input',
    'Given name',
    'passport',
    undefined,
    { silent: true },
  ),
  // DOB selects carry no prefix on this page (#year_sltDateYear …).
  {
    page: BIO,
    profileKey: 'date_of_birth',
    selector: '#year_sltDateYear',
    action: 'select',
    transform: 'date_year',
    label: 'Date of birth — year',
    category: 'passport',
  },
  {
    page: BIO,
    profileKey: 'date_of_birth',
    selector: '#month_sltDateMonth',
    action: 'select',
    transform: 'date_month',
    label: 'Date of birth — month',
    category: 'passport',
  },
  {
    page: BIO,
    profileKey: 'date_of_birth',
    selector: '#day_sltDateDay',
    action: 'select',
    transform: 'date_day',
    label: 'Date of birth — day',
    category: 'passport',
  },

  radio(
    BIO,
    'sex',
    'gender',
    'Sex',
    'passport',
    // Recorded live 2026-10-16: -02 Male, -01 Female, -03 Unknown, -04 Another gender.
    { Male: '02', Female: '01', Unknown: '03', 'Another gender': '04' },
    sexOption,
  ),

  // ── Personal details: travel document ─────────────────────────────────────
  // A new draft asks what document and what kind of passport first, and
  // shows the passport fields only after both (live 2026-10-18: "This page
  // only partly matches" on a new draft). A draft answered earlier already
  // shows them; the waits below then find them at once.
  radio(
    TRAVEL_DOC,
    'travel_document_type',
    'travelDocument',
    'Type of travel document',
    'passport',
    { Passport: '249', Other: '250' },
    (p) => {
      if (otherDocumentOption(p)) return 'Other';
      return pickText(p, 'passport_number') && !notPassportDocument(p)
        ? 'Passport'
        : undefined;
    },
  ),
  // "Other" (250) reveals the kind of document and who issued it (live
  // 2026-10-31). Written only for a kind that maps clearly; the number and
  // dates IRCC then asks were not recorded, so they stay in the note.
  radio(
    TRAVEL_DOC,
    'ircc_other_document_type',
    'otherDocumentType',
    'Kind of travel document',
    'passport',
    OTHER_DOCUMENT_CODES,
    otherDocumentOption,
    { reveal: true, parent: 'travel_document_type', parentValue: 'Other' },
  ),
  country(
    TRAVEL_DOC,
    'ircc_travel_document_issued_by',
    '#travelDocumentIssuedBy_select',
    'Travel document — issued by',
    'passport',
    otherDocumentIssuer,
    {
      reveal: true,
      parent: 'travel_document_type',
      parentValue: 'Other',
      silent: true,
    },
  ),
  radio(
    TRAVEL_DOC,
    'passport_type',
    'passportType',
    'Kind of passport',
    'passport',
    { Regular: '099' },
    regularPassport,
    { reveal: true, parent: 'travel_document_type', parentValue: 'Passport' },
  ),
  country(
    TRAVEL_DOC,
    'nationality',
    '#codePassport_select',
    'Passport country code',
    'passport',
    nationality,
    PASSPORT_SHOWN,
  ),
  country(
    TRAVEL_DOC,
    'nationality',
    '#nationalityPassport_select',
    'Nationality on passport',
    'passport',
    nationality,
    PASSPORT_SHOWN,
  ),
  text(
    TRAVEL_DOC,
    'passport_number',
    '#travelDocNum_input',
    'Passport number',
    'passport',
    undefined,
    PASSPORT_SHOWN,
  ),
  text(
    TRAVEL_DOC,
    'passport_number',
    '#travelDocNumConfirmation_input',
    'Passport number (confirm)',
    'passport',
    undefined,
    PASSPORT_SHOWN,
  ),
  ...dateSelects(
    TRAVEL_DOC,
    'passport_issue_date',
    'dateIssuePassport',
    'Passport issue date',
    'passport',
    PASSPORT_SHOWN,
  ),
  ...dateSelects(
    TRAVEL_DOC,
    'passport_expiry_date',
    'dateExpiryPassport',
    'Passport expiry date',
    'passport',
    PASSPORT_SHOWN,
  ),
  // Shown only for a passport from Taiwan, Israel or Romania, each required
  // (tr-rt bundle 2026-10-19). Silent: leftForApplicant names the one an
  // applicant with that passport still has to answer.
  yesNo(
    TRAVEL_DOC,
    'taiwan_passport_with_personal_id',
    'hasTaiwanPassport',
    'Taiwan passport issued by the Ministry of Foreign Affairs with a personal identification number',
    'passport',
    (p) => yesOnlyWithRow(taiwanPassport(p), !!taiwanPersonalId(p)),
    // Shown by #codePassport_select, written only for a regular passport.
    { reveal: true, silent: true, parent: 'nationality' },
  ),
  text(
    TRAVEL_DOC,
    'ircc_taiwan_personal_id_number',
    '#taiwanNumber_input',
    'Taiwan personal identification number',
    'passport',
    taiwanPersonalId,
    {
      reveal: true,
      parent: 'taiwan_passport_with_personal_id',
      parentValue: 'Yes',
    },
  ),
  yesNo(
    TRAVEL_DOC,
    'israeli_national_passport',
    'hasIsraeliPassport',
    'National Israeli passport',
    'passport',
    passportOf('ISR', 'israeli_national_passport'),
    // Shown by #codePassport_select, written only for a regular passport.
    { reveal: true, silent: true, parent: 'nationality' },
  ),
  yesNo(
    TRAVEL_DOC,
    'romanian_electronic_passport',
    'hasRomaniaPassport',
    'Romanian electronic passport',
    'passport',
    passportOf('ROU', 'romanian_electronic_passport'),
    // Shown by #codePassport_select, written only for a regular passport.
    { reveal: true, silent: true, parent: 'nationality' },
  ),
  // Asked on the same page of a new draft. Only an explicit "No" is written.
  // Live 2026-10-31: "Yes" reveals no number or expiry field and, flying in,
  // routes to /bio-data-eta ("As a lawful permanent resident of the U.S., you
  // don't need an eTA or any other document"): a Green Card holder needs no
  // visa, so "Yes" is left with a note (leftForApplicant), never written.
  yesNo(
    TRAVEL_DOC,
    'us_green_card',
    'hasGreenCard',
    'Lawful permanent resident of the United States (Green Card)',
    'passport',
    (p) => (greenCard(p) === 'No' ? 'No' : undefined),
  ),
  yesNo(
    TRAVEL_DOC,
    'held_canadian_visa_10_years',
    'travelledToCanadaInPastTen',
    'Held a Canadian visitor visa in the past 10 years',
    'travel_history',
    (p) =>
      declared(
        p,
        'held_canadian_visa_10_years',
        'held_canadian_visitor_visa',
        'canadian_visa_last_10y',
        'held_canadian_visa_last_10_years',
        'had_canadian_visa_10_years',
      ),
  ),
  yesNo(
    TRAVEL_DOC,
    'holds_us_visa',
    'holdUSVisa',
    'Holds a valid U.S. nonimmigrant visa',
    'travel_history',
    (p) => holdsUsVisa(p),
  ),
  // "Yes" reveals the visa's number and expiry date (live 2026-10-18 and
  // 2026-10-19: #docNumberVisa_input, dateVisaExpiry*), then whether it is in
  // another passport (passportOtherThanUS radio, below). Same keys as the
  // eTA's U.S. visa questions.
  text(
    TRAVEL_DOC,
    'us_nonimmigrant_visa_number',
    '#docNumberVisa_input',
    'U.S. visa number',
    'travel_history',
    (p) =>
      pickText(
        p,
        'us_nonimmigrant_visa_number',
        'us_visa_number',
        'us_nonimmigrant_visa_no',
      ),
    {
      transform: 'strip_dashes',
      reveal: true,
      parent: 'holds_us_visa',
      parentValue: 'Yes',
    },
  ),
  ...dateSelects(
    TRAVEL_DOC,
    'us_nonimmigrant_visa_expiry_date',
    'dateVisaExpiry',
    'U.S. visa expiry date',
    'travel_history',
    {
      derive: (p) =>
        pickDate(
          p,
          'us_nonimmigrant_visa_expiry_date',
          'us_visa_expiry_date',
          'us_visa_expiry',
        ),
      reveal: true,
      parent: 'holds_us_visa',
      parentValue: 'Yes',
    },
  ),
  // Required (live 2026-10-19): "Are you using a different passport for this
  // application than the one you used to get your U.S. nonimmigrant visa?"
  // Yes reveals that other passport — country (#codePassportUS_select, the
  // same list as #codePassport_select), number twice, issue and expiry
  // dates, all required — so Yes is written only with all four known.
  yesNo(
    TRAVEL_DOC,
    'us_visa_in_other_passport',
    'passportOtherThanUS',
    'U.S. visa is in a different passport',
    'travel_history',
    (p) => yesOnlyWithRow(usVisaInOtherPassport(p), !!usVisaPassport(p)),
    { reveal: true, parent: 'holds_us_visa', parentValue: 'Yes', silent: true },
  ),
  country(
    TRAVEL_DOC,
    'us_visa_passport_country',
    '#codePassportUS_select',
    'Passport with the U.S. visa — country',
    'travel_history',
    (p) => usVisaPassport(p)?.country,
    US_VISA_PASSPORT_SHOWN,
  ),
  text(
    TRAVEL_DOC,
    'us_visa_passport_number',
    '#travelDocNumUS_input',
    'Passport with the U.S. visa — number',
    'travel_history',
    (p) => usVisaPassport(p)?.number,
    US_VISA_PASSPORT_SHOWN,
  ),
  text(
    TRAVEL_DOC,
    'us_visa_passport_number',
    '#travelDocNumConfirmationUS_input',
    'Passport with the U.S. visa — number (confirm)',
    'travel_history',
    (p) => usVisaPassport(p)?.number,
    US_VISA_PASSPORT_SHOWN,
  ),
  ...dateSelects(
    TRAVEL_DOC,
    'us_visa_passport_issue_date',
    'dateIssuePassportUS',
    'Passport with the U.S. visa — issue date',
    'travel_history',
    { ...US_VISA_PASSPORT_SHOWN, derive: (p) => usVisaPassport(p)?.issued },
  ),
  ...dateSelects(
    TRAVEL_DOC,
    'us_visa_passport_expiry_date',
    'dateExpiryPassportUS',
    'Passport with the U.S. visa — expiry date',
    'travel_history',
    { ...US_VISA_PASSPORT_SHOWN, derive: (p) => usVisaPassport(p)?.expires },
  ),
  yesNo(
    TRAVEL_DOC,
    'travelling_by_air',
    'travellingByAir',
    'Travelling to Canada by air',
    'travel_history',
    travellingByAir,
  ),

  // ── Citizenship and places lived ──────────────────────────────────────────
  country(
    NATIONALITY,
    'birth_country',
    '#countryBirth_select',
    'Country of birth',
    'passport',
    birthCountry,
  ),
  text(
    NATIONALITY,
    'birth_city',
    '#cityBirth_input',
    'City of birth',
    'passport',
    birthCity,
  ),
  yesNo(
    NATIONALITY,
    'multiple_citizenship',
    'citizenshipOfCountryOrTerritory',
    'Citizen of more than one country',
    'passport',
    // "Yes" replaces the select below with a table that must list every
    // citizenship (citizenshipRows): written only when every row is complete.
    (p) => yesOnlyWithRow(multipleCitizenship(p), !!citizenshipRowsComplete(p)),
  ),
  // Shown once the question above is answered; with "No" it is the one
  // citizenship. With "Yes" it disappears for the table (live 2026-10-19).
  country(
    NATIONALITY,
    'citizenship_country',
    '#countryOfCitizenship_select',
    'Country of citizenship',
    'passport',
    nationality,
    {
      reveal: true,
      parent: 'multiple_citizenship',
      parentValue: 'No',
    },
  ),
  check(
    NATIONALITY,
    'citizen_from_birth',
    '#citizenFromBirth_chk-input',
    'Citizen since birth',
    'passport',
    (p) =>
      declared(
        p,
        'citizen_from_birth',
        'citizenship_by_birth',
        'citizen_since_birth',
      ) === 'Yes'
        ? 'Yes'
        : undefined,
    { reveal: true, parent: 'citizenship_country' },
  ),
  // Ticking "since birth" fills these with the date of birth (live
  // 2026-10-15); unticked, they are cleared and required (live 2026-10-19),
  // so a citizen by naturalisation gives the date they became one.
  // Silent: a citizen since birth has nothing to add, and a missing date is
  // listed by the note in leftForApplicant.
  ...dateSelects(
    NATIONALITY,
    'ircc_citizenship_date',
    'citizenFrom',
    'Date you became a citizen',
    'passport',
    {
      derive: (p) =>
        citizenFromBirth(p) === 'No' ? citizenshipDate(p) : undefined,
      reveal: true,
      parent: 'citizenship_country',
      silent: true,
    },
  ),
  ...citizenshipRows(),

  // ── National identity document ────────────────────────────────────────────
  yesNo(
    NATIONAL_ID,
    'has_national_id',
    'hasNationality',
    'Has a national identity document',
    'passport',
    hasNationalId,
  ),
  text(
    NATIONAL_ID,
    'national_id_number',
    '#docNumberNationalities_input',
    'National identity document number',
    'passport',
    nationalIdNumber,
    {
      transform: 'strip_dashes',
      reveal: true,
      parent: 'has_national_id',
      parentValue: 'Yes',
    },
  ),
  text(
    NATIONAL_ID,
    'national_id_number',
    '#docNumberConfirmationNationalities_input',
    'National identity document number (confirm)',
    'passport',
    nationalIdNumber,
    {
      transform: 'strip_dashes',
      reveal: true,
      parent: 'has_national_id',
      parentValue: 'Yes',
    },
  ),
  ...dateSelects(
    NATIONAL_ID,
    'national_id_issue_date',
    'dateIssueNationalities',
    'National identity document issue date',
    'passport',
    {
      derive: nationalIdIssueDate,
      reveal: true,
      parent: 'has_national_id',
      parentValue: 'Yes',
    },
  ),
  country(
    NATIONAL_ID,
    'national_id_country',
    '#countryNationalities_select',
    'Country of issue',
    'passport',
    (p) =>
      pickCountry(
        p,
        'national_id_country',
        'national_id_issuing_country',
        'national_identity_card_country',
        'national_identity_document_country',
        'national_id_card_country',
        'id_issuing_country',
      ) ?? nationality(p),
    { reveal: true, parent: 'has_national_id', parentValue: 'Yes' },
  ),

  // ── Other names ───────────────────────────────────────────────────────────
  yesNo(
    OTHER_NAMES,
    'has_other_names',
    'hasOtherNames',
    'Has used other names',
    'passport',
    (p) => yesOnlyWithRow(hasOtherNames(p), anyOtherNameRow(p)),
  ),
  ...otherNameRows(),

  // ── Contact information ───────────────────────────────────────────────────
  country(
    CONTACT,
    'mailing_country',
    '#country_contactAddressGroup',
    'Mailing address — country',
    'addresses',
    (p) => contact(p)?.address.country,
  ),
  // Canada, the U.S. and Mexico take the manual-entry form (bundle
  // 2026-10-19); the street line below is any other country's. All silent:
  // the country row and the notes in leftForApplicant say what is missing.
  // (A consultant's value saved under mailing_street/_city/_postal_code
  // still wins over the derivation, as for every text field.)
  ...manualEntryFields(
    CONTACT,
    'ircc_mailing',
    'contactAddressGroup',
    'Mailing address',
    (p) => contact(p)?.address,
    { reveal: true },
  ),
  text(
    CONTACT,
    'mailing_street',
    '#streetAddress_contactAddressGroup',
    'Mailing address — street',
    'addresses',
    (p) => streetLineMailing(p)?.street,
    { reveal: true, silent: true },
  ),
  text(
    CONTACT,
    'mailing_city',
    '#city_contactAddressGroup',
    'Mailing address — city',
    'addresses',
    (p) => streetLineMailing(p)?.city,
    { reveal: true, silent: true },
  ),
  text(
    CONTACT,
    'mailing_postal_code',
    '#postalcodeother_contactAddressGroup',
    'Mailing address — postal code',
    'addresses',
    (p) => streetLineMailing(p)?.postalCode,
    { reveal: true, silent: true },
  ),
  yesNo(
    CONTACT,
    'mailing_same_as_residential',
    'hasDiffAddressContactInfo',
    'Mailing address is the same as the residential address',
    'addresses',
    (p) => contact(p)?.same,
  ),
  // "No" reveals the home address (live 2026-10-18): the manual-entry form
  // for Canada, the U.S. and Mexico, one street line elsewhere.
  ...addressFields(
    CONTACT,
    'residential_address',
    'otherResidentialAddressContactInfo',
    'Residential address',
    (p) => (contact(p)?.same === 'No' ? residentialAddress(p) : undefined),
    { reveal: true, parent: 'mailing_same_as_residential', parentValue: 'No' },
  ),
  ...dialogRow(
    CONTACT,
    'ircc_residence_row',
    '#otherCountriesResidences_add_button',
    '#countryOfResidence_save_button',
    'current country of residence',
    'addresses',
    (p) => {
      const r = residence(p);
      return r
        ? `${displayCountry(r.country)} — ${r.status} since ${r.since}${r.until ? ` until ${r.until}` : ''}`
        : undefined;
    },
    [
      country(
        CONTACT,
        'ircc_residence_country',
        '#countryOfResidence_select',
        'Country of residence',
        'addresses',
        (p) => residence(p)?.country,
      ),
      optionText(
        CONTACT,
        'ircc_residence_status',
        '#statusResidence_select',
        'Status in that country',
        'addresses',
        (p) => residence(p)?.status,
      ),
      // "Other" opens a required details box (live 2026-10-31).
      text(
        CONTACT,
        'ircc_residence_status_detail',
        '#statusResidenceDetail_input',
        'Status in that country — details',
        'addresses',
        (p) => residence(p)?.detail,
        {
          reveal: true,
          parent: 'ircc_residence_status',
          parentValue: 'Other',
          maxLength: RESIDENCE_DETAIL_MAX,
          transform: 'ircc_text',
        },
      ),
      ...dateSelects(
        CONTACT,
        'ircc_residence_since',
        'datesFromResidence',
        'Living there since',
        'dates',
        { derive: (p) => residence(p)?.since },
      ),
      check(
        CONTACT,
        'ircc_residence_current',
        '#ongoing_chk-input',
        'This is where I currently live',
        'addresses',
        (p) => (residence(p) ? 'Yes' : undefined),
      ),
      // The To date stays visible while ongoing (SAVED live 2026-10-31:
      // Worker, ongoing, To 2027-04-30); written for every status but
      // Citizen / PR (residence(p).until).
      ...dateSelects(
        CONTACT,
        'ircc_residence_until',
        'datesToResidence',
        'Status valid until',
        'dates',
        { derive: (p) => residence(p)?.until },
      ),
    ],
  ),
  // Earlier residences (past 5 years), each a past row: "ongoing" left
  // unticked, From and To (SAVED live 2026-10-31: Saudi Arabia, Other
  // "Dependent visa", 2015-01-01 to 2018-12-31).
  ...earlierResidenceRows(),

  // ── Children 16 years old and younger (live 2026-10-31) ─────────────────
  // Only the child's explicit answers. Live 2026-10-31 (family visit 686):
  // "No" then Alone / With someone else goes straight to /inviter-info, with
  // no custodian page, so no note claims one.
  {
    ...yesNo(
      MINORS_GUARDIAN,
      'minor_travelling_with_guardian',
      'isTravelingGuardian',
      'The child travels to Canada with a parent or legal guardian',
      'travel_history',
      travelsWithGuardian,
    ),
    onlyIf: sixteenOrUnder,
  },
  radio(
    MINORS_GUARDIAN,
    'minor_guardians_travelling',
    'minorsTravellingwithGuardian',
    'Travelling with both parents or legal guardians, or one',
    'travel_history',
    { [GUARDIANS_BOTH]: '530', [GUARDIANS_ONE]: '531' },
    guardiansTravelling,
    {
      reveal: true,
      parent: 'minor_travelling_with_guardian',
      parentValue: 'Yes',
    },
  ),
  radio(
    MINORS_GUARDIAN,
    'minor_travelling_without_guardian',
    'minorsTravellingwithoutGuardian',
    'Travelling alone or with someone else',
    'travel_history',
    { [WITHOUT_ALONE]: '532', [WITHOUT_SOMEONE]: '533' },
    travellingWithout,
    {
      reveal: true,
      parent: 'minor_travelling_with_guardian',
      parentValue: 'No',
    },
  ),

  // ── Biometrics ────────────────────────────────────────────────────────────
  yesNo(
    BIOMETRICS,
    'biometrics_given',
    'hasFingerprintsBiometrics',
    'Gave biometrics in the last 10 years',
    'travel_history',
    biometricsGiven,
  ),
  {
    page: BIOMETRICS,
    profileKey: 'biometrics_reuse',
    selector: '[name="biometricsAgain"]',
    choices: {
      'Give my biometrics again': '#biometricsAgain_radio-button-3004-input',
      'Re-use my valid biometrics': '#biometricsAgain_radio-button-3005-input',
    },
    op: 'radio',
    action: 'fill',
    label: 'Biometrics: re-use or give again',
    category: 'travel_history',
    derive: biometricsReuse,
    reveal: true,
    parent: 'biometrics_given',
    parentValue: 'Yes',
  },

  // ── Invitation (the host in Canada) ───────────────────────────────────────
  text(
    INVITER,
    'inviter_family_name',
    '#firstInviter_lastName_input',
    'Inviter — family name',
    'addresses',
    (p) => inviterName(p).family,
  ),
  text(
    INVITER,
    'inviter_given_name',
    '#firstInviter_firstName_input',
    'Inviter — given name',
    'addresses',
    (p) => inviterName(p).given,
  ),
  optionText(
    INVITER,
    'inviter_relationship',
    '#relationInviter_select',
    'Inviter — relationship to you',
    'addresses',
    inviterRelationship,
  ),
  // Required once the relationship is Organization or Conference (live
  // 2026-10-19, business route: left empty and the page did not save).
  text(
    INVITER,
    'inviter_organization_name',
    '#nameOfOrgInviter_input',
    'Inviter — name of organization or conference',
    'addresses',
    (p) => pickText(inviter(p), 'organization'),
    {
      reveal: true,
      parent: 'inviter_relationship',
      parentValue: INVITER_IS_ORGANIZATION,
    },
  ),
  check(
    INVITER,
    'inviter_manual_address',
    '#manualEntryaddress_inviterAddress-input',
    'Inviter — enter the address manually',
    'addresses',
    (p) => (inviterAddress(p) ? 'Yes' : undefined),
  ),
  text(
    INVITER,
    'inviter_street_number',
    '#streetNum_inviterAddress',
    'Inviter — street number',
    'addresses',
    (p) => inviterAddress(p)?.streetNumber,
    { reveal: true, parent: 'inviter_manual_address' },
  ),
  text(
    INVITER,
    'inviter_street',
    '#street_inviterAddress',
    'Inviter — street',
    'addresses',
    (p) => inviterAddress(p)?.streetName,
    { reveal: true, parent: 'inviter_manual_address' },
  ),
  text(
    INVITER,
    'inviter_apartment',
    '#apartmentNumber_inviterAddress',
    'Inviter — apartment / unit',
    'addresses',
    (p) => inviterAddress(p)?.apartment,
    { reveal: true, parent: 'inviter_manual_address', silent: true },
  ),
  text(
    INVITER,
    'inviter_city',
    '#city_inviterAddress',
    'Inviter — city',
    'addresses',
    (p) => inviterAddress(p)?.city,
    { reveal: true, parent: 'inviter_manual_address' },
  ),
  optionText(
    INVITER,
    'inviter_province',
    '#province_inviterAddress',
    'Inviter — province',
    'addresses',
    (p) => inviterAddress(p)?.province,
    { reveal: true, parent: 'inviter_manual_address' },
  ),
  text(
    INVITER,
    'inviter_postal_code',
    '#postalcode_inviterAddress',
    'Inviter — postal code',
    'addresses',
    (p) => inviterAddress(p)?.postalCode,
    { reveal: true, parent: 'inviter_manual_address' },
  ),
  radio(
    INVITER,
    'inviter_phone_type',
    'telType_phoneNumberInviter',
    'Inviter — telephone type',
    'addresses',
    { Residence: '01', Cellular: '02', Other: '05' },
    inviterPhoneType,
    { reveal: true },
  ),
  ...telephone(
    INVITER,
    { location: 'inviter_phone_location', number: 'inviter_phone' },
    'phoneNumberInviter',
    {
      location: 'Inviter — telephone location',
      code: 'Inviter — telephone country code',
      number: 'Inviter — telephone number',
    },
    inviterPhone,
    { reveal: true },
  ),
  text(
    INVITER,
    'inviter_email',
    '#emailAddressInviter_input',
    'Inviter — email',
    'addresses',
    (p) => pickText(inviter(p), 'email'),
    { reveal: true },
  ),
  yesNo(
    INVITER,
    'has_second_inviter',
    'hasSecondInviter',
    'A second person is inviting you',
    'addresses',
    (p) => declared(p, 'has_second_inviter', 'second_inviter'),
    { reveal: true },
  ),
  ...secondInviterFields(),

  // ── Finances ──────────────────────────────────────────────────────────────
  text(
    FINANCES,
    'available_trip_funds_cad',
    '#moneyDetails_input',
    'Money available for the trip (CAD)',
    'employment',
    tripFundsCad,
    { transform: 'whole_number' },
  ),
  yesNo(
    FINANCES,
    'funds_shared',
    'areFundsShared',
    'Someone else is giving you money for the trip',
    'employment',
    fundsShared,
  ),
  text(
    FINANCES,
    'funds_details',
    '#detailsFunds_txtArea',
    'Who is giving you money',
    'employment',
    fundsDetails,
    {
      reveal: true,
      parent: 'funds_shared',
      parentValue: 'Yes',
    },
  ),

  // ── Education and employment ──────────────────────────────────────────────
  yesNo(
    ACTIVITIES,
    'has_post_secondary_education',
    'hasPostSecondaryEducation',
    'Has post-secondary education',
    'employment',
    // "Yes" needs at least one education row (educationRows, live
    // 2026-10-19): written only when the assistant adds a complete one.
    (p) =>
      yesOnlyWithRow(
        declared(p, 'has_post_secondary_education', 'post_secondary_education'),
        anyEducationRow(p),
      ),
  ),
  ...educationRows(),
  yesNo(
    ACTIVITIES,
    'military_service',
    'servedArmy',
    'Served in a military, militia or civil defence unit',
    'employment',
    (p) => militaryService(p),
    { declaration: true },
  ),
  // A declaration: written as answered. Its table needs at least one entry;
  // an incomplete period is listed for the applicant instead.
  ...serviceRows(),
  ...dialogRow(
    ACTIVITIES,
    'ircc_work_retired_row',
    '#empHistoryTable_add_button',
    DIALOG_SAVE,
    'retirement to work history',
    'employment',
    retiredRow,
    [
      ...dateSelects(
        ACTIVITIES,
        'ircc_work_retired_from',
        'fromWork',
        'Retired since',
        'dates',
        { derive: retirementDate },
        false,
      ),
      check(
        ACTIVITIES,
        'ircc_work_retired_ongoing',
        '#isCurrentEmployer_chk-input',
        'Retirement — ongoing',
        'employment',
        (p) => (retiredRow(p) ? 'Yes' : undefined),
      ),
      optionText(
        ACTIVITIES,
        'ircc_work_retired_activity',
        '#activtyOccupation_select',
        'Activity',
        'employment',
        (p) => (retiredRow(p) ? 'Retired' : undefined),
      ),
      // Canada switches the group to its manual-entry form (review 2026-10-18).
      ...addressFields(
        ACTIVITIES,
        'ircc_work_retired_address',
        'workHistoryAddress',
        'Retirement — address',
        (p) => (retiredRow(p) ? homeForWork(p) : undefined),
      ),
    ],
  ),

  ...dialogRow(
    ACTIVITIES,
    'ircc_work_homemaker_row',
    '#empHistoryTable_add_button',
    DIALOG_SAVE,
    'homemaker period to work history',
    'employment',
    homemakerRow,
    [
      ...dateSelects(
        ACTIVITIES,
        'ircc_work_homemaker_from',
        'fromWork',
        'Homemaker since',
        'dates',
        { derive: homemakerSince },
        false,
      ),
      check(
        ACTIVITIES,
        'ircc_work_homemaker_ongoing',
        '#isCurrentEmployer_chk-input',
        'Homemaker — ongoing',
        'employment',
        (p) => (homemakerRow(p) ? 'Yes' : undefined),
      ),
      // Homemaker hides the job title and employer (live 2026-10-18).
      optionText(
        ACTIVITIES,
        'ircc_work_homemaker_activity',
        '#activtyOccupation_select',
        'Activity',
        'employment',
        (p) => (homemakerRow(p) ? 'Homemaker' : undefined),
      ),
      ...addressFields(
        ACTIVITIES,
        'ircc_work_homemaker_address',
        'workHistoryAddress',
        'Homemaker — address',
        (p) => (homemakerRow(p) ? homeForWork(p) : undefined),
      ),
    ],
  ),

  // Currently without work (matrix B A15): IRCC's 10 years must reach today.
  ...dialogRow(
    ACTIVITIES,
    'ircc_work_unemployed_row',
    '#empHistoryTable_add_button',
    DIALOG_SAVE,
    'period without work to work history',
    'employment',
    unemployedRow,
    [
      ...dateSelects(
        ACTIVITIES,
        'ircc_work_unemployed_from',
        'fromWork',
        'Without work since',
        'dates',
        { derive: (p) => (unemployedRow(p) ? unemployedSince(p) : undefined) },
        false,
      ),
      check(
        ACTIVITIES,
        'ircc_work_unemployed_ongoing',
        '#isCurrentEmployer_chk-input',
        'Without work — ongoing',
        'employment',
        (p) => (unemployedRow(p) ? 'Yes' : undefined),
      ),
      optionText(
        ACTIVITIES,
        'ircc_work_unemployed_activity',
        '#activtyOccupation_select',
        'Activity',
        'employment',
        (p) => (unemployedRow(p) ? 'Unemployed' : undefined),
      ),
      ...addressFields(
        ACTIVITIES,
        'ircc_work_unemployed_address',
        'workHistoryAddress',
        'Without work — address',
        (p) => (unemployedRow(p) ? homeForWork(p) : undefined),
      ),
    ],
  ),

  ...dialogRow(
    ACTIVITIES,
    'ircc_work_current_row',
    '#empHistoryTable_add_button',
    DIALOG_SAVE,
    'current job to work history',
    'employment',
    (p) => {
      const j = currentJob(p).facts;
      return j ? `${j.employer} since ${j.since.slice(0, 7)}` : undefined;
    },
    [
      ...dateSelects(
        ACTIVITIES,
        'ircc_work_current_from',
        'fromWork',
        'Current job — since',
        'dates',
        { derive: (p) => currentJob(p).facts?.since },
        false,
      ),
      check(
        ACTIVITIES,
        'ircc_work_current_ongoing',
        '#isCurrentEmployer_chk-input',
        'Current job — ongoing',
        'employment',
        (p) => (currentJob(p).facts ? 'Yes' : undefined),
      ),
      optionText(
        ACTIVITIES,
        'ircc_work_current_activity',
        '#activtyOccupation_select',
        'Current job — activity',
        'employment',
        (p) => currentJob(p).facts?.activity,
      ),
      optionText(
        ACTIVITIES,
        'ircc_work_current_title',
        '#jobTitleActivity_select',
        'Current job — job title',
        'employment',
        (p) => currentJob(p).facts?.title,
      ),
      text(
        ACTIVITIES,
        'ircc_work_current_employer',
        '#nameEmployerActivity_input',
        'Current job — employer',
        'employment',
        (p) => currentJob(p).facts?.employer,
      ),
      text(
        ACTIVITIES,
        'ircc_work_current_duties',
        '#responsibilityActivity_input',
        'Current job — duties',
        'employment',
        (p) => currentJob(p).facts?.duties,
        { transform: 'plain_words', maxLength: WORK_DUTIES_MAX },
      ),
      ...addressFields(
        ACTIVITIES,
        'ircc_work_current_address',
        'workHistoryAddress',
        'Current job — employer address',
        (p) => currentJob(p).facts?.address,
      ),
    ],
  ),

  ...workRows(),

  // ── Travel history ────────────────────────────────────────────────────────
  yesNo(
    TRAVEL_HISTORY,
    'travelled_last_5_years',
    'traveledToOtherCountries',
    'Travelled to other countries in the past 5 years',
    'travel_history',
    (p) =>
      yesOnlyWithRow(
        declared(p, 'travelled_last_5_years') ??
          noTravel5y(p) ??
          (tripList(p).length ? 'Yes' : undefined),
        anyTripRow(p),
      ),
  ),
  ...tripRows(),

  // ── Travel history (continued): immigration history declarations ──────────
  declaration(
    VALIDITY,
    'immigration_violations',
    'remainedBeyondValidity',
    'Ever stayed beyond your authorized stay, or studied or worked without authorization, in Canada',
    [
      'overstayed_in_canada',
      'remained_beyond_validity',
      'canada_status_violation',
    ],
  ),
  declarationDetails(
    VALIDITY,
    'immigration_violations',
    'remainedBeyondValidityDetails',
    'Overstay or unauthorized work or study — details',
    ['overstay_details', 'overstayed_or_unauthorized_work_study_details'],
  ),

  yesNo(
    VALIDITY,
    'refused_or_ordered_to_leave',
    'refusedVisaInOtherCountry',
    'Ever refused a visa or permit, denied entry, or ordered to leave any country',
    'travel_history',
    refusedOrOrderedToLeave,
    { declaration: true },
  ),
  text(
    VALIDITY,
    'refusal_details',
    '#refusedVisaInOtherCountryDetails_txtArea',
    'Refusal details',
    'travel_history',
    refusalDetails,
    {
      reveal: true,
      parent: 'refused_or_ordered_to_leave',
      parentValue: 'Yes',
      maxLength: 500,
      declaration: true,
    },
  ),

  // ── Criminality ───────────────────────────────────────────────────────────
  declaration(
    CRIME,
    'committed_crime',
    'hasCommittedCrime',
    'Ever committed, been arrested for, charged with or convicted of a criminal offence in any country — committed',
    [
      'committed_criminal_offence',
      'committed_criminal_offense',
      'crime_committed',
    ],
  ),
  declarationDetails(
    CRIME,
    'committed_crime',
    'committedCrimeDetails',
    'Crime committed — details',
    ['criminal_details', 'criminal_conviction_details'],
  ),

  declaration(
    CRIME,
    'ever_arrested',
    'hasBeenArrested',
    'Ever arrested for a criminal offence in any country',
    ['arrested', 'been_arrested'],
  ),
  declarationDetails(
    CRIME,
    'ever_arrested',
    'arrestedDetails',
    'Arrest — details',
    ['arrest_details'],
  ),

  {
    ...declaration(
      CRIME,
      'ever_charged',
      'hasBeenCharged',
      'Ever charged with a criminal offence in any country',
      ['been_charged', 'criminal_charges'],
    ),
    derive: (p) =>
      declared(p, 'ever_charged', 'been_charged', 'criminal_charges') ??
      noChargesOrConvictions(p),
  },
  declarationDetails(
    CRIME,
    'ever_charged',
    'beenChargedDetails',
    'Criminal charge — details',
    ['charge_details', 'criminal_charge_details'],
  ),

  {
    ...declaration(
      CRIME,
      'ever_convicted',
      'hasBeenConvicted',
      'Ever convicted of a criminal offence in any country',
      [
        'been_convicted',
        'criminal_conviction',
        'criminal_convictions',
        'criminal_record',
      ],
    ),
    derive: (p) =>
      declared(
        p,
        'ever_convicted',
        'been_convicted',
        'criminal_conviction',
        'criminal_convictions',
        'criminal_record',
      ) ?? noChargesOrConvictions(p),
  },
  declarationDetails(
    CRIME,
    'ever_convicted',
    'convictedDetails',
    'Conviction — details',
    ['conviction_details', 'criminal_conviction_details'],
  ),

  // ── Security ──────────────────────────────────────────────────────────────
  declaration(
    SECURITY,
    'violent_organization_member',
    'isMember',
    'Ever a member of, or associated with, a group that used violence or criminal activity',
    [
      'member_of_violent_organization',
      'criminal_organization_member',
      'violent_organization_membership',
    ],
  ),
  declarationDetails(
    SECURITY,
    'violent_organization_member',
    'isMemberDetails',
    'Membership — details',
    [
      'organization_membership_details',
      'political_organization_membership_details',
    ],
  ),

  declaration(
    SECURITY,
    'ill_treatment',
    'illTreatment',
    'Ever witnessed or took part in the ill treatment of prisoners or civilians, or desecration of religious buildings',
    ['involved_in_ill_treatment', 'witnessed_ill_treatment'],
  ),
  declarationDetails(
    SECURITY,
    'ill_treatment',
    'illTreatmentDetails',
    'Ill treatment — details',
    ['witnessed_or_participated_in_abuse_details'],
  ),

  // ── Medical ───────────────────────────────────────────────────────────────
  declaration(
    MEDICAL_EXAM,
    'medical_exam_last_12_months',
    'hasMedicalExam',
    'Had an IRCC medical exam in the last 12 months',
    ['ircc_medical_exam_last_12_months', 'had_immigration_medical_exam'],
  ),
  // A reference number, not an answer: it may come from the panel
  // physician's confirmation document, unlike the Yes/No above. Written only
  // in a format IRCC accepts (medicalExamNumber), so its own key is ircc_.
  text(
    MEDICAL_EXAM,
    'ircc_medical_exam_number',
    '#medicalNumber_input',
    'IRCC medical exam — IME or UMI number',
    'travel_history',
    (p) => pickText(p, ...MEDICAL_NUMBER_KEYS),
    {
      // The format gate is the transform, so a value stored under the
      // field's own key (a consultant's correction) passes it too.
      transform: 'ircc_medical_number',
      reveal: true,
      parent: 'medical_exam_last_12_months',
      parentValue: 'Yes',
    },
  ),
  // Shown after "No" only for some residence rows (workMedicalJobsShown;
  // live 2026-10-31, bundle questionId 367). Written from the applicant's
  // explicit answer and only when IRCC surely shows it: a missing control
  // halts the run. Otherwise a note (leftForApplicant).
  yesNo(
    MEDICAL_EXAM,
    'work_in_public_health_job',
    'workMedicalJobs',
    'Intends to work in Canada in a job where public health must be protected',
    'travel_history',
    (p) =>
      workMedicalJobsShown(p) === 'shown'
        ? declared(p, ...WORK_MEDICAL_JOBS_KEYS)
        : undefined,
    {
      reveal: true,
      parent: 'medical_exam_last_12_months',
      parentValue: 'No',
      silent: true,
    },
  ),

  declaration(
    MEDICAL_TB,
    'tuberculosis',
    'hasTuberculosis',
    'Diagnosed with tuberculosis in the last 2 years',
    ['tuberculosis_diagnosed', 'tb_diagnosed', 'has_tuberculosis'],
  ),
  yesNo(
    MEDICAL_TB,
    'tuberculosis_treated_six_months',
    'treatmentMinSixMonth',
    'Tuberculosis — treated for at least 6 months',
    'travel_history',
    (p) => declared(p, 'tuberculosis_treated_six_months'),
    {
      reveal: true,
      parent: 'tuberculosis',
      parentValue: 'Yes',
      declaration: true,
    },
  ),

  // A child aged 5 or under is asked the same questions over 2 years under
  // other names (contactTwoYears …; tr-rt bundle 2026-10-19), so these are
  // not written for them, and nothing is listed: leftForApplicant lists the
  // question for everyone else who has not answered it, and explains the
  // child's version.
  ((base) => ({
    ...base,
    silent: true,
    derive: (p: Profile) => (maybeYoungChild(p) ? undefined : base.derive!(p)),
  }))(
    declaration(
      MEDICAL_TB,
      'tuberculosis_contact',
      'contactFiveYears',
      'Close contact with a person with tuberculosis in the last 5 years',
      [...TB_CONTACT_KEYS],
    ),
  ),
  yesNo(
    MEDICAL_TB,
    'tuberculosis_tested',
    'hasTestFiveYears',
    'Tuberculosis — tested since the contact',
    'travel_history',
    (p) => declared(p, 'tuberculosis_tested', 'tb_tested'),
    {
      reveal: true,
      parent: 'tuberculosis_contact',
      parentValue: 'Yes',
      declaration: true,
    },
  ),
  // "Tested" Yes reveals "Were your test results positive?" — -01 Yes,
  // -02 No (live 2026-10-18, confirmed 2026-10-19; IRCC's own spelling).
  yesNo(
    MEDICAL_TB,
    'tuberculosis_test_positive',
    'fiveYearsPostive',
    'Tuberculosis — the test result was positive',
    'travel_history',
    (p) =>
      declared(p, 'tuberculosis_test_positive', 'tb_test_positive'),
    {
      reveal: true,
      parent: 'tuberculosis_tested',
      parentValue: 'Yes',
      declaration: true,
    },
  ),
  // A positive result reveals "Have you completed or are you currently
  // undergoing treatment for tuberculosis (minimum of 6 months)?" — required
  // (tr-rt bundle 2026-10-19: fiveYearsTreatment).
  yesNo(
    MEDICAL_TB,
    'tuberculosis_positive_treated',
    'fiveYearsTreatment',
    'Tuberculosis — completed or undergoing treatment (at least 6 months)',
    'travel_history',
    (p) => declared(p, 'tuberculosis_positive_treated', 'tb_positive_treated'),
    {
      reveal: true,
      parent: 'tuberculosis_test_positive',
      parentValue: 'Yes',
      declaration: true,
    },
  ),

  // A child surely 5 or under: the 2-year chain (live 2026-10-31, child
  // born 2022-03-10: contactTwoYears → hasTestTwoYears → twoYearsPostive →
  // twoYearsTreatment), from the explicit answers only; each follow-up only
  // after a Yes. Near the 6th birthday nothing is written (leftForApplicant).
  {
    ...yesNo(
      MEDICAL_TB,
      'tuberculosis_contact_two_years',
      'contactTwoYears',
      'Close contact with a person with tuberculosis in the last 2 years',
      'travel_history',
      (p) => declared(p, 'tuberculosis_contact_two_years'),
      { declaration: true },
    ),
    onlyIf: surelyFiveOrUnder,
  },
  yesNo(
    MEDICAL_TB,
    'tuberculosis_tested_two_years',
    'hasTestTwoYears',
    'Tuberculosis (last 2 years) — tested since the contact',
    'travel_history',
    (p) => declared(p, 'tuberculosis_tested_two_years'),
    {
      reveal: true,
      parent: 'tuberculosis_contact_two_years',
      parentValue: 'Yes',
      declaration: true,
    },
  ),
  yesNo(
    MEDICAL_TB,
    'tuberculosis_test_positive_two_years',
    'twoYearsPostive',
    'Tuberculosis (last 2 years) — the test result was positive',
    'travel_history',
    (p) => declared(p, 'tuberculosis_test_positive_two_years'),
    {
      reveal: true,
      parent: 'tuberculosis_tested_two_years',
      parentValue: 'Yes',
      declaration: true,
    },
  ),
  yesNo(
    MEDICAL_TB,
    'tuberculosis_positive_treated_two_years',
    'twoYearsTreatment',
    'Tuberculosis (last 2 years) — completed or undergoing treatment (at least 6 months)',
    'travel_history',
    (p) => declared(p, 'tuberculosis_positive_treated_two_years'),
    {
      reveal: true,
      parent: 'tuberculosis_test_positive_two_years',
      parentValue: 'Yes',
      declaration: true,
    },
  ),

  declaration(
    MEDICAL,
    'dialysis',
    'hasDialysisTreatment',
    'Receiving dialysis treatment',
    ['dialysis_treatment'],
  ),
  declaration(
    MEDICAL,
    'addiction',
    'hasAddiction',
    'Has a drug or alcohol addiction',
    ['drug_or_alcohol_addiction', 'substance_addiction'],
  ),
  declaration(
    MEDICAL,
    'mental_health_condition',
    'mentalHealth',
    'Has a mental health condition',
    ['mental_health'],
  ),
  declaration(MEDICAL, 'syphilis', 'hasSyphilis', 'Diagnosed with syphilis', [
    'has_syphilis',
  ]),
  yesNo(
    MEDICAL,
    'syphilis_treated',
    'hasSyphilisTreatment',
    'Syphilis — treated',
    'travel_history',
    (p) => declared(p, 'syphilis_treated', 'syphilis_treatment'),
    { reveal: true, parent: 'syphilis', parentValue: 'Yes', declaration: true },
  ),

  // ── Marital status and spouse ─────────────────────────────────────────────
  radio(
    FAMILY,
    'marital_status',
    'currentMaritalStatus',
    'Current marital status',
    'passport',
    {
      Married: '01',
      Single: '02',
      'Common-Law': '03',
      Divorced: '04',
      Separated: '05',
      Widowed: '06',
      'Annulled Marriage': '09',
    },
    maritalStatus,
  ),
  ...dateSelects(
    FAMILY,
    'marriage_date',
    'dateOfDating',
    'Date of marriage',
    'dates',
    {
      derive: unionStartDate,
      reveal: true,
      parent: 'marital_status',
      parentValue: SPOUSE_KNOWN,
    },
  ),
  text(
    FAMILY,
    'spouse_family_name',
    '#lastName_input',
    'Spouse — family name',
    'passport',
    (p) => spouseNames(p).family,
    { reveal: true, parent: 'marital_status', parentValue: SPOUSE_KNOWN },
  ),
  text(
    FAMILY,
    'spouse_given_name',
    '#firstName_input',
    'Spouse — given name',
    'passport',
    (p) => spouseNames(p).given,
    { reveal: true, parent: 'marital_status', parentValue: SPOUSE_KNOWN },
  ),
  ...dateSelects(
    FAMILY,
    'spouse_date_of_birth',
    'dateOfBirthPartner',
    'Spouse — date of birth',
    'dates',
    {
      derive: spouseDob,
      reveal: true,
      parent: 'marital_status',
      parentValue: SPOUSE_KNOWN,
    },
  ),
  country(
    FAMILY,
    'spouse_country_of_birth',
    '#countryOfBirthPartner_select',
    'Spouse — country of birth',
    'passport',
    spouseBirthCountry,
    { reveal: true, parent: 'marital_status', parentValue: SPOUSE_KNOWN },
  ),
  optionText(
    FAMILY,
    'spouse_occupation_option',
    '#partnerOccupation_select',
    'Spouse — occupation',
    'employment',
    spouseOccupationOption,
    { reveal: true, parent: 'marital_status', parentValue: SPOUSE_LIVING },
  ),
  yesNo(
    FAMILY,
    'spouse_same_address',
    'commonAddressFamily',
    'Spouse lives at your address',
    'addresses',
    (p) =>
      declared(p, 'spouse_same_address', 'lives_with_spouse') ??
      declared(spouse(p), 'same_address', 'lives_with_applicant'),
    { reveal: true, parent: 'marital_status', parentValue: SPOUSE_LIVING },
  ),
  yesNo(
    FAMILY,
    'spouse_coming_to_canada',
    'partnerComingCanada',
    'Spouse is coming to Canada with you',
    'travel_history',
    (p) =>
      declared(
        p,
        'spouse_coming_to_canada',
        'spouse_accompanying',
        'spouse_travelling',
      ) ?? declared(spouse(p), 'coming_to_canada', 'accompanying'),
    { reveal: true, parent: 'marital_status', parentValue: SPOUSE_LIVING },
  ),
  ...addressFields(
    FAMILY,
    'spouse_address',
    'partnerInfoAddress',
    'Spouse — address',
    (p) =>
      anyAddress(
        pick(p, 'spouse_address') ?? spouse(p).address,
        pickCountry(
          p,
          'spouse_country_of_residence',
          'spouse_current_country',
        ) ?? pickCountry(spouse(p), 'country_of_residence'),
      ),
    { reveal: true, parent: 'spouse_same_address', parentValue: 'No' },
  ),
  ...dateSelects(
    FAMILY,
    'marriage_end_date',
    'endDatePartner',
    'Date the marriage or relationship ended',
    'dates',
    {
      derive: unionEndDate,
      reveal: true,
      parent: 'marital_status',
      parentValue: UNION_ENDED,
    },
  ),

  // ── Children ──────────────────────────────────────────────────────────────
  yesNo(CHILDREN, 'has_children', 'hasChild', 'Has children', 'passport', (p) =>
    yesOnlyWithRow(hasChildren(p), anyChildRow(p)),
  ),
  check(
    CHILDREN,
    'no_children_acknowledged',
    '#declaringChildren_chk-input',
    'I understand that I am not declaring any natural, adopted or step-children',
    'passport',
    (p) => (hasChildren(p) === 'No' ? 'Yes' : undefined),
    { reveal: true, parent: 'has_children', parentValue: 'No' },
  ),
  ...childRows(),

  // ── Parents ───────────────────────────────────────────────────────────────
  // "I don't know who my parents are." (`#declaringParents_chk-input`,
  // recorded live 2026-10-18 on draft 12553614; ticking it hides the parent
  // table). Only from the applicant's explicit answer, and never beside a
  // listed parent (matrix C row 37).
  check(
    PARENTS,
    'parents_unknown',
    '#declaringParents_chk-input',
    "I don't know who my parents are",
    'passport',
    (p) => (parentsUnknown(p) ? 'Yes' : undefined),
    // Unticked is IRCC's default and the usual answer: never listed.
    { silent: true },
  ),
  ...parentRows(),

  // ── Language ──────────────────────────────────────────────────────────────
  optionText(
    LANGUAGE,
    'native_language',
    '#selectNativeLanguage_select',
    'Native language',
    'passport',
    (p) => nativeLanguage(p)?.option,
    // Listed by leftForApplicant, which says why it was left.
    { silent: true },
  ),
  // "Other" reveals "Specify your native language" (#inputNativeLanguage_input,
  // letters only, at most 100; tr-rt bundle 2026-10-20).
  text(
    LANGUAGE,
    'ircc_native_language_other',
    '#inputNativeLanguage_input',
    "Native language (not in IRCC's list)",
    'passport',
    (p) => nativeLanguage(p)?.other,
    { reveal: true, parent: 'native_language', parentValue: 'Other' },
  ),
  radio(
    LANGUAGE,
    'official_language_ability',
    'knowLanguage',
    'Can communicate in English or French',
    'passport',
    { English: '01', French: '02', Both: '04', Neither: '03' },
    officialLanguages,
  ),
  radio(
    LANGUAGE,
    'most_comfortable_language',
    'easeLanguage',
    'Language you are most comfortable using',
    'passport',
    { English: '01', French: '02' },
    (p) => {
      const v = pickText(
        p,
        'most_comfortable_language',
        'language_most_comfortable',
      );
      if (v)
        return /fr/i.test(v) ? 'French' : /en/i.test(v) ? 'English' : undefined;
      return preferredLanguage(p);
    },
    { reveal: true, parent: 'official_language_ability', parentValue: 'Both' },
  ),
  radio(
    LANGUAGE,
    'preferred_contact_language',
    'preferredLanguage',
    'Language IRCC should contact you in',
    'passport',
    { English: '01', French: '02' },
    preferredLanguage,
    { reveal: true },
  ),

  // ── Email ─────────────────────────────────────────────────────────────────
  text(
    EMAIL,
    'email',
    '#emailContactInfo_input',
    'Email address',
    'addresses',
    applicantEmail,
  ),
  text(
    EMAIL,
    'email',
    '#emailConfirmationContactInfo_input',
    'Email address (confirm)',
    'addresses',
    applicantEmail,
  ),

  // ── Telephone ─────────────────────────────────────────────────────────────
  // The main number, then up to two more through the same dialog (one row
  // written live 2026-10-30; the table takes several).
  ...phoneRow(1, applicantPhoneRow, applicantPhoneExtension),
  ...Array.from({ length: MAX_EXTRA_PHONES }, (_, i) =>
    phoneRow(i + 2, (p) => extraPhoneRow(p, i + 2)),
  ).flat(),

  // ── Documents: attach the reviewed VisaAI documents (ircc-uploads.ts) ──────
  ...uploadMappings(DOC_UPLOAD),
]));

// The row's own date key first: a correction a person made to the written
// value (Forms page or consultant review) must also be what the row's summary
// says, or the summary and the dates IRCC receives disagree (prod 2026-10-18,
// app 61f16bb5: "Citizen since 1988-09-16" with the corrected date written).
const RESIDENCE_SINCE_KEYS = [
  'ircc_residence_since',
  'residence_since',
  'living_since',
  'residential_address_since',
  'resident_since',
];

/** Since when the applicant has lived there; "since birth" is the date of birth. */
function residenceSince(p: Profile): string | undefined {
  const date = pickDate(p, ...RESIDENCE_SINCE_KEYS);
  if (date) return date;
  const said = pickText(p, ...RESIDENCE_SINCE_KEYS);
  const sinceBirth =
    (said && /birth/i.test(said)) ||
    declared(p, 'residence_since_birth', 'lived_there_since_birth') === 'Yes';
  return sinceBirth ? pickDate(p, 'date_of_birth') : undefined;
}

/**
 * Status in the country of residence, as tr-rt's `Person_Residence_Status`
 * option text (bundle LOV: 01 Citizen, 02 Permanent resident, 03 Visitor,
 * 04 Worker, 05 Student, 06 Other, 07 Protected Person, 08 Refugee Claimant,
 * 09 Foreign National). Order matters: "permanent resident" before "resident".
 */
const RESIDENCE_STATUS_OPTIONS: ReadonlyArray<[RegExp, string]> = [
  [/permanent|\bpr\b/, 'Permanent resident'],
  [/protected/, 'Protected Person'],
  [/refugee|asylum/, 'Refugee Claimant'],
  [/foreign national/, 'Foreign National'],
  [/citizen/, 'Citizen'],
  [/visit|touris/, 'Visitor'],
  [/work|employ|iqama|labou?r/, 'Worker'],
  [/stud/, 'Student'],
  [/^other\b/, 'Other'],
];
/**
 * Statuses whose current row goes without a To date: Citizen and Permanent
 * resident (saved live before, ongoing, no To). Live 2026-10-31 the To date
 * stays visible with "ongoing" ticked and a Worker row ongoing without To did
 * not save (SAVED: UAE Worker, ongoing, To 2027-04-30), so EVERY other status
 * is written only with its valid-until date as To; without it, a note. (The
 * bundle hides To for some statuses while ongoing; not trusted over live.)
 */
const RESIDENCE_NO_TO = ['Citizen', 'Permanent resident'];
const needsResidenceTo = (status: string) => !RESIDENCE_NO_TO.includes(status);

/** IRCC's status option for words the applicant used; unnamed words are "Other". */
function residenceStatusOption(said: string): string {
  const t = said.toLowerCase();
  return RESIDENCE_STATUS_OPTIONS.find(([re]) => re.test(t))?.[1] ?? 'Other';
}

/** The "Other" details as IRCC accepts them, or undefined (none, or too long). */
function residenceDetail(raw: string | undefined): string | undefined {
  const t = raw ? irccRomanText(raw) : undefined;
  return t && t.length <= RESIDENCE_DETAIL_MAX ? t : undefined;
}

/** What the applicant told us about the residence row, whether or not it can be written. */
function residenceAnswers(p: Profile):
  | {
      country?: string;
      status?: string;
      since?: string;
      until?: string;
      detail?: string;
    }
  | undefined {
  // Each part reads the row's own key first (see RESIDENCE_SINCE_KEYS).
  const home = residentialAddress(p);
  const country =
    pickCountry(p, 'ircc_residence_country') ??
    home?.country ??
    pickCountry(
      p,
      'country_of_residence',
      'current_country_of_residence',
      'residence_country',
    );
  const since = residenceSince(p);
  const explicit = pickText(
    p,
    'ircc_residence_status',
    'residence_status',
    'status_in_country_of_residence',
  );
  // A status in words the list does not name ("residence visa") is "Other",
  // described in those words unless the details were given.
  const status = explicit
    ? residenceStatusOption(explicit)
    : country && nationality(p) === country
      ? 'Citizen'
      : undefined;
  const detail =
    status === 'Other'
      ? (pickText(p, 'residence_status_details', 'residence_status_other') ??
        (/^other\b/i.test(explicit ?? '') ? undefined : explicit))
      : undefined;
  const until = pickDate(
    p,
    'residence_status_valid_until',
    'residence_status_expiry',
    'residence_permit_expiry',
  );
  return { country, status, since, until, detail };
}

interface ResidenceRow {
  country: string;
  status: string;
  since: string;
  /** The To date: every status but Citizen / Permanent resident. */
  until?: string;
  /** "Other" only. */
  detail?: string;
}

/**
 * The current residence row, written for every status (live 2026-10-31):
 * country, status and since-when must be known; "Other" needs its details
 * (≤100 characters once in Roman script) and every status but Citizen /
 * Permanent resident its valid-until date (To), or the row is left with a note.
 */
function residence(p: Profile): ResidenceRow | undefined {
  const { country, status, since, until, detail } = residenceAnswers(p) ?? {};
  if (!country || !since || !status) return undefined;
  const row: ResidenceRow = { country, status, since };
  if (status === 'Other') {
    const d = residenceDetail(detail);
    if (!d) return undefined;
    row.detail = d;
  }
  if (needsResidenceTo(status)) {
    if (!until || until <= since) return undefined;
    row.until = until;
  }
  return row;
}

/** The leftover note for a residence row not written: what to enter, with what we know. */
function residenceRowNote(p: Profile): string {
  const a = residenceAnswers(p) ?? {};
  if (!a.status || !a.country)
    return 'Add where you live, your status there and since when.';
  const parts = [
    displayCountry(a.country),
    `status ${a.status}${a.detail ? ` (${a.detail})` : ''}`,
    a.since ? `since ${a.since}` : 'since (date you started living there)',
  ];
  if (needsResidenceTo(a.status))
    parts.push(a.until ? `valid until ${a.until}` : 'valid until (the date your status ends)');
  if (a.status === 'Other' && a.detail && !residenceDetail(a.detail))
    parts.push(`describe the status in at most ${RESIDENCE_DETAIL_MAX} characters`);
  return `Add a residence row: ${parts.join(', ')}; tick "This is where I currently live".`;
}

/** Keys the earlier-residence answers are read under. */
const EARLIER_RESIDENCE_KEYS = [
  'previous_countries_of_residence',
  'previous_residence_countries',
];
const LIVED_ELSEWHERE_KEYS = [
  'lived_elsewhere_last_5_years',
  'lived_in_other_country_last_5_years',
];

/** An earlier residence as IRCC's dialog takes a past row (live 2026-10-31). */
interface EarlierResidence {
  country: string;
  status: string;
  from: string;
  to: string;
  detail?: string;
}

/** One earlier residence record as a past row, or undefined when anything is missing. */
function earlierResidenceRow(r: Profile): EarlierResidence | undefined {
  const country = pickCountry(r, 'country');
  const said = pickText(r, 'status', 'residence_status');
  const from = pickDate(r, 'from', 'since', 'start', 'from_date');
  const to = pickDate(r, 'to', 'until', 'end', 'to_date');
  if (!country || !said || !from || !to || to <= from) return undefined;
  const status = residenceStatusOption(said);
  const row: EarlierResidence = { country, status, from, to };
  if (status === 'Other') {
    const d = residenceDetail(
      pickText(r, 'status_details', 'details', 'residence_status_details') ??
        (/^other\b/i.test(said) ? undefined : said),
    );
    if (!d) return undefined;
    row.detail = d;
  }
  return row;
}

const earlierResidenceRecords = (p: Profile) =>
  people(p, ...EARLIER_RESIDENCE_KEYS);
const earlierResidenceAt = (p: Profile, n: number) => {
  const r = earlierResidenceRecords(p)[n - 1];
  return n <= MAX_EARLIER_RESIDENCES && r ? earlierResidenceRow(r) : undefined;
};

/**
 * Earlier countries of residence (past 5 years, 6+ months) the assistant does
 * NOT write, for the note: a record missing something, one past the row cap,
 * or a list given as text. undefined when there is nothing to add, [] when
 * Yes without the countries.
 */
function earlierResidenceLines(p: Profile): string[] | undefined {
  const raw = pick(p, ...EARLIER_RESIDENCE_KEYS);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t && !/^(none|no|n\/a|nil)\.?$/i.test(t)) return [t];
  }
  const all = earlierResidenceRecords(p);
  const rows = all
    .map((r, i) => {
      if (earlierResidenceAt(p, i + 1)) return '';
      const country = pickText(r, 'country');
      if (!country) return '';
      const status = pickText(r, 'status', 'residence_status');
      const from = pickText(r, 'from', 'since', 'start');
      const to = pickText(r, 'to', 'until', 'end');
      return `${country}, status ${status ?? '(your status there)'}, from ${from ?? '(start date)'} to ${to ?? '(end date)'}`;
    })
    .filter(Boolean);
  if (rows.length) return rows;
  if (all.length) return undefined;
  return declared(p, ...LIVED_ELSEWHERE_KEYS) === 'Yes' ? [] : undefined;
}

// ── workMedicalJobs (/medical-background-questions) ─────────────────────────
/**
 * tr-rt's Medical_Required_Countries LOV (IRCC country codes, bundle
 * 2026-10-31). workMedicalJobs (questionId 367) is shown after hasMedicalExam
 * "No" when a residence row ended less than a year ago, lasted at least 180
 * days and is in a country NOT on this list (bundle; live 2026-10-31: shown
 * with past residence rows).
 */
const MEDICAL_REQUIRED_COUNTRY_CODES = new Set([
  '019', '020', '048', '049', '050', '051', '052', '053', '054', '055', '056',
  '057', '058', '059', '060', '064', '088', '111', '112', '113', '121', '122',
  '130', '131', '132', '133', '135', '136', '151', '152', '153', '154', '155',
  '156', '157', '158', '159', '160', '161', '162', '163', '164', '165', '166',
  '167', '169', '170', '171', '172', '173', '174', '175', '176', '177', '178',
  '179', '180', '181', '182', '183', '185', '186', '187', '188', '189', '198',
  '200', '201', '202', '203', '204', '205', '209', '212', '222', '224', '227',
  '241', '242', '246', '252', '254', '255', '256', '257', '258', '260', '261',
  '262', '264', '265', '267', '270', '271', '273', '341', '342', '521', '543',
  '544', '545', '546', '547', '651', '654', '709', '711', '723', '751', '753',
  '755', '801', '823', '824', '826', '830', '831', '832', '834', '835', '836',
  '901', '905', '911', '914', '916',
]);

/** The residence rows the assistant writes, with their To dates. */
function writtenResidenceSpans(
  p: Profile,
): { country: string; from: string; to?: string }[] {
  const out: { country: string; from: string; to?: string }[] = [];
  const cur = residence(p);
  if (cur) out.push({ country: cur.country, from: cur.since, to: cur.until });
  for (let n = 1; n <= MAX_EARLIER_RESIDENCES; n++) {
    const r = earlierResidenceAt(p, n);
    if (r) out.push({ country: r.country, from: r.from, to: r.to });
  }
  return out;
}

/**
 * What the residence rows the assistant writes leave of IRCC's window: the
 * past 5 years, or since birth for a younger child. Live 2026-10-31
 * /contact-info will not save until the rows cover it. Month by month, as in
 * workHistoryCoverage; the current row runs to today. `uncovered` is
 * "YYYY-MM to YYYY-MM" ranges; empty when covered or when no row is written
 * (the row's own note covers that).
 */
export function residenceCoverage(p: Profile): string[] {
  const rows = writtenResidenceSpans(p);
  if (!rows.length) return [];
  const now = monthNo(thisMonth());
  const dob = pickDate(p, 'date_of_birth');
  const start = Math.max(now - 60, dob ? monthNo(dob) : -Infinity);
  const cur = residence(p);
  const spans: Array<[number, number]> = rows.map((r, i) => [
    monthNo(r.from),
    i === 0 && cur ? now : monthNo(r.to ?? thisMonth()),
  ]);
  const uncovered: string[] = [];
  let next = start;
  for (const [from, to] of spans.sort((a, b) => a[0] - b[0])) {
    if (to < next) continue;
    if (from > next)
      uncovered.push(`${monthYm(next)} to ${monthYm(Math.min(from - 1, now))}`);
    next = Math.max(next, to + 1);
    if (next > now) break;
  }
  if (next <= now) uncovered.push(`${monthYm(next)} to ${monthYm(now)}`);
  return uncovered;
}

/**
 * Whether IRCC shows workMedicalJobs for the rows the assistant writes:
 * 'shown', 'hidden', or 'unsure' within a few days of either limit (the
 * browser's clock and time zone decide, not ours).
 */
export function workMedicalJobsShown(
  p: Profile,
  now = new Date(),
): 'shown' | 'hidden' | 'unsure' {
  const yearAgo = Date.UTC(
    now.getUTCFullYear() - 1,
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const MARGIN = 3 * DAY_MS;
  let unsure = false;
  for (const r of writtenResidenceSpans(p)) {
    if (!r.to) continue;
    const code = applyFillTransform('ircc_country', r.country);
    if (!code || MEDICAL_REQUIRED_COUNTRY_CODES.has(code)) continue;
    const to = Date.parse(`${r.to}T00:00:00Z`);
    const from = Date.parse(`${r.from}T00:00:00Z`);
    const days = (to - from) / DAY_MS;
    const recent = to - yearAgo;
    if (recent > MARGIN && days >= 182) return 'shown';
    if (recent > -MARGIN && days >= 178) unsure = true;
  }
  return unsure ? 'unsure' : 'hidden';
}

/** Keys the applicant's answer to IRCC's workMedicalJobs is read under. */
const WORK_MEDICAL_JOBS_KEYS = [
  'work_in_public_health_job',
  'public_health_occupation',
  'public_health_job',
];

/** Label of the no-host note; the super visa and business variants drop it. */
export const NO_HOST_NOTE_LABEL = 'Who you will visit or where you will stay';

/**
 * The /inviter-info note for a visitor with no host in Canada. The page has
 * no "no one" option recorded live, and lodging is never the inviter, so the
 * page is left blank; the note names the place to stay (wave 2a, matrix A 83).
 */
function noHostNote(p: Profile): ManualFieldNote {
  const name = pickText(p, 'accommodation_provider_name', 'accommodation_name', 'hotel_name');
  const address = pickText(p, 'accommodation_address', 'hotel_address');
  const place = [name, address].filter(Boolean).join(', ');
  return {
    page: INVITER,
    label: NO_HOST_NOTE_LABEL,
    reason: place ? 'fill_yourself' : 'not_in_profile',
    note: `IRCC asks who you will visit or where you will stay. You have no host in Canada, so the assistant left this page blank: if IRCC asks for it, ${
      place
        ? `enter where you will stay — ${place}.`
        : 'enter your hotel or the place you will stay (name and address).'
    }`,
  };
}

/**
 * The applicant has a single name: a family name and nothing else to give.
 * IRCC takes it as the last name with the given name blank.
 */
function singleName(p: Profile): boolean {
  const family = pickText(p, 'family_name');
  if (!family || pickText(p, 'given_name')) return false;
  const full = pickText(p, 'full_name');
  return !!full && full.split(/\s+/).length === 1;
}

/** What is missing from the second inviter's block, for the applicant to add. */
function secondInviterGaps(p: Profile): string[] {
  if (!secondInviterConfirmed(p))
    return [
      "details: VisaAI could not confirm they are a different person from your host (their name, telephone, email or address match your host's, or were recorded from an earlier answer), so it typed nothing for them",
    ];
  const missing: string[] = [];
  if (!secondInviterName(p).family) missing.push('name');
  if (!secondInviterRelationship(p)) missing.push('relationship to you');
  if (!secondInviterAddress(p))
    missing.push(
      "a full Canadian address (if they live with your host, enter that address yourself: the assistant never copies your host's details)",
    );
  const kind = secondInviterRelationship(p);
  if (
    kind &&
    (INVITER_IS_ORGANIZATION as readonly string[]).includes(kind) &&
    !secondInviterOrganization(p)
  )
    missing.push('name of their organization or conference');
  // A number VisaAI cannot place (no country code it can read) is named so
  // the applicant enters it themselves.
  const secondPhone = pickText(secondInviter(p), 'phone');
  if (!secondInviterPhone(p))
    missing.push(
      secondPhone
        ? `telephone number: VisaAI could not tell the country code of ${secondPhone}, so it was left blank — enter it yourself (outside Canada and the U.S., choose "Other", then the country code and number)`
        : 'telephone number',
    );
  if (!phoneTypeOption(pickText(secondInviter(p), 'phone_type')))
    missing.push('telephone type (Residence, Cellular or Other)');
  // Required by IRCC (live 2026-10-18: "Email address - This field is required").
  if (!pickText(secondInviter(p), 'email')) missing.push('email address');
  return missing;
}

/** What the assistant never fills, page by page — the applicant's part. */
/** " <lead>: a; b." for a note, or '' when there is nothing recorded. */
const recordedList = (lead: string, lines: string[]) =>
  lines.length ? ` ${lead}: ${lines.join('; ')}.` : '';

/** The other citizenships the interview recorded, for the note. */
function otherCitizenshipLines(p: Profile): string[] {
  return people(p, 'other_citizenships', 'other_citizenship', 'additional_citizenships')
    .map((c) => {
      const country = pickText(c, 'country');
      if (!country) return '';
      const fromBirth = declared(c, 'from_birth');
      const since = pickDate(c, 'since', 'citizen_since', 'date');
      return fromBirth === 'Yes'
        ? `${country} (since birth)`
        : since
          ? `${country} (since ${since})`
          : country;
    })
    .filter(Boolean);
}

/** The schools the interview recorded, for the note. */
function educationLines(p: Profile): string[] {
  return people(p, 'education_history', 'schools', 'post_secondary_schools')
    .map(educationLine)
    .filter(Boolean);
}

/** One recorded school as a note line, or '' without a school name. */
function educationLine(e: Profile): string {
  const school = pickText(e, 'school', 'institution', 'name');
  if (!school) return '';
  const from = pickText(e, 'from');
  const to = pickText(e, 'to');
  const what = [pickText(e, 'level', 'level_of_study'), pickText(e, 'field_of_study', 'field')]
    .filter(Boolean)
    .join(', ');
  // The full address as recorded, so a school IRCC asks in its
  // manual-entry form (Canada, U.S., Mexico) can be typed from the note.
  const where = [
    pickText(e, 'street_address', 'street', 'address'),
    pickText(e, 'city', 'town'),
    pickText(e, 'province', 'state', 'region'),
    pickText(e, 'postal_code', 'zip_code', 'zip', 'postcode'),
    pickText(e, 'country'),
  ]
    .filter(Boolean)
    .join(', ');
  return [
    school,
    where && `(${where})`,
    from || to ? `${from ?? '?'} to ${to ?? '?'}` : '',
    what,
  ]
    .filter(Boolean)
    .join(' ');
}

function leftForApplicant(
  p: Profile,
  exclude: ReadonlySet<string> = new Set(),
): ManualFieldNote[] {
  const workCoverage = workHistoryCoverage(p);
  const notes: ManualFieldNote[] = [
    {
      page: BIO,
      label: 'Given name',
      reason: 'not_in_profile',
      when: () => !pickText(p, 'given_name') && !singleName(p),
    },
    ...signatureNotes(p, (slot) =>
      slot.requires === 'uses_representative'
        ? usesRepresentative(p) === 'Yes'
        : true,
    ).map((n) => ({
      page: DOC_UPLOAD,
      label: n.label,
      reason: 'fill_yourself' as const,
      note: n.note,
    })),
    {
      page: REPRESENTATIVE,
      label: 'Your relationship to the applicant',
      reason: 'fill_yourself',
      note: 'Answer "Who are you in relation to the person you\'re helping?" (for example, a family member).',
      when: () => unpaidRepresentative(p) && !representativeRelationship(p),
    },
    {
      page: REPRESENTATIVE,
      label: 'Representative details',
      reason: 'fill_yourself',
      note: 'Your profile does not say whether the representative is paid or unpaid; enter their details yourself.',
      when: () =>
        usesRepresentative(p) === 'Yes' &&
        declared(p, 'representative_paid', 'is_paid_representative') ===
          undefined,
    },
    {
      page: REPRESENTATIVE,
      label: 'Paid representative details',
      reason: 'fill_yourself',
      note: 'A paid representative (consultant or lawyer) enters their own membership and contact details.',
      when: () =>
        usesRepresentative(p) === 'Yes' &&
        declared(p, 'representative_paid', 'is_paid_representative') === 'Yes',
    },
    {
      page: REPRESENTATIVE,
      label: "Representative's address",
      reason: 'not_in_profile',
      note: 'Not recorded as a full Canadian address (number, street, city, province, postal code).',
      when: () => unpaidRepresentative(p) && !representativeAddress(p),
    },
    {
      // The question is left too: its table must list every citizenship.
      page: NATIONALITY,
      label: 'Other citizenships',
      reason: 'fill_yourself',
      note: `Answer "more than one country" yourself and list every citizenship, your passport's included.${recordedList(
        'Still missing',
        citizenshipEntries(p)
          .filter((e) => e.missing.length)
          .map((e) => `${e.label}: ${e.missing.join(', ')}`),
      )}${recordedList('VisaAI has', otherCitizenshipLines(p))}`,
      when: () =>
        multipleCitizenship(p) === 'Yes' && !citizenshipRowsComplete(p),
    },
    {
      page: TRAVEL_DOC,
      label: 'U.S. visa in another passport',
      reason:
        usVisaInOtherPassport(p) === 'Yes' ? 'not_in_profile' : 'fill_yourself',
      note:
        usVisaInOtherPassport(p) === 'Yes'
          ? "Your U.S. visa is in another passport: answer Yes and enter that passport's country, number, issue date and expiry date."
          : "Answer whether your U.S. visa is in a passport other than the one in this application; if it is, enter that passport's country, number, issue date and expiry date.",
      when: () =>
        holdsUsVisa(p) === 'Yes' &&
        yesOnlyWithRow(usVisaInOtherPassport(p), !!usVisaPassport(p)) ===
          undefined,
    },
    {
      page: NATIONALITY,
      label: 'Date you became a citizen',
      reason: 'not_in_profile',
      note: 'You are not a citizen since birth: enter the date you became a citizen.',
      when: () =>
        citizenFromBirth(p) === 'No' &&
        multipleCitizenship(p) !== 'Yes' &&
        !citizenshipDate(p),
    },
    {
      page: OTHER_NAMES,
      label: 'Other names you have used',
      reason: 'fill_yourself',
      note: 'Add each name you have used: alias, name before marriage or previous name.',
      // The question itself is left too when no complete row is added.
      when: () => hasOtherNames(p) === 'Yes' && !anyOtherNameRow(p),
    },
    {
      page: CHILDREN,
      label: 'Children',
      reason: 'fill_yourself',
      note: 'Answer "Do you have children?" and add each child: IRCC needs at least one complete child entry before it saves the page.',
      when: () => hasChildren(p) === 'Yes' && !anyChildRow(p),
    },
    {
      page: TRAVEL_DOC,
      label: 'Green Card',
      reason: 'fill_yourself',
      note: GREEN_CARD_NOTE,
      when: () => greenCard(p) === 'Yes',
    },
    ...(
      [
        [
          'TWN',
          'Taiwan passport',
          'Answer whether your passport was issued by the Ministry of Foreign Affairs and shows your personal identification number (and enter that number).',
          () => yesOnlyWithRow(taiwanPassport(p), !!taiwanPersonalId(p)),
        ],
        [
          'ISR',
          'Israeli passport',
          'Answer whether your passport is a national Israeli passport.',
          () => passportOf('ISR', 'israeli_national_passport')(p),
        ],
        [
          'ROU',
          'Romanian passport',
          'Answer whether your passport is an electronic passport (e-passport).',
          () => passportOf('ROU', 'romanian_electronic_passport')(p),
        ],
      ] as const
    ).map(([iso3, label, note, answer]) => ({
      page: TRAVEL_DOC,
      label,
      reason: 'fill_yourself' as const,
      note,
      when: () => nationality(p) === iso3 && !answer(),
    })),
    {
      page: TRAVEL_DOC,
      label: 'Travel document',
      reason: 'fill_yourself',
      note: `Your passport is recorded as "${pickText(p, 'passport_type')}", not a regular passport: choose the kind of passport yourself, then enter its details.`,
      when: () =>
        !!pickText(p, 'passport_number') &&
        !regularPassport(p) &&
        !notPassportDocument(p),
    },
    {
      page: TRAVEL_DOC,
      label: 'Travel document',
      reason: 'fill_yourself',
      note: (() => {
        const kind = notPassportDocument(p);
        const facts = [
          pickText(p, 'passport_number') &&
            `its number ${pickText(p, 'passport_number')}`,
          pickDate(p, 'passport_issue_date') &&
            `issued ${pickDate(p, 'passport_issue_date')}`,
          pickDate(p, 'passport_expiry_date') &&
            `expires ${pickDate(p, 'passport_expiry_date')}`,
        ].filter(Boolean);
        const option = otherDocumentOption(p);
        if (option) {
          const issuer = otherDocumentIssuer(p);
          return `The assistant chose "Other" as the type of travel document and "${option}"${issuer ? `, issued by ${displayCountry(issuer)}` : ''}. ${issuer ? '' : 'Choose the country or authority that issued it yourself. '}Enter the document's details yourself${facts.length ? `: ${facts.join(', ')}` : ''}.`;
        }
        return `Your travel document is recorded as "${kind}", not a passport: choose "Other" as the type of travel document yourself, then enter what document it is and who issued it${facts.length ? `, and ${facts.join(', ')}` : ''}.`;
      })(),
      when: () => !!notPassportDocument(p),
    },
    {
      // A 17-year-old: /minors-guardian is for 16 or under (mapped), and
      // whether IRCC asks them about a custodian was never recorded.
      page: BIO,
      label: 'Applicant under 18',
      reason: 'fill_yourself',
      note: 'IRCC may ask an applicant under 18 about their custodian in Canada and the parent or guardian they travel with. The assistant does not fill those questions: answer them yourself.',
      when: () => {
        const age = ageOn(p);
        return age !== undefined && age < 18 && !sixteenOrUnder(p);
      },
    },
    {
      page: MEDICAL_TB,
      label: 'Close contact with a person with tuberculosis',
      reason: 'needs_your_answer',
      note: `IRCC asks a child aged 5 or under about close contact with tuberculosis in the last 2 years (then testing, result and treatment), and everyone older about the last 5 years. Answer the question IRCC shows yourself.${youngChildTbAnswers(p)}`,
      when: () =>
        maybeYoungChild(p) &&
        !surelyFiveOrUnder(p) &&
        !exclude.has('tuberculosis_contact'),
    },
    {
      page: MEDICAL_TB,
      label:
        'Close contact with a person with tuberculosis in the last 5 years',
      reason: 'needs_your_answer',
      when: () =>
        !maybeYoungChild(p) &&
        !exclude.has('tuberculosis_contact') &&
        declared(p, 'tuberculosis_contact', ...TB_CONTACT_KEYS) === undefined,
    },
    {
      page: LANGUAGE,
      label: 'Native language',
      ...((): Pick<ManualFieldNote, 'reason' | 'note'> => {
        const raw = pickText(
          p,
          'native_language',
          'mother_tongue',
          'first_language',
        )?.trim();
        if (!raw) return { reason: 'not_in_profile' };
        const kinds = languageVariants(raw.toLowerCase());
        return {
          reason: 'fill_yourself',
          note:
            kinds.length > 1
              ? `IRCC lists several kinds of ${raw} (${kinds.join('; ')}): choose yours.`
              : `IRCC takes one language from its list, or "Other" with a single word typed in; "${raw}" is neither: choose it yourself.`,
        };
      })(),
      when: () => !nativeLanguage(p) && !exclude.has('native_language'),
    },
    {
      page: GROUP,
      label: 'Group application',
      reason: 'fill_yourself',
      note: 'You said you are applying as a group: choose the group type and give its name.',
      when: () => isGroupApplication(p),
    },
    {
      page: CONTACT,
      label: 'Residential address',
      reason: 'fill_yourself',
      note: 'Your mailing address differs from your home address; enter your home address.',
      when: () =>
        contactAddress(p)?.same === 'No' &&
        !manualParts(residentialAddress(p)) &&
        !otherParts(residentialAddress(p)),
    },
    {
      page: CONTACT,
      label: 'Mailing address',
      reason: 'fill_yourself',
      note: 'IRCC asks a Canadian, U.S. or Mexican address part by part (civic number, street, city, province or state, postal or ZIP code); VisaAI does not have every part: enter it yourself.',
      when: () => {
        const a = contact(p)?.address;
        return (
          !!a?.country &&
          MANUAL_ENTRY_COUNTRIES.includes(a.country) &&
          !manualParts(a)
        );
      },
    },
    {
      page: CONTACT,
      label: 'Mailing address',
      reason: 'fill_yourself',
      note: 'Your home address was entered as your mailing address: answer whether your mail goes to that same address, and change it if not.',
      when: () => {
        const c = contactAddress(p);
        return !!c && c.same === undefined;
      },
    },
    {
      page: EMAIL,
      label: 'Email address',
      reason: 'not_in_profile',
      when: () => !applicantEmail(p),
    },
    {
      page: TELEPHONE,
      label: 'Telephone number',
      reason: applicantPhone(p) ? 'fill_yourself' : 'not_in_profile',
      note: 'Entered for you only with its type (cell, home, other) and a country code: write the number with +code, or record your country of residence.',
      when: () => !applicantPhoneRow(p),
    },
    ...extraPhones(p).flatMap((e, i): ManualFieldNote[] => {
      const n = i + 2;
      const written = n <= MAX_EXTRA_PHONES + 1 && !!extraPhoneRow(p, n);
      if (written) return [];
      return [
        {
          page: TELEPHONE,
          label: `Telephone ${n}`,
          reason: 'fill_yourself',
          note: `Add ${e.raw} yourself as another telephone row${
                !applicantPhoneRow(p)
                  ? ''
                  : n > MAX_EXTRA_PHONES + 1
                    ? ` (the assistant adds up to ${MAX_EXTRA_PHONES + 1} numbers)`
                    : !e.type
                      ? ' with its type (cell, home or other)'
                      : ' with its country code'
              }.`,
        },
      ];
    }),
    {
      page: CONTACT,
      label: 'Countries of residence',
      // A status we know but do not write yet (gated, see RESIDENCE_WRITTEN)
      // is the applicant's to enter, from the values in the note.
      reason: residenceAnswers(p)?.status ? 'fill_yourself' : 'not_in_profile',
      note: residenceRowNote(p),
      when: () => !residence(p),
    },
    {
      page: CONTACT,
      label: 'Earlier countries of residence',
      reason: earlierResidenceLines(p)?.length ? 'fill_yourself' : 'not_in_profile',
      note: (() => {
        const lines = earlierResidenceLines(p) ?? [];
        return lines.length
          ? `Add a residence row for each country you lived in during the past 5 years (leave "This is where I currently live" unticked and enter the date you left): ${lines.join('; ')}.`
          : 'Add a row for each country you lived in for more than 6 months in the past 5 years: country, your status there, from and to (leave "This is where I currently live" unticked).';
      })(),
      when: () => earlierResidenceLines(p) !== undefined,
    },
    {
      page: CONTACT,
      label: 'Residence — past 5 years',
      reason: 'fill_yourself',
      note: (() => {
        const gaps = residenceCoverage(p);
        const since = pickDate(p, 'date_of_birth');
        const window =
          since && monthNo(since) > monthNo(thisMonth()) - 60
            ? 'since birth'
            : 'for the past 5 years';
        return `IRCC needs where you lived ${window}. No residence row covers ${gaps
          .map((g) => `from ${g}`)
          .join(' and ')}: add the country (or countries) you lived in then, with your status and dates — the page won't save until those months are covered.`;
      })(),
      when: () => residenceCoverage(p).length > 0,
    },
    {
      page: PURPOSE,
      label: 'Transit',
      reason: 'fill_yourself',
      note: 'You are passing through Canada: choose "Transit" under "I want to apply for" yourself and answer the questions IRCC then shows. The assistant does not fill a transit application, so it left this page for you.',
      when: () => isTransit(p),
    },
    {
      ...noHostNote(p),
      when: () => {
        // Live 2026-10-31: the tourist (470) flow has no /inviter-info page
        // (/finances → /activities), so a tourist is told nothing about it.
        if (visaPurposeOption(p) === 'Tourism') return false;
        // Visiting someone whose name is missing is not "no host": the
        // inviter notes ask for the host instead.
        if (declared(p, 'family_in_destination') === 'Yes') return false;
        const host = pick(p, 'inviter', 'host', 'host_in_canada');
        if (host && typeof host === 'object') return false;
        const n = inviterName(p);
        return !(
          n.family ||
          n.given ||
          pickText(inviter(p), 'organization') ||
          pickText(p, 'business_contact_name', 'canadian_business_name')
        );
      },
    },
    {
      page: ACTIVITIES,
      label: 'Work history (past 10 years, no gaps)',
      reason: 'fill_yourself',
      // Listed only while the rows the assistant writes leave months of the
      // 10 years uncovered, and then by which months (live 2026-10-19: the
      // current job and both earlier periods were written while this still
      // told the applicant to add the earlier ones). A retirement that began
      // more than 10 years ago covers the whole period on its own.
      note: workHistoryNote(workCoverage),
      when: () => workCoverage.uncovered.length > 0,
    },
    {
      page: ACTIVITIES,
      label: 'Education details',
      reason: 'fill_yourself',
      note: `Answer "post-secondary education" yourself and add each school: IRCC needs at least one entry before it saves the page.${recordedList(
        'Your schools',
        educationLines(p),
      )}${recordedList(
        'Still missing',
        schoolList(p).map(
          (e, i) => `school ${i + 1}: ${schoolGaps(e).missing.join(', ')}`,
        ),
      )}`,
      // The question is left too when no complete school is added.
      when: () =>
        declared(
          p,
          'has_post_secondary_education',
          'post_secondary_education',
        ) === 'Yes' && !anyEducationRow(p),
    },
    {
      // "Yes" (a declaration, written as answered) reveals the service table;
      // listed when no complete period is added for it.
      page: ACTIVITIES,
      label: 'Military or police service details',
      reason: 'fill_yourself',
      note: `Add each period of service (where stationed, country, from, to, and your unit, rank and duties): IRCC needs at least one entry before it saves the page.${recordedList(
        'Still missing',
        serviceList(p).map(
          (e, i) => `period ${i + 1}: ${serviceGaps(e).missing.join(', ')}`,
        ),
      )}`,
      when: () => militaryService(p) === 'Yes' && !anyServiceRow(p),
    },
    {
      page: FINANCES,
      label: 'Someone else is giving you money for the trip',
      reason: 'fill_yourself',
      note: `VisaAI could not tell from "${payerText(p) ?? ''}" whether someone else pays: answer it yourself, and if Yes, say who and how.`,
      when: () => !!payerText(p) && fundsShared(p) === undefined,
    },
    {
      page: TRAVEL_HISTORY,
      label: 'Trips in the past 5 years',
      reason: 'fill_yourself',
      note: 'Answer the question and add each trip.',
      when: () =>
        noTravel5y(p) === undefined &&
        !anyTripRow(p) &&
        declared(p, 'travelled_last_5_years') !== 'No',
    },
    {
      page: VALIDITY,
      label: 'Refusal, denied entry or removal details',
      reason: 'fill_yourself',
      when: () => refusedOrOrderedToLeave(p) === 'Yes' && !refusalDetails(p),
    },
    {
      page: FAMILY,
      label: 'Spouse or partner details',
      reason: 'fill_yourself',
      when: () => {
        const s = maritalStatus(p);
        return s === 'Common-Law';
      },
    },
    {
      // Divorced / separated / annulled / widowed: IRCC requires the former
      // or late spouse's block (live 2026-10-31); what VisaAI lacks is named.
      page: FAMILY,
      label: 'Former or late spouse',
      reason: 'not_in_profile',
      note: `Add ${previousSpouseGaps(p).join(', ')}.`,
      when: () => unionEnded(p) && previousSpouseGaps(p).length > 0,
    },
    {
      page: FAMILY,
      label: "Spouse's occupation",
      reason: 'fill_yourself',
      note: 'Choose the occupation group.',
      when: () => maritalStatus(p) === 'Married' && !spouseOccupationOption(p),
    },
    {
      page: PARENTS,
      label: "Parents' details",
      reason: 'not_in_profile',
      note: 'Add each parent: name, date of birth, country of birth, occupation, address and whether they are coming.',
      when: () => parentList(p).length === 0,
    },
    {
      page: INVITER,
      label: "Inviter's address",
      reason: 'not_in_profile',
      note: 'Not recorded as a full Canadian address (number, street, city, province, postal code).',
      when: () => {
        // Any inviter the fill writes: a person, an organization, or the
        // business variant's contact (review of 4a13b7cb).
        const n = inviterName(p);
        const any =
          n.family ||
          n.given ||
          pickText(inviter(p), 'organization') ||
          pickText(p, 'business_contact_name');
        return !!any && !inviterAddress(p);
      },
    },
    {
      // "Yes" reveals the second inviter's block; what VisaAI does not have
      // about that person is the applicant's to add.
      page: INVITER,
      label: 'Second inviter',
      reason: 'fill_yourself',
      note: `Add their ${secondInviterGaps(p).join('; ')}.`,
      when: () => hasSecondInviter(p) && secondInviterGaps(p).length > 0,
    },
  ];
  childList(p).forEach((c, i) => {
    if (i >= MAX_CHILDREN) {
      notes.push({
        page: CHILDREN,
        label: `Child ${i + 1}`,
        reason: 'fill_yourself',
      });
      return;
    }
    const { missing } = childGaps(c, p);
    if (missing.length)
      notes.push({
        page: CHILDREN,
        label: `Child ${i + 1}`,
        reason: 'not_in_profile',
        note: `Add this child yourself — missing: ${missing.join(', ')}.`,
      });
  });
  parentList(p).forEach((c, i) => {
    if (i >= MAX_PARENTS) {
      // IRCC's table takes more rows (and only Father / Mother); the
      // assistant adds two (matrix C row 47).
      const who = pickText(c, 'name', 'full_name');
      const role = pickText(c, 'relationship', 'relation', 'role');
      notes.push({
        page: PARENTS,
        label: `Parent ${i + 1}`,
        reason: 'fill_yourself',
        note: `The assistant adds up to ${MAX_PARENTS} parents; add ${who ? `${who}${role ? ` (${role})` : ''}` : 'this parent'} yourself if IRCC should list them.`,
      });
      return;
    }
    const { missing } = parentGaps(c, p);
    if (missing.length)
      notes.push({
        page: PARENTS,
        label: `Parent ${i + 1}`,
        reason: 'not_in_profile',
        note: `Add this parent yourself — missing: ${missing.join(', ')}.`,
      });
  });
  const trips = tripList(p);
  trips.forEach((_, i) => {
    const gaps = tripGaps(trips, i);
    if (gaps.repeat) return; // its place and purpose are on the first one's row
    if (i >= MAX_TRIPS) {
      notes.push({
        page: TRAVEL_HISTORY,
        label: `Trip ${i + 1}`,
        reason: 'not_in_profile',
        note: `The assistant adds up to ${MAX_TRIPS} trips; add this one yourself.`,
      });
      return;
    }
    const { missing, overflow } = gaps;
    const refused = overflow
      ? ` IRCC's fields take at most ${TRIP_PLACE_MAX} characters for the place and ${TRIP_PURPOSE_MAX} for the purpose, in English or French letters, digits and common punctuation; not entered: ${overflow.join(', ')}.`
      : '';
    if (missing.length)
      notes.push({
        page: TRAVEL_HISTORY,
        label: `Trip ${i + 1}`,
        reason: 'not_in_profile',
        note: `Add this trip yourself — missing: ${missing.join(', ')}.${refused}`,
      });
    else if (overflow)
      notes.push({
        page: TRAVEL_HISTORY,
        label: `Trip ${i + 1}`,
        reason: 'fill_yourself',
        note: `The assistant adds this trip without part of its text.${refused} Shorten it and add it to the row yourself if you want it in.`,
      });
  });
  earlierWorkPeriods(p).forEach((e, i) => {
    const gaps = workRowGaps(e);
    if (gaps.study) {
      notes.push({
        page: ACTIVITIES,
        label: `Earlier work period ${i + 1}`,
        reason: 'not_in_profile',
        note: 'This period was studies: IRCC records it under post-secondary education on this page, not as a work-history activity. Add your studies under post-secondary education yourself.',
      });
      return;
    }
    if (i >= MAX_WORK_ROWS) {
      notes.push({
        page: ACTIVITIES,
        label: `Earlier work period ${i + 1}`,
        reason: 'fill_yourself',
        note: `The assistant adds up to ${MAX_WORK_ROWS} earlier periods; add this one to your work history yourself.`,
      });
      return;
    }
    if (gaps.missing.length)
      notes.push({
        page: ACTIVITIES,
        label: `Earlier work period ${i + 1}`,
        reason: 'not_in_profile',
        note: `Add this period to your work history yourself — missing: ${gaps.missing.join(', ')}.${unwrittenGap(e, workCoverage.uncovered)}`,
      });
  });
  // Schools and service periods past the first complete one: each
  // incomplete (or over the cap) entry is listed. With no complete entry the
  // page-level note above covers them.
  if (anyEducationRow(p))
    schoolList(p).forEach((e, i) => {
      const { missing } =
        i < MAX_SCHOOLS ? schoolGaps(e) : { missing: ['(add it yourself)'] };
      if (missing.length)
        notes.push({
          page: ACTIVITIES,
          label: `School ${i + 1}`,
          reason: 'not_in_profile',
          note: `Add this school yourself — missing: ${missing.join(', ')}.${recordedList('Recorded', [educationLine(e)].filter(Boolean))}`,
        });
    });
  if (militaryService(p) === 'Yes' && anyServiceRow(p))
    serviceList(p).forEach((e, i) => {
      const { missing } =
        i < MAX_SERVICE_ROWS
          ? serviceGaps(e)
          : { missing: ['(add it yourself)'] };
      if (missing.length)
        notes.push({
          page: ACTIVITIES,
          label: `Military or police service ${i + 1}`,
          reason: 'not_in_profile',
          note: `Add this period yourself — missing: ${missing.join(', ')}.`,
        });
    });
  otherNameList(p).forEach((v, i) => {
    const { missing } =
      i < MAX_OTHER_NAMES
        ? otherNameGaps(v)
        : { missing: ['(add it yourself)'] };
    if (missing.length)
      notes.push({
        page: OTHER_NAMES,
        label: `Other name ${i + 1}`,
        reason: 'not_in_profile',
        note: `Add this name yourself — missing: ${missing.join(', ')}.`,
      });
  });
  const job = currentJob(p);
  if (job.missing.length)
    notes.push({
      page: ACTIVITIES,
      label: 'Current job',
      reason: 'not_in_profile',
      note: `Add your current job yourself — missing: ${job.missing.join(', ')}.`,
    });
  if (isRetired(p) && !retiredRow(p))
    notes.push({
      page: ACTIVITIES,
      label: 'Retirement period',
      reason: 'not_in_profile',
      note: 'Retirement date or home address not recorded.',
    });
  if (
    pickText(p, 'ircc_medical_exam_number', ...MEDICAL_NUMBER_KEYS) &&
    !medicalExamNumber(p)
  )
    notes.push({
      page: MEDICAL_EXAM,
      label: 'Medical exam IME/UMI number',
      reason: 'fill_yourself',
      note: "The number VisaAI has is not in a format IRCC accepts (IME: digits only; UMI: 2 letters and 8 or 9 digits, or U and 9 digits). Copy it from your panel physician's confirmation.",
    });
  if (declared(p, 'medical_exam_last_12_months', 'ircc_medical_exam_last_12_months', 'had_immigration_medical_exam') === 'No') {
    const shown = workMedicalJobsShown(p);
    const said = declared(p, ...WORK_MEDICAL_JOBS_KEYS);
    if (shown === 'unsure' || (shown === 'shown' && !said))
      notes.push({
        page: MEDICAL_EXAM,
        label: 'Work in a job where public health must be protected',
        reason: said ? 'fill_yourself' : 'needs_your_answer',
        note: `${shown === 'unsure' ? 'If IRCC asks' : 'IRCC asks'} whether you intend to work in Canada in a job where public health must be protected (for example health care, clinical laboratories, child care, primary or secondary schools, in-home caregiving or agriculture). ${said ? `Your answer: ${said}.` : 'Answer it yourself.'}`,
      });
  }
  if (isUnemployed(p) && !unemployedRow(p) && !ongoingNoJobFrom(p, 'Unemployed'))
    notes.push({
      page: ACTIVITIES,
      label: 'Period without work',
      reason: 'not_in_profile',
      note: 'Add an ongoing "Unemployed" period to your work history: the month and year it began and your home address. IRCC will not save the page without the last 10 years covered.',
    });
  if (isHomemaker(p) && !homemakerRow(p))
    notes.push({
      page: ACTIVITIES,
      label: 'Homemaker period',
      reason: 'not_in_profile',
      note: 'Add an ongoing "Homemaker" period to your work history: the month and year it began (or the date you stopped your last job) and your home address. IRCC will not save the page without the last 10 years covered.',
    });
  // Pages (and the work and military parts of /activities) IRCC does not
  // show this child: nothing there is theirs to fill. Education notes stay.
  return notes.filter((n) => {
    if (n.when && !n.when(p)) return false;
    const hidden = hiddenFor(
      n.page,
      n.page === ACTIVITIES && /^(School|Education)\b/.test(n.label)
        ? 'has_post_secondary_education'
        : undefined,
    );
    return !hidden?.(p);
  });
}

registerPortalFill('ircc', IRCC_MAPPING, {
  pages: IRCC_PAGES,
  left: leftForApplicant,
});
