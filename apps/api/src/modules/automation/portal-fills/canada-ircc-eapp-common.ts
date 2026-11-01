import type {
  FillFieldMapping,
  ManualFieldNote,
  PortalPageInfo,
} from '../../../strategies/portal-integration/portal-fill.registry';
import { intakeAnswerIsYes } from '@visaai/types';
import {
  declared,
  pick,
  pickDate,
  pickText,
  type Profile,
} from './ircc-profile';
import { toIso3 } from './country-names';
import { etaCountryCodeOption } from './eta-options';
import { ETA_PLACE_OPTIONS } from './eta-country-lists';

/**
 * What the IRCC secure account's eligibility questionnaire ("eapp",
 * /eapp/eapp) asks EVERY applicant, whichever permit they choose on its
 * first screen: shared by the study permit ('ircc-study',
 * canada-ircc-study-eapp.ts, recorded live 2026-10-20) and the work permit
 * ('ircc-work', canada-ircc-work-eapp.ts, recorded live 2026-10-30).
 *
 * Extracted from the study mapping unchanged (2026-10-30). Every entry
 * factory here returns exactly the entry the study mapping had before, and
 * test/ircc-study-eapp-unchanged.spec.ts holds the study mapping's output
 * byte for byte: a consultant's locked review hashes those writes. Change a
 * shared entry only on purpose, for both permits.
 *
 * The portal facts (one URL for every screen, one reused id `answerlist[0]`,
 * 991 Yes / 997 No, question-scoped selectors, stop at "Review your answers")
 * are described in canada-ircc-study-eapp.ts.
 */

/** The path the extension reports for every questionnaire screen. */
export const EAPP_PAGE = '/eapp/eapp';

export const EAPP_PAGES: PortalPageInfo[] = [
  {
    page: EAPP_PAGE,
    title: 'Eligibility questionnaire (secure account)',
    progressive: true,
  },
];

export const YES = '991';
export const NO = '997';

/** select#answerlist[N] — the id has brackets, so it is named by attribute. */
export const listId = (n: number) => `select[id="answerlist[${n}]"]`;
/** A one-question screen: the question's own select, whichever index it has. */
export const ANY_SELECT = 'select[id^="answerlist["]';

type Category = FillFieldMapping['category'];
type Extra = Partial<
  Pick<
    FillFieldMapping,
    'parent' | 'parentValue' | 'declaration' | 'transform' | 'pageMatch' | 'op'
  >
>;

/** A questionnaire select answered by option value (a recorded code). */
export function ask(
  profileKey: string,
  css: string,
  question: RegExp | undefined,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page: EAPP_PAGE,
    profileKey,
    selector: css,
    action: 'select',
    label,
    category,
    derive,
    ...(question ? { labelMatch: question } : {}),
    ...extra,
  };
}

export const yesNo = (v: 'Yes' | 'No' | undefined) =>
  v === 'Yes' ? YES : v === 'No' ? NO : undefined;

export const fact =
  (...keys: string[]) =>
  (p: Profile) =>
    yesNo(declared(p, ...keys));

// ── the applicant's answers ─────────────────────────────────────────────────
const DOB_KEYS = ['date_of_birth', 'dob', 'birth_date'];
const dateOfBirth = (p: Profile) => pickDate(p, ...DOB_KEYS);

/** The passport's code-list option ("PAK (Pakistan)"), from its country. */
function passportCodeOption(p: Profile): string | undefined {
  for (const k of [
    'passport_country',
    'passport_issuing_country',
    'passport_nationality',
    'nationality',
    'citizenship',
    'country_of_citizenship',
    'applicant_citizenship',
    'applicant_nationality',
  ]) {
    const v = pickText(p, k);
    if (!v) continue;
    return etaCountryCodeOption(v) ?? undefined;
  }
  return undefined;
}

