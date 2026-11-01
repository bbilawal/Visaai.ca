import {
  registerPortalFill,
  type FillFieldMapping,
  type ManualFieldNote,
  type PortalPageInfo,
} from '../../../strategies/portal-integration/portal-fill.registry';
import {
  contactAddress,
  declared,
  displayCountry,
  nameParts,
  parseCanadianAddress,
  people,
  pick,
  pickCountry,
  pickDate,
  pickText,
  residentialAddress,
  sentence,
  splitPlace,
  type Profile,
} from './ircc-profile';

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
const PURPOSE = '/purpose';
const BIO = '/bio-data';
const TRAVEL_DOC = '/bio-data-travel-docs';
const NATIONALITY = '/nationality';
const NATIONAL_ID = '/national-id-doc';
const OTHER_NAMES = '/other-names';
const CONTACT = '/contact-info';
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

/** Portal order (observed 2026-10-15) and the titles shown to the applicant. */
export const IRCC_PAGES: PortalPageInfo[] = [
  { page: PURPOSE, title: 'Purpose of visit' },
  { page: BIO, title: 'Personal details' },
  { page: TRAVEL_DOC, title: 'Travel document' },
  { page: NATIONALITY, title: 'Citizenship and places lived' },
  { page: NATIONAL_ID, title: 'National identity document' },
  { page: OTHER_NAMES, title: 'Other names' },
  { page: CONTACT, title: 'Contact information' },
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
];

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
    ...fields.map((f) => ({
      ...f,
      dialog: true,
      parent: rowKey,
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

// ── facts ───────────────────────────────────────────────────────────────────
const birthCountry = (p: Profile) =>
  pickCountry(p, 'country_of_birth', 'birth_country') ??
  splitPlace(p.place_of_birth).country;
const birthCity = (p: Profile) =>
  pickText(p, 'city_of_birth', 'birth_city', 'place_of_birth_city') ??
  splitPlace(p.place_of_birth).city;
const nationality = (p: Profile) =>
  pickCountry(p, 'nationality', 'citizenship', 'country_of_citizenship');

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

function hasNationalId(p: Profile): 'Yes' | 'No' | undefined {
  return (
    declared(p, 'has_national_id', 'has_national_identity_document') ??
    (pickText(p, 'national_id_number', 'national_id', 'cnic', 'cnic_number')
      ? 'Yes'
      : undefined)
  );
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
    if (Array.isArray(v)) return v.length === 0 ? 'No' : 'Yes';
    const yn = declared(p, k);
    if (yn) return yn;
    if (typeof v === 'string' && v.trim()) return 'Yes'; // a name
  }
  return undefined;
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

/** Valid biometrics may be re-used only while they cover the planned entry. */
function biometricsReuse(p: Profile): string | undefined {
  const until = pickDate(p, 'biometrics_valid_until', 'biometrics_expiry_date');
  const entry = pickDate(p, 'planned_entry_date');
  if (!until || !entry) return undefined;
  return until >= entry ? 'Re-use my valid biometrics' : undefined;
}

// Inviter = the host in Canada.
function inviter(p: Profile): Profile {
  const obj = pick(p, 'inviter', 'host', 'host_in_canada');
  const o =
    obj && typeof obj === 'object' && !Array.isArray(obj)
      ? (obj as Profile)
      : {};
  const flat = (k: string) =>
    pick(p, `inviter_${k}`, `host_${k}`) ?? o[k] ?? o[`${k}`];
  return {
    family_name: flat('family_name') ?? flat('last_name'),
    given_name: flat('given_name') ?? flat('first_name'),
    name: flat('name') ?? flat('full_name'),
    relationship:
      flat('relationship') ??
      pick(p, 'relationship_to_host', 'relationship_to_inviter'),
    address: flat('address'),
    phone: flat('phone') ?? flat('telephone') ?? flat('phone_number'),
    phone_type: flat('phone_type'),
    email: flat('email'),
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

function inviterRelationship(p: Profile): string | undefined {
  const r = pickText(inviter(p), 'relationship')?.toLowerCase();
  if (!r) return undefined;
  if (/friend/.test(r)) return 'Friend';
  if (/conference|event|business partner/.test(r)) return 'Conference';
  if (/organi[sz]ation|company|employer|university|school/.test(r))
    return 'Organization';
  if (
    /(brother|sister|sibling|son|daughter|child|parent|mother|father|cousin|uncle|aunt|niece|nephew|grand|spouse|wife|husband|in-law|family|relative)/.test(
      r,
    )
  )
    return 'Family member';
  return undefined;
}

const inviterAddress = (p: Profile) => parseCanadianAddress(inviter(p).address);

function inviterPhone(
  p: Profile,
): { location: string; digits: string } | undefined {
  const raw = pickText(inviter(p), 'phone');
  if (!raw) return undefined;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return undefined; // not a Canada/US number we can place
  return { location: 'Canada or the U.S.', digits: d };
}

function inviterPhoneType(p: Profile): string | undefined {
  const t = pickText(inviter(p), 'phone_type')?.toLowerCase();
  if (!t) return undefined;
  if (/cell|mobile/.test(t)) return 'Cellular';
  if (/home|residen/.test(t)) return 'Residence';
  return 'Other';
}

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
  const s = pickText(
    p,
    'financial_support',
    'financial_supporter',
    'sponsor_name',
  );
  if (!s) return undefined;
  if (
    /^(self|myself|own|own funds|personal|personal savings|applicant)$/i.test(s)
  )
    return 'No';
  return declared(p, 'financial_support') ?? 'Yes';
}

function fundsDetails(p: Profile): string | undefined {
  const explicit = pickText(
    p,
    'financial_support_details',
    'funds_details',
    'sponsor_details',
  );
  if (explicit) return explicit;
  const who = pickText(p, 'financial_supporter', 'sponsor_name');
  if (!who) return undefined;
  const rel = pickText(
    p,
    'financial_supporter_relationship',
    'sponsor_relationship',
  );
  return sentence(
    `${who}${rel ? ` (${rel})` : ''} is paying for part or all of the trip.`,
  );
}

function isRetired(p: Profile): boolean {
  if (declared(p, 'retired', 'is_retired') === 'Yes') return true;
  const s = pickText(p, 'employment_status', 'occupation', 'employed');
  return !!s && /retired/i.test(s);
}

function retiredRow(p: Profile): string | undefined {
  if (!isRetired(p)) return undefined;
  const since = pickDate(
    p,
    'retirement_date',
    'retired_since',
    'date_of_retirement',
  );
  const home = residentialAddress(p);
  if (!since || !home?.country || !home.street || !home.city) return undefined;
  return `Retired since ${since.slice(0, 7)}`;
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
];
const DENIED_ENTRY_KEYS = [
  'denied_entry',
  'refused_entry',
  'denied_entry_to_any_country',
];
const ORDERED_TO_LEAVE_KEYS = [
  'removal_orders',
  'ordered_to_leave',
  'deported',
  'removed_from_country',
];

/**
 * IRCC asks one question for three facts: refused a visa or permit, denied
 * entry, or ordered to leave any country. "Yes" when the applicant said yes to
 * any; "No" only when they said no to all three.
 */
function refusedOrOrderedToLeave(p: Profile): 'Yes' | 'No' | undefined {
  const own = declared(p, 'refused_or_ordered_to_leave');
  if (own) return own;
  const answers = [
    declared(p, ...REFUSED_KEYS),
    declared(p, ...DENIED_ENTRY_KEYS),
    declared(p, ...ORDERED_TO_LEAVE_KEYS),
  ];
  if (answers.includes('Yes')) return 'Yes';
  if (answers.every((a) => a === 'No')) return 'No';
  return undefined;
}

function refusalDetails(p: Profile): string | undefined {
  const explicit = pickText(
    p,
    'refusal_details',
    'previous_visa_refusal_details',
  );
  if (explicit) return explicit;
  if (declared(p, ...REFUSED_KEYS) !== 'Yes') return undefined;
  const country =
    displayCountry(
      pickCountry(p, 'previous_visa_refusal_country', 'refusal_country'),
    ) ?? pickText(p, 'previous_visa_refusal_country', 'refusal_country');
  const date = pickDate(p, 'previous_visa_refusal_date', 'refusal_date');
  const number = pickText(
    p,
    'previous_visa_refusal_number',
    'refusal_application_number',
    'refusal_number',
  );
  const reason = pickText(p, 'previous_visa_refusal_reason', 'refusal_reason');
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

const spouse = (p: Profile): Profile => {
  const o = pick(p, 'spouse', 'partner');
  return o && typeof o === 'object' && !Array.isArray(o) ? (o as Profile) : {};
};
const spouseNames = (p: Profile) => {
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
const spouseDob = (p: Profile) =>
  pickDate(p, 'spouse_date_of_birth', 'spouse_dob', 'spouse_birth_date') ??
  pickDate(spouse(p), 'date_of_birth', 'dob', 'birth_date');
const spouseBirthCountry = (p: Profile) =>
  pickCountry(p, 'spouse_country_of_birth', 'spouse_birth_country') ??
  splitPlace(pick(p, 'spouse_place_of_birth')).country ??
  pickCountry(spouse(p), 'country_of_birth', 'birth_country') ??
  splitPlace(spouse(p).place_of_birth).country;
function spouseOccupationOption(p: Profile): string | undefined {
  const o = (
    pickText(p, 'spouse_occupation') ?? pickText(spouse(p), 'occupation')
  )?.toLowerCase();
  if (!o) return undefined;
  if (
    /^(homemaker|housewife|househusband|home maker|stay[- ]at[- ]home)/.test(o)
  )
    return 'Homemaker';
  if (/^retired/.test(o)) return 'Retired';
  return undefined; // a NOC group: the applicant picks it
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
  sameAddress: 'Yes' | 'No';
  coming: 'Yes' | 'No';
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

/** Missing facts for a child, in the order IRCC's dialog asks for them. */
function childGaps(c: Profile): { facts?: ChildFacts; missing: string[] } {
  const names = nameParts(
    {
      c_family_name: pickText(c, 'family_name', 'last_name', 'surname'),
      c_given_name: pickText(c, 'given_name', 'first_name', 'given_names'),
      c_name: pickText(c, 'name', 'full_name'),
    },
    'c',
  );
  const dob = pickDate(c, 'date_of_birth', 'dob', 'birth_date');
  const relationship = childRelationship(c);
  const birthCountry =
    pickCountry(c, 'country_of_birth', 'birth_country') ??
    splitPlace(c.place_of_birth).country;
  const sameAddress = declared(
    c,
    'same_address',
    'lives_with_applicant',
    'same_address_as_applicant',
  );
  const coming = declared(
    c,
    'coming_to_canada',
    'accompanying',
    'travelling_with_applicant',
    'traveling_with_applicant',
  );
  const missing: string[] = [];
  if (!names.family || !names.given) missing.push('full name');
  if (!dob) missing.push('date of birth');
  if (!relationship) missing.push('son or daughter');
  if (!birthCountry) missing.push('country of birth');
  if (!sameAddress) missing.push('whether they live at your address');
  if (!coming) missing.push('whether they are coming to Canada');
  if (declared(c, 'deceased', 'is_deceased') === 'Yes')
    missing.push('deceased (add yourself)');
  if (missing.length) return { missing };
  return {
    facts: {
      family: names.family!,
      given: names.given!,
      dob: dob!,
      relationship: relationship!,
      birthCountry: birthCountry!,
      sameAddress: sameAddress!,
      coming: coming!,
    },
    missing,
  };
}

const childAt = (p: Profile, n: number) => {
  const c = childList(p)[n - 1];
  return c ? childGaps(c).facts : undefined;
};

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
            ? `${c.given} ${c.family} (${c.relationship}, born ${c.dob})`
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

// ── the mapping ─────────────────────────────────────────────────────────────
const contact = contactAddress;
const homeForWork = (p: Profile) => residentialAddress(p);

export const IRCC_MAPPING: FillFieldMapping[] = [
  // ── Purpose ───────────────────────────────────────────────────────────────
  {
    page: PURPOSE,
    profileKey: 'purpose_of_visit',
    selector: '#visitDetails_txtArea',
    action: 'fill',
    label: 'Purpose of visit',
    category: 'travel_history',
  },
  ...dateSelects(
    PURPOSE,
    'planned_entry_date',
    'dateComingToCanada',
    'Date entering Canada',
    'dates',
  ),
  ...dateSelects(
    PURPOSE,
    'planned_departure_date',
    'dateComingToCanadaTo',
    'Date leaving Canada',
    'dates',
  ),

  // ── Personal details: applicant identity ──────────────────────────────────
  text(BIO, 'family_name', '#lastName_input', 'Family name', 'passport'),
  text(BIO, 'given_name', '#firstName_input', 'Given name', 'passport'),
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

  // ── Personal details: travel document ─────────────────────────────────────
  country(
    TRAVEL_DOC,
    'nationality',
    '#codePassport_select',
    'Passport country code',
    'passport',
  ),
  country(
    TRAVEL_DOC,
    'nationality',
    '#nationalityPassport_select',
    'Nationality on passport',
    'passport',
  ),
  text(
    TRAVEL_DOC,
    'passport_number',
    '#travelDocNum_input',
    'Passport number',
    'passport',
  ),
  text(
    TRAVEL_DOC,
    'passport_number',
    '#travelDocNumConfirmation_input',
    'Passport number (confirm)',
    'passport',
  ),
  ...dateSelects(
    TRAVEL_DOC,
    'passport_issue_date',
    'dateIssuePassport',
    'Passport issue date',
    'passport',
  ),
  ...dateSelects(
    TRAVEL_DOC,
    'passport_expiry_date',
    'dateExpiryPassport',
    'Passport expiry date',
    'passport',
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
    multipleCitizenship,
  ),
  // Shown once the question above is answered; with "No" it is the one
  // citizenship. With "Yes" the countries are the applicant's to list.
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
    (p) => pickText(p, 'national_id', 'cnic', 'cnic_number'),
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
    (p) => pickText(p, 'national_id', 'cnic', 'cnic_number'),
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
      derive: (p) =>
        pickDate(
          p,
          'national_id_issue_date',
          'cnic_issue_date',
          'id_issue_date',
          'national_id_date_of_issue',
        ),
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
      pickCountry(p, 'national_id_issuing_country', 'id_issuing_country') ??
      nationality(p),
    { reveal: true, parent: 'has_national_id', parentValue: 'Yes' },
  ),

  // ── Other names ───────────────────────────────────────────────────────────
  yesNo(
    OTHER_NAMES,
    'has_other_names',
    'hasOtherNames',
    'Has used other names',
    'passport',
    hasOtherNames,
  ),

  // ── Contact information ───────────────────────────────────────────────────
  country(
    CONTACT,
    'mailing_country',
    '#country_contactAddressGroup',
    'Mailing address — country',
    'addresses',
    (p) => contact(p)?.address.country,
  ),
  text(
    CONTACT,
    'mailing_street',
    '#streetAddress_contactAddressGroup',
    'Mailing address — street',
    'addresses',
    (p) => contact(p)?.address.street,
    { reveal: true },
  ),
  text(
    CONTACT,
    'mailing_city',
    '#city_contactAddressGroup',
    'Mailing address — city',
    'addresses',
    (p) => contact(p)?.address.city,
    { reveal: true },
  ),
  text(
    CONTACT,
    'mailing_postal_code',
    '#postalcodeother_contactAddressGroup',
    'Mailing address — postal code',
    'addresses',
    (p) => contact(p)?.address.postalCode,
    { reveal: true },
  ),
  yesNo(
    CONTACT,
    'mailing_same_as_residential',
    'hasDiffAddressContactInfo',
    'Mailing address is the same as the residential address',
    'addresses',
    (p) => contact(p)?.same,
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
        ? `${displayCountry(r.country)} — ${r.status} since ${r.since}`
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
    ],
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
  radio(
    INVITER,
    'inviter_phone_location',
    'telLocation_phoneNumberInviter',
    'Inviter — telephone in Canada or the U.S.',
    'addresses',
    { 'Canada or the U.S.': '01' },
    (p) => inviterPhone(p)?.location,
    { reveal: true },
  ),
  text(
    INVITER,
    'inviter_phone',
    '#telNumber_phoneNumberInviter',
    'Inviter — telephone number',
    'addresses',
    (p) => inviterPhone(p)?.digits,
    { reveal: true, parent: 'inviter_phone_location' },
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

  // ── Finances ──────────────────────────────────────────────────────────────
  text(
    FINANCES,
    'available_trip_funds_cad',
    '#moneyDetails_input',
    'Money available for the trip (CAD)',
    'employment',
    (p) => pick(p, 'available_funds_cad', 'trip_funds_cad'),
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
    (p) =>
      declared(p, 'has_post_secondary_education', 'post_secondary_education'),
  ),
  yesNo(
    ACTIVITIES,
    'military_service',
    'servedArmy',
    'Served in a military, militia or civil defence unit',
    'employment',
    (p) => declared(p, 'military_service', 'served_in_military', 'served_army'),
    { declaration: true },
  ),
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
        {
          derive: (p) =>
            pickDate(
              p,
              'retirement_date',
              'retired_since',
              'date_of_retirement',
            ),
        },
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
      country(
        ACTIVITIES,
        'ircc_work_retired_country',
        '#country_workHistoryAddress',
        'Retirement — country',
        'addresses',
        (p) => homeForWork(p)?.country,
      ),
      text(
        ACTIVITIES,
        'ircc_work_retired_street',
        '#streetAddress_workHistoryAddress',
        'Retirement — street address',
        'addresses',
        (p) => homeForWork(p)?.street,
      ),
      text(
        ACTIVITIES,
        'ircc_work_retired_city',
        '#city_workHistoryAddress',
        'Retirement — city',
        'addresses',
        (p) => homeForWork(p)?.city,
      ),
    ],
  ),

  // ── Travel history ────────────────────────────────────────────────────────
  yesNo(
    TRAVEL_HISTORY,
    'travelled_last_5_years',
    'traveledToOtherCountries',
    'Travelled to other countries in the past 5 years',
    'travel_history',
    (p) =>
      declared(p, 'travelled_last_5_years') === 'No' ? 'No' : noTravel5y(p),
  ),

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
  declaration(
    CRIME,
    'ever_arrested',
    'hasBeenArrested',
    'Ever arrested for a criminal offence in any country',
    ['arrested', 'been_arrested'],
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
  declaration(
    SECURITY,
    'ill_treatment',
    'illTreatment',
    'Ever witnessed or took part in the ill treatment of prisoners or civilians, or desecration of religious buildings',
    ['involved_in_ill_treatment', 'witnessed_ill_treatment'],
  ),

  // ── Medical ───────────────────────────────────────────────────────────────
  declaration(
    MEDICAL_EXAM,
    'medical_exam_last_12_months',
    'hasMedicalExam',
    'Had an IRCC medical exam in the last 12 months',
    ['ircc_medical_exam_last_12_months', 'had_immigration_medical_exam'],
  ),
  declaration(
    MEDICAL_TB,
    'tuberculosis',
    'hasTuberculosis',
    'Diagnosed with tuberculosis in the last 2 years',
    ['tuberculosis_diagnosed', 'tb_diagnosed', 'has_tuberculosis'],
  ),
  declaration(
    MEDICAL_TB,
    'tuberculosis_contact',
    'contactFiveYears',
    'Close contact with a person with tuberculosis in the last 5 years',
    ['tb_close_contact', 'close_contact_tuberculosis'],
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
      derive: (p) => pickDate(p, 'date_of_marriage', 'wedding_date'),
      reveal: true,
      parent: 'marital_status',
      parentValue: 'Married',
    },
  ),
  text(
    FAMILY,
    'spouse_family_name',
    '#lastName_input',
    'Spouse — family name',
    'passport',
    (p) => spouseNames(p).family,
    { reveal: true, parent: 'marital_status', parentValue: 'Married' },
  ),
  text(
    FAMILY,
    'spouse_given_name',
    '#firstName_input',
    'Spouse — given name',
    'passport',
    (p) => spouseNames(p).given,
    { reveal: true, parent: 'marital_status', parentValue: 'Married' },
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
      parentValue: 'Married',
    },
  ),
  country(
    FAMILY,
    'spouse_country_of_birth',
    '#countryOfBirthPartner_select',
    'Spouse — country of birth',
    'passport',
    spouseBirthCountry,
    { reveal: true, parent: 'marital_status', parentValue: 'Married' },
  ),
  optionText(
    FAMILY,
    'spouse_occupation_option',
    '#partnerOccupation_select',
    'Spouse — occupation',
    'employment',
    spouseOccupationOption,
    { reveal: true, parent: 'marital_status', parentValue: 'Married' },
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
    { reveal: true, parent: 'marital_status', parentValue: 'Married' },
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
    { reveal: true, parent: 'marital_status', parentValue: 'Married' },
  ),

  // ── Children ──────────────────────────────────────────────────────────────
  yesNo(
    CHILDREN,
    'has_children',
    'hasChild',
    'Has children',
    'passport',
    hasChildren,
  ),
  ...childRows(),
];

// Residence row: country, status and since-when must all be known.
function residence(
  p: Profile,
): { country: string; status: string; since: string } | undefined {
  const home = residentialAddress(p);
  const country =
    home?.country ??
    pickCountry(p, 'country_of_residence', 'residence_country');
  const since = pickDate(
    p,
    'residence_since',
    'living_since',
    'residential_address_since',
    'resident_since',
  );
  if (!country || !since) return undefined;
  const explicit = pickText(
    p,
    'residence_status',
    'status_in_country_of_residence',
  );
  const status = explicit
    ? /citizen/i.test(explicit)
      ? 'Citizen'
      : /permanent/i.test(explicit)
        ? 'Permanent resident'
        : undefined
    : nationality(p) === country
      ? 'Citizen'
      : undefined;
  if (!status) return undefined;
  return { country, status, since };
}

/** What the assistant never fills, page by page — the applicant's part. */
function leftForApplicant(p: Profile): ManualFieldNote[] {
  const notes: ManualFieldNote[] = [
    {
      page: NATIONALITY,
      label: 'Other citizenships',
      reason: 'fill_yourself',
      note: 'If you are a citizen of more than one country, list each one.',
      when: () => multipleCitizenship(p) === 'Yes',
    },
    {
      page: OTHER_NAMES,
      label: 'Other names you have used',
      reason: 'fill_yourself',
      when: () => hasOtherNames(p) === 'Yes',
    },
    {
      page: CONTACT,
      label: 'Residential address',
      reason: 'fill_yourself',
      note: 'Your mailing address differs from your home address; enter your home address.',
      when: () => contactAddress(p)?.same === 'No',
    },
    { page: CONTACT, label: 'Telephone and email', reason: 'fill_yourself' },
    {
      page: CONTACT,
      label: 'Countries of residence',
      reason: 'not_in_profile',
      note: 'Add where you live, your status there and since when.',
      when: () => !residence(p),
    },
    {
      page: ACTIVITIES,
      label: 'Work history (past 10 years, no gaps)',
      reason: 'fill_yourself',
      note: 'Choose the occupation group for each job; the assistant only adds a retirement period.',
    },
    {
      page: ACTIVITIES,
      label: 'Education details',
      reason: 'fill_yourself',
      when: () =>
        declared(
          p,
          'has_post_secondary_education',
          'post_secondary_education',
        ) === 'Yes',
    },
    {
      page: TRAVEL_HISTORY,
      label: 'Trips in the past 5 years',
      reason: 'fill_yourself',
      note: 'Answer the question and add each trip.',
      when: () => noTravel5y(p) === undefined,
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
      page: FAMILY,
      label: "Spouse's occupation",
      reason: 'fill_yourself',
      note: 'Choose the occupation group.',
      when: () => maritalStatus(p) === 'Married' && !spouseOccupationOption(p),
    },
    { page: FAMILY, label: "Parents' details", reason: 'fill_yourself' },
    {
      page: INVITER,
      label: "Inviter's address",
      reason: 'not_in_profile',
      note: 'Not recorded as a full Canadian address (number, street, city, province, postal code).',
      when: () => !inviterAddress(p),
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
    const { missing } = childGaps(c);
    if (missing.length)
      notes.push({
        page: CHILDREN,
        label: `Child ${i + 1}`,
        reason: 'not_in_profile',
        note: `Add this child yourself — missing: ${missing.join(', ')}.`,
      });
  });
  if (isRetired(p) && !retiredRow(p))
    notes.push({
      page: ACTIVITIES,
      label: 'Retirement period',
      reason: 'not_in_profile',
      note: 'Retirement date or home address not recorded.',
    });
  return notes.filter((n) => !n.when || n.when(p));
}

registerPortalFill('ircc', IRCC_MAPPING, {
  pages: IRCC_PAGES,
  left: leftForApplicant,
});