/** "Pakistan (citizen)", "Pakistan, citizen" → PAK. */
function residenceIso(p: Profile): string | undefined {
  const v = pickText(
    p,
    'country_of_residence',
    'current_country_of_residence',
    'residence_country',
  );
  if (!v) return undefined;
  return toIso3(v) ?? toIso3(v.split(/[,(;–—-]/)[0]?.trim() ?? '') ?? undefined;
}

/**
 * The residence list names countries plainly ("Pakistan"). The eTA place
 * list is IRCC's country list too; the UK is named by nation there, so a UK
 * resident is left to choose.
 */
const residenceOption = (p: Profile) => {
  const iso = residenceIso(p);
  return iso ? ETA_PLACE_OPTIONS[iso] : undefined;
};

/** Province / territory codes (PAL province and destination, recorded live). */
const PROVINCE_CODES: ReadonlyArray<[RegExp, string]> = [
  [/^(ab|alberta)$/, '2720'],
  [/^(bc|british columbia)$/, '2721'],
  [/^(mb|manitoba)$/, '2722'],
  [/^(nb|new brunswick)$/, '2726'],
  [/^(nl|newfoundland( and labrador)?)$/, '2719'],
  [/^(nt|northwest territories)$/, '2727'],
  [/^(ns|nova scotia)$/, '2725'],
  [/^(nu|nunavut)$/, '2735'],
  [/^(on|ont|ontario)$/, '2731'],
  [/^(pe|pei|prince edward island)$/, '2730'],
  [/^(qc|que|quebec)$/, '2732'],
  [/^(sk|saskatchewan)$/, '2733'],
  [/^(yt|yukon)$/, '2734'],
];
export const QUEBEC = '2732';

export function provinceCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return PROVINCE_CODES.find(([re]) => re.test(s))?.[1];
}

const MARITAL_CODES: ReadonlyArray<[RegExp, string]> = [
  [/common[- ]?law/, '2956'],
  [/separated/, '2951'],
  [/divorced/, '2953'],
  [/annul/, '4678'],
  [/widow/, '2954'],
  [/never married|single|unmarried/, '4677'],
  [/married/, '2952'],
];

export function maritalCode(p: Profile): string | undefined {
  const s = pickText(p, 'marital_status', 'civil_status')?.toLowerCase();
  if (!s) return undefined;
  return MARITAL_CODES.find(([re]) => re.test(s))?.[1];
}

/**
 * "Do you have a valid work permit or study permit, and need a visa to
 * return?" 7225 = No (this question's own "No", not 997). Answered "No" only
 * for someone who has never applied to Canada (so cannot hold a permit) or
 * who said so.
 */
function validPermit(p: Profile): string | undefined {
  const said = declared(
    p,
    'has_valid_canadian_permit',
    'valid_canadian_permit',
    'holds_canadian_permit',
  );
  if (said === 'No') return '7225';
  if (said === 'Yes') return undefined; // which permit: not seen live
  return declared(
    p,
    'previous_canada_application',
    'previously_applied_to_canada',
  ) === 'No'
    ? '7225'
    : undefined;
}

/** The keys a family member's status in Canada is stored under. */
export const FAMILY_STATUS_KEYS = [
  'family_member_status_in_canada',
  'accompanying_family_member_with_status',
  'family_member_worker_or_student_in_canada',
] as const;

/** Both family-status questions are "No" only when the applicant said so. */
export const familyStatusNo = (p: Profile) =>
  declared(p, ...FAMILY_STATUS_KEYS) === 'No' ? NO : undefined;

/**
 * The four parts of IRCC's one criminality question, each with the keys the
 * interview (IRCC_PORTAL_FACTS: committed_crime, ever_arrested, ever_charged,
 * ever_convicted) and older answers store it under.
 */
const CRIME_PARTS: ReadonlyArray<readonly string[]> = [
  [
    'committed_crime',
    'committed_criminal_offence',
    'committed_criminal_offense',
    'crime_committed',
  ],
  ['ever_arrested', 'arrested', 'been_arrested'],
  ['ever_charged', 'been_charged', 'criminal_charges', 'charged_with_crime'],
  [
    'ever_convicted',
    'been_convicted',
    'convicted_of_crime',
    'criminal_conviction',
    'criminal_convictions',
    'criminal_record',
  ],
];
/**
 * "Any criminal charges or convictions?" — a "yes" is a yes to some part; a
 * "no" covers being arrested, charged or convicted, never whether an offence
 * was committed (that still needs `committed_crime`). Read after each part's
 * own keys, so the part's own answer wins.
 */
const CRIME_COMBINED = 'criminal_charges_or_convictions';
const crimeParts = (): ReadonlyArray<readonly string[]> =>
  CRIME_PARTS.map((part, i) => (i === 0 ? part : [...part, CRIME_COMBINED]));

/**
 * "Have you ever committed, been arrested for, been charged with, or
 * convicted of any criminal offence in any country?" — ONE question for four
 * parts. An explicit "yes" to any part is "Yes" (991). "No" (997) only when
 * the applicant explicitly said no to EVERY part: a "no" to committing an
 * offence says nothing about an arrest or a charge. Anything else is left
 * for the applicant.
 */
export function criminality(p: Profile): string | undefined {
  const keys = [...CRIME_PARTS.flat(), CRIME_COMBINED];
  if (keys.some((k) => intakeAnswerIsYes(p[k]) === true)) return YES;
  return crimeParts().every((part) => declared(p, ...part) === 'No')
    ? NO
    : undefined;
}

const hasSpouse = (p: Profile) => {
  const c = maritalCode(p);
  return c === '2952' || c === '2956';
};

/** No family member applies with them: no spouse or one staying, no child coming. */
function familyApplication(p: Profile): string | undefined {
  const spouseComing = declared(
    p,
    'spouse_coming_to_canada',
    'spouse_accompanying',
    'spouse_travelling',
  );
  if (spouseComing === 'Yes') return undefined;
  if (hasSpouse(p) && spouseComing !== 'No') return undefined;
  if (!maritalCode(p)) return undefined;
  const kids = pick(p, 'children_accompanying');
  const noKids =
    declared(p, 'has_children') === 'No' ||
    (Array.isArray(kids) && kids.length === 0) ||
    (typeof kids === 'string' && /^(none|no|nobody|\[\])$/i.test(kids.trim()));
  return noKids ? NO : undefined;
}

export const REP_KEYS = [
  'uses_representative',
  'has_representative',
  'using_representative',
  'uses_authorized_representative',
];
const RELEASE_KEYS = [
  'authorize_release_of_information',
  'release_of_information',
  'designated_individual',
];

/**
 * "Are you giving someone access to your application?" — 7343 No only when
 * the applicant has no representative and did not name anyone to receive
 * their information. A "Yes" (appoint, release of information or both) is
 * theirs to choose.
 */
function representativeAccess(p: Profile): string | undefined {
  if (declared(p, ...REP_KEYS) !== 'No') return undefined;
  if (declared(p, ...RELEASE_KEYS) === 'Yes') return undefined;
  return 'No';
}

// ── the shared entries (each a fresh object, exactly as the study had it) ──
const DOB_SCREEN = /what is your date of birth/;

/** Screen 1: "What would you like to do in Canada?" — the permit's own code. */
export const purposeEntry = (code: string, label: string) =>
  ask(
    'eapp_purpose',
    listId(1),
    /what would you like to do in canada/,
    label,
    'dates',
    () => code,
  );

/** Screen 1: the length of stay (7346 < 6 months, 7347 > 6 months). */
export const stayLengthEntry = (derive: (p: Profile) => unknown) =>
  ask(
    'eapp_stay_length',
    listId(2),
    /how long are you planning to stay in canada/,
    'How long are you planning to stay in Canada?',
    'dates',
    derive,
  );

export const familyMemberCitizenOrPrEntry = () =>
  ask(
    'eapp_family_member_citizen_or_pr',
    listId(5),
    /family member who is a canadian citizen or permanent resident/,
    'Family member (18+) who is a Canadian citizen or permanent resident',
    'passport',
    fact(
      'family_member_canadian_status',
      'family_member_canadian_citizen_or_pr',
      'relative_in_canada',
    ),
  );

export const dobMonthEntry = () =>
  ask(
    'date_of_birth',
    listId(8),
    undefined,
    'Date of birth — month',
    'passport',
    dateOfBirth,
    { transform: 'eapp_month', pageMatch: DOB_SCREEN },
  );

export const passportCodeEntry = () =>
  ask(
    'eapp_passport_code',
    listId(3),
    /select the code that matches the one on your passport/,
    'Passport code',
    'passport',
    passportCodeOption,
    { op: 'select_text' },
  );

export const countryOfResidenceEntry = () =>
  ask(
    'eapp_country_of_residence',
    listId(4),
    /current country or territory of residence/,
    'Current country or territory of residence',
    'addresses',
    residenceOption,
    { op: 'select_text' },
  );

export const dobYearEntry = () =>
  ask(
    'date_of_birth',
    listId(7),
    undefined,
    'Date of birth — year',
    'passport',
    dateOfBirth,
    { op: 'select_text', transform: 'date_year', pageMatch: DOB_SCREEN },
  );

export const dobDayEntry = () =>
  ask(
    'date_of_birth',
    listId(9),
    undefined,
    'Date of birth — day',
    'passport',
    dateOfBirth,
    { op: 'select_text', transform: 'date_day', pageMatch: DOB_SCREEN },
  );

export const usPermanentResidentEntry = () =>
  ask(
    'eapp_us_permanent_resident',
    ANY_SELECT,
    /lawful permanent resident of the united states/,
    'Lawful permanent resident of the United States',
    'passport',
    fact(
      'us_permanent_resident',
      'is_us_permanent_resident',
      'us_lawful_permanent_resident',
      'has_us_green_card',
      'us_green_card',
    ),
  );

export const maritalStatusEntry = () =>
  ask(
    'eapp_marital_status',
    ANY_SELECT,
    /what is your marital status/,
    'Marital status',
    'passport',
    maritalCode,
  );

export const destinationProvinceEntry = (derive: (p: Profile) => unknown) =>
  ask(
    'eapp_destination_province',
    ANY_SELECT,
    /province or territory of destination/,
    'Province or territory of destination',
    'addresses',
    derive,
  );

export const validPermitEntry = () =>
  ask(
    'eapp_valid_permit',
    ANY_SELECT,
    /valid work permit or study permit, and need a visa to return/,
    'Valid work or study permit and need a visa to return',
    'travel_history',
    validPermit,
  );

export const familyOfWorkerOrStudentEntry = (
  derive: (p: Profile) => unknown = familyStatusNo,
) =>
  ask(
    'eapp_family_of_worker_or_student',
    ANY_SELECT,
    /spouse, common-law partner or child of certain skilled worker/,
    'Spouse, partner or child of a skilled worker or full-time student in Canada',
    'travel_history',
    derive,
  );

export const accompanyingFamilyMemberEntry = (
  derive: (p: Profile) => unknown = familyStatusNo,
) =>
  ask(
    'eapp_accompanying_family_member',
    ANY_SELECT,
    /accompanying a family member that has status in canada/,
    'Accompanying a family member with status in Canada',
    'travel_history',
    derive,
  );

/** From the criminality question to biometrics: identical for every permit. */
export const declarationsTail = (): FillFieldMapping[] => [
  ask(
    'eapp_criminality',
    ANY_SELECT,
    /committed, been arrested for, been charged with, or convicted of any criminal offen[cs]e/,
    'Committed, arrested, charged or convicted of a criminal offence',
    'travel_history',
    criminality,
    { declaration: true },
  ),
  ask(
    'eapp_medical_exam_12_months',
    ANY_SELECT,
    /medical exam performed by an ircc authori[sz]ed panel physician/,
    'Medical exam by an IRCC panel physician in the last 12 months',
    'travel_history',
    fact(
      'medical_exam_last_12_months',
      'ircc_medical_exam_last_12_months',
      'had_immigration_medical_exam',
    ),
    { declaration: true },
  ),
  ask(
    'eapp_designated_country',
    ANY_SELECT,
    /visited or lived in any one of the designated countries/,
    'Lived in or visited a designated country for 6 months in the last year',
    'travel_history',
    fact('designated_country_six_months', 'lived_in_designated_country'),
    { declaration: true },
  ),
  ask(
    'eapp_family_member_application',
    ANY_SELECT,
    /submit an application for a family member/,
    'Submit an application for a family member',
    'travel_history',
    familyApplication,
  ),
  {
    page: EAPP_PAGE,
    profileKey: 'eapp_representative_access',
    // Radio answerList[0].value: 7340 appoint, 7341 release, 7342 both, 7343 No.
    selector: 'input[name="answerList[0].value"]',
    choices: {
      No: 'input[type="radio"][name="answerList[0].value"][value="7343"]',
    },
    pageMatch: /are you giving someone access to your application/,
    action: 'select',
    op: 'radio',
    label: 'Giving someone access to your application',
    category: 'travel_history',
    derive: representativeAccess,
  },
  ask(
    'eapp_biometrics',
    ANY_SELECT,
    /given your fingerprints and photo \(biometrics\)/,
    'Biometrics given for a Canadian application in the past 10 years',
    'travel_history',
    fact(
      'biometrics_given',
      'biometrics_given_before',
      'has_given_biometrics',
      'previous_biometrics',
    ),
  ),
];

// ── what the applicant does themselves, on every permit ────────────────────
/** The information screens, the fee / copy / payment questions, the review. */
export function commonLeftNotes(): ManualFieldNote[] {
  return [
    {
      page: EAPP_PAGE,
      label: 'Information screens',
      reason: 'fill_yourself',
      note: 'Screens with only a Next button (the medical exam notice, your result, "How to apply") are yours: press Next or Continue yourself. The assistant fills each question screen when it opens.',
    },
    {
      page: EAPP_PAGE,
      label: 'Application fees: paying or fee-exempt',
      reason: 'fill_yourself',
    },
    {
      page: EAPP_PAGE,
      label: 'Making digital copies of your documents',
      reason: 'fill_yourself',
    },
    {
      page: EAPP_PAGE,
      label: 'Paying your fees online',
      reason: 'fill_yourself',
    },
    {
      page: EAPP_PAGE,
      label: 'Review your answers, then your document checklist',
      reason: 'fill_yourself',
      note: 'The assistant stops at "Review your answers". Check every answer there; the document checklist, uploads, signature and payment are yours.',
    },
  ];
}

/** Listed when the applicant has a representative: the access choice is theirs. */
export function representativeNote(p: Profile): ManualFieldNote[] {
  return declared(p, ...REP_KEYS) === 'Yes'
    ? [
        {
          page: EAPP_PAGE,
          label: 'Giving someone access to your application',
          reason: 'needs_your_answer',
          note: 'Choose whether you appoint a representative, authorize IRCC to release information to someone, or both.',
        },
      ]
    : [];
}

/** Listed when a family member has status in Canada. */
export function familyStatusNote(p: Profile): ManualFieldNote[] {
  return declared(p, ...FAMILY_STATUS_KEYS) === 'Yes'
    ? [
        {
          page: EAPP_PAGE,
          label: 'Your family member’s status in Canada',
          reason: 'needs_your_answer',
          note: 'You said a family member has status in Canada: answer the "spouse or child of a skilled worker or student" and "accompanying a family member" questions yourself.',
        },
      ]
    : [];
}
