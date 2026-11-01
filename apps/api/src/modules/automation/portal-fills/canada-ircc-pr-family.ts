import {
  registerPortalFill,
  type FillFieldMapping,
  type ManualFieldNote,
  type PortalPageInfo,
} from '../../../strategies/portal-integration/portal-fill.registry';
import { intakeAnswerIsYes, isoDayMs } from '@visaai/types';
import {
  CA_PROVINCE_NAMES,
  contactAddress,
  declared,
  displayCountry,
  nameParts,
  parseAddressLine,
  people,
  pick,
  pickCountry,
  pickDate,
  pickText,
  residentialAddress,
  splitPlace,
  type Address,
  type Profile,
} from './ircc-profile';
import { toIso3 } from './country-names';
import { etaCountryCodeOption, etaPlaceOption } from './eta-options';
import { IRCC_NATIVE_LANGUAGES } from './ircc-languages';
import { placePhone, type PlacedPhone } from './phone-numbers';
import { listAnswer } from './canada-ircc';
import { documentsOfSlot, type UploadSlot } from './ircc-uploads';

/**
 * Canada SPOUSAL SPONSORSHIP (registry `ca-sponsor-your-spouse-partner-or-child`)
 * — the principal applicant's side of IRCC's Permanent Residence Portal
 * (prson-srpel.apps.cic.gc.ca), recorded live on 2026-10-20 on a draft
 * (Family › Spouse › Family class outside Canada) with every branch of the
 * profile and IMM 0008 toggled and discarded.
 *
 * Portal facts the mapping relies on:
 *  - its own accounts (not GCKey / the IRCC secure account); the applicant
 *    signs in and creates the application (program, category, subcategory)
 *    themselves.
 *  - Angular; the extension's native value setter + input/change/blur events
 *    register on its selects (verified live on the profile's country, whose
 *    province list then reloads). Option values carry the list index
 *    ("176: 209"), so every select is chosen by option TEXT.
 *  - the application id is in every path: the profile is
 *    /en/application/profile/<id> (page "/application/profile/*"), the
 *    IMM 0008 pages /en/application/case/<id>/imm0008/pageN. IMM 5406 and
 *    IMM 5669 show every section at ONE path (/…/imm5406, /…/imm5669; the
 *    section is in a query the extension does not report), so those pages are
 *    progressive and a control that several sections reuse is scoped to its
 *    section's heading (`pageMatch`).
 *  - each page's "Save and continue" and each form's "Complete and return to
 *    application" are the applicant's to press (safety-guards refuse them).
 *  - fields copied from the profile are DISABLED on the forms (IMM 0008
 *    page 3 names and date of birth, page 4 mailing address, the IMM 5406 /
 *    IMM 5669 applicant name and date of birth): they are filled once, on the
 *    profile, and never written on the forms.
 *  - text masks: dates YYYY/MM/DD; a Canada/US phone is shown as
 *    NNN-NNN-NNNN (written that way, so the readback matches).
 *  - limits enforced only by the form's validators (no maxlength attribute):
 *    IMM 5669 diploma 17, activity 21, status 14 characters (phase 2 rows).
 *
 * SAFETY. The IMM 5669 background questions are legal declarations: answered
 * only from the applicant's explicit answer, never defaulted, flagged
 * `declaration`. A "Yes" opens one shared details box the applicant writes.
 *
 * The application page (/en/application/case/<id>, live 2026-10-20): its
 * upload slots are defined (PR_UPLOAD_SLOTS) but NOT registered until one
 * upload is recorded live (review B1); the PDF forms, documents, fee
 * receipt, paying, the declaration and submission are the applicant's, and
 * coverage lists which VisaAI documents they have for each row.
 *
 * DEPENDANTS on the profile ("Add dependant", live 2026-10-20): each
 * dependent child with a family name, given name, full date of birth,
 * relationship and an explicit "accompanying" answer is added through the
 * profile's inline form (one at a time; skipped when its card is already
 * saved). The page's own "Save and continue" stays the applicant's.
 *
 * NOT FILLED (listed for the applicant): the second previous country,
 * dependants whose data is incomplete, "Not Applicable" in a section that
 * does not apply, every upload on the application page, signing the PDF
 * forms, paying, the declaration and submission. Repeating rows (IMM 5406 children and siblings, IMM 5669
 * education / personal history / addresses, IMM 5562 trips) fill only when
 * every row is complete.
 */

// Every key starts at the English path: each select is chosen by its English
// option text, so a French page (/fr/…) matches no key and is never written
// (the extension also tells the applicant to switch to English).
export const PR_PROFILE = '/en/application/profile/*';
export const PR_IMM0008 = (n: number) =>
  `/en/application/case/*/imm0008/page${n}`;
export const PR_IMM5406 = '/en/application/case/*/imm5406';
export const PR_IMM5669 = '/en/application/case/*/imm5669';
export const PR_IMM5562 = '/en/application/case/*/imm5562';
/**
 * The application page itself: its forms, PDF forms, supporting documents,
 * fee and declaration (live 2026-10-20). One `*` segment after "case", so it
 * never matches a form page below it (/…/case/<id>/imm5406).
 */
export const PR_CASE = '/en/application/case/*';

export const PR_FAMILY_PAGES: PortalPageInfo[] = [
  { page: PR_PROFILE, title: 'Your profile' },
  { page: PR_IMM0008(2), title: 'IMM 0008 — Application details' },
  { page: PR_IMM0008(3), title: 'IMM 0008 — Personal details' },
  { page: PR_IMM0008(4), title: 'IMM 0008 — Contact information' },
  { page: PR_IMM0008(5), title: 'IMM 0008 — Passport' },
  { page: PR_IMM0008(6), title: 'IMM 0008 — National identity document' },
  { page: PR_IMM0008(7), title: 'IMM 0008 — Education and occupation' },
  { page: PR_IMM0008(8), title: 'IMM 0008 — Language' },
  {
    page: PR_IMM5406,
    title: 'IMM 5406 — Additional family information',
    progressive: true,
  },
  {
    page: PR_IMM5669,
    title: 'IMM 5669 — Schedule A: background',
    progressive: true,
  },
  {
    page: PR_IMM5562,
    title: 'IMM 5562 — Your travels',
    progressive: true,
  },
  // Each upload slot runs when its row is on the screen (a row the
  // application does not ask for is not refused as a partial page).
  {
    page: PR_CASE,
    title: 'Application — PDF forms, documents and fee receipt',
    progressive: true,
  },
];

type Category = FillFieldMapping['category'];
type Extra = Partial<
  Pick<
    FillFieldMapping,
    | 'dependantForm'
    | 'parent'
    | 'parentValue'
    | 'declaration'
    | 'reveal'
    | 'awaitOptions'
    | 'maxLength'
    | 'pageMatch'
    | 'silent'
    | 'principalForm'
    | 'keepExisting'
    | 'group'
    | 'onlyIf'
  >
>;

/** A text box. */
function text(
  page: string,
  profileKey: string,
  css: string,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page,
    profileKey,
    selector: css,
    action: 'fill',
    label,
    category,
    derive,
    ...extra,
  };
}

/** A <select>, chosen by its option text. */
function option(
  page: string,
  profileKey: string,
  css: string,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page,
    profileKey,
    selector: css,
    action: 'select',
    op: 'select_text',
    label,
    category,
    derive,
    ...extra,
  };
}

/** A radio question: answer → the input clicked. */
function radio(
  page: string,
  profileKey: string,
  name: string,
  choices: Record<string, string>,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
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

/** A checkbox ticked (never un-ticked). */
function check(
  page: string,
  profileKey: string,
  css: string,
  label: string,
  category: Category,
  derive: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page,
    profileKey,
    selector: css,
    action: 'fill',
    op: 'check',
    label,
    category,
    derive,
    ...extra,
  };
}

// ── shared readings ─────────────────────────────────────────────────────────

/** ISO date → the portal's YYYY/MM/DD. */
export const slashDate = (iso: string | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replace(/-/g, '/') : undefined;

/** A date the portal requires to be after today (an ID's expiry). */
function future(iso: string | undefined, now = Date.now()): boolean {
  const ms = iso ? isoDayMs(iso) : null;
  return ms !== null && ms > now;
}

const dob = (p: Profile) => pickDate(p, 'date_of_birth', 'dob', 'birth_date');
const familyName = (p: Profile) =>
  pickText(p, 'family_name', 'surname', 'last_name');
const givenName = (p: Profile) =>
  pickText(p, 'given_name', 'given_names', 'first_name');
const email = (p: Profile) => pickText(p, 'email', 'email_address');

/** Option text of the portal's country lists (birth, address, citizenship): "Pakistan". */
const placeOption = (raw: string | undefined) =>
  raw ? (etaPlaceOption(raw) ?? undefined) : undefined;

/** "English" / "French" from the correspondence preference. */
export function officialLanguage(
  raw: string | undefined,
): 'English' | 'French' | undefined {
  if (!raw) return undefined;
  if (/^\s*(fr|fran)/i.test(raw)) return 'French';
  if (/^\s*en/i.test(raw)) return 'English';
  return undefined;
}
const correspondence = (p: Profile) =>
  officialLanguage(
    pickText(
      p,
      'preferred_contact_language',
      'preferred_language',
      'preferred_language_of_correspondence',
      'correspondence_language',
    ),
  );

/** A language as IRCC's list writes it ("punjabi" → "Punjabi"); unknown → nothing. */
export function irccLanguage(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const want = raw.trim().toLowerCase();
  return IRCC_NATIVE_LANGUAGES.find((l) => l.toLowerCase() === want);
}

/** A Canadian province or territory → the portal's two-letter option ("ON"). */
export function provinceAbbr(raw: unknown): string | undefined {
  const first: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (typeof first !== 'string' || !first.trim()) return undefined;
  const s = first.trim();
  const up = s.toUpperCase();
  if (CA_PROVINCE_NAMES[up]) return up;
  const hit = Object.entries(CA_PROVINCE_NAMES).find(
    ([, name]) => name.toLowerCase() === s.toLowerCase(),
  );
  return hit?.[0];
}

/** "123 Main St" → number and name; a street with no leading number is all name. */
export function streetParts(a: Address | undefined): {
  number?: string;
  name?: string;
} {
  if (!a) return {};
  if (a.streetNumber || a.streetName)
    return { number: a.streetNumber, name: a.streetName };
  const street = a.street?.trim();
  if (!street) return {};
  const m = /^(\d+[A-Za-z]?(?:-\d+)?)\s+(.+)$/.exec(street);
  return m ? { number: m[1], name: m[2] } : { name: street };
}

/** Where the applicant lives now (ISO-3). */
const residenceIso = (p: Profile) =>
  pickCountry(
    p,
    'country_of_residence',
    'current_country_of_residence',
    'residence_country',
    'residential_country',
  ) ?? residentialAddress(p)?.country;

const nationalityIso = (p: Profile) =>
  pickCountry(p, 'nationality', 'citizenship', 'country_of_citizenship');

// ── the profile ─────────────────────────────────────────────────────────────

const mailing = (p: Profile) => contactAddress(p)?.address;

/**
 * The residential block (answer "No" to "same as mailing") REUSES the mailing
 * block's ids (streetNumber, streetName, city, country, province,
 * postalCode; live 2026-10-20), mailing first in document order. Each box is
 * named by its place among the matches (`>> nth=<k>/<most>`, extension
 * resolve-target.ts, 0.1.52): the mailing box is the 1st of one or two, the
 * residential box the 2nd of exactly two. Anything else (three blocks, the
 * residential one missing) resolves to nothing, never to the other block.
 * Only the residential-differs branch uses the token: with one block the
 * mailing boxes keep their plain ids, so an older extension still fills the
 * common case. An older extension reads an `nth` selector as invalid and
 * writes nothing.
 */
export const MAILING = (id: string) => `#${id} >> nth=1/2`;
export const RESIDENTIAL = (id: string) => `#${id} >> nth=2/2`;

/** The home address when it is not the mailing address, complete enough for IRCC. */
function residentialOther(p: Profile): Address | undefined {
  const c = contactAddress(p);
  if (c?.same !== 'No') return undefined;
  const home = residentialAddress(p);
  if (!home?.city || !home.country) return undefined;
  if (!streetParts(home).name) return undefined;
  if (!placeOption(home.countryText ?? displayCountry(home.country)))
    return undefined;
  // IRCC requires a province for a Canadian address (two-letter options).
  if (home.country === 'CAN' && !provinceAbbr(home.province)) return undefined;
  return home;
}

/**
 * The mailing boxes that share their ids with the residential block. With
 * one block (no other home address to enter) they are the plain ids; when
 * the residential block will be opened they are the 1st of two
 * (`MAILING`). Same keys and answers: only one set has values.
 */
function mailingFields(twoBlocks: boolean): FillFieldMapping[] {
  const P = PR_PROFILE;
  const css = (id: string) => (twoBlocks ? MAILING(id) : `#${id}`);
  // One key for both sets (the review, the lock and coverage see one field),
  // so which set writes is a gate, not a derive: a value stored under the
  // key (the saved form, a consultant's correction) skips `derive`.
  const gate: Extra = {
    onlyIf: (p) => !!residentialOther(p) === twoBlocks,
  };
  return [
    text(
      P,
      'pr_mail_street_number',
      css('streetNumber'),
      'Mailing address — street number',
      'addresses',
      (p) => streetParts(mailing(p)).number,
      gate,
    ),
    text(
      P,
      'pr_mail_street_name',
      css('streetName'),
      'Mailing address — street name',
      'addresses',
      (p) => streetParts(mailing(p)).name,
      gate,
    ),
    text(
      P,
      'pr_mail_city',
      css('city'),
      'Mailing address — city/town',
      'addresses',
      (p) => mailing(p)?.city,
      gate,
    ),
    option(
      P,
      'pr_mail_country',
      css('country'),
      'Mailing address — country',
      'addresses',
      (p) => {
        const a = mailing(p);
        return placeOption(a?.countryText ?? displayCountry(a?.country));
      },
      gate,
    ),
    // The province list loads once the country is chosen; only Canada's
    // (two-letter options) was recorded.
    option(
      P,
      'pr_mail_province',
      css('province'),
      'Mailing address — province',
      'addresses',
      (p) => {
        const a = mailing(p);
        return a?.country === 'CAN' ? provinceAbbr(a.province) : undefined;
      },
      { ...gate, awaitOptions: true },
    ),
    text(
      P,
      'pr_mail_postal_code',
      css('postalCode'),
      'Mailing address — postal code',
      'addresses',
      (p) => mailing(p)?.postalCode,
      gate,
    ),
  ];
}

function profileFields(): FillFieldMapping[] {
  const P = PR_PROFILE;
  // The answer and the block it opens stand or fall together.
  const home: Extra = {
    reveal: true,
    parent: 'pr_residential_same',
    parentValue: 'No',
    group: 'pr_residential',
    // Never from a stored value alone: only with a home address to enter.
    onlyIf: (p) => !!residentialOther(p),
  };
  return [
    option(
      P,
      'pr_correspondence',
      '#profileForm-correspondence',
      'Preferred language of correspondence',
      'addresses',
      correspondence,
    ),
    text(
      P,
      'pr_family_name',
      '#profileForm-familyName',
      'Family name(s)',
      'passport',
      familyName,
    ),
    text(
      P,
      'pr_given_name',
      '#personalDetailsForm-givenName',
      'Given name(s)',
      'passport',
      givenName,
    ),
    text(
      P,
      'pr_date_of_birth',
      '#personalDetailsForm-dob',
      'Date of birth',
      'passport',
      (p) => slashDate(dob(p)),
    ),
    text(
      P,
      'pr_mail_apartment',
      '#apartmentUnit',
      'Mailing address — apartment/unit',
      'addresses',
      (p) => mailing(p)?.apartment,
      { silent: true },
    ),
    ...mailingFields(false),
    ...mailingFields(true),
    // "No" opens the residential block (same ids, 2nd in the document); it
    // is answered "No" only with a home address the assistant can enter.
    radio(
      P,
      'pr_residential_same',
      'residentialSameAsMailingAddress',
      { Yes: '#yes', No: '#no' },
      'Residential address same as mailing address',
      'addresses',
      (p) => {
        if (contactAddress(p)?.same === 'Yes') return 'Yes';
        return residentialOther(p) ? 'No' : undefined;
      },
      { group: 'pr_residential' },
    ),
    text(
      P,
      'pr_home_street_number',
      RESIDENTIAL('streetNumber'),
      'Residential address — street number',
      'addresses',
      (p) => streetParts(residentialOther(p)).number,
      { ...home, silent: true },
    ),
    text(
      P,
      'pr_home_street_name',
      RESIDENTIAL('streetName'),
      'Residential address — street name',
      'addresses',
      (p) => streetParts(residentialOther(p)).name,
      home,
    ),
    text(
      P,
      'pr_home_city',
      RESIDENTIAL('city'),
      'Residential address — city/town',
      'addresses',
      (p) => residentialOther(p)?.city,
      home,
    ),
    option(
      P,
      'pr_home_country',
      RESIDENTIAL('country'),
      'Residential address — country',
      'addresses',
      (p) => {
        const a = residentialOther(p);
        return a
          ? placeOption(a.countryText ?? displayCountry(a.country))
          : undefined;
      },
      home,
    ),
    option(
      P,
      'pr_home_province',
      RESIDENTIAL('province'),
      'Residential address — province',
      'addresses',
      (p) => {
        const a = residentialOther(p);
        return a?.country === 'CAN' ? provinceAbbr(a.province) : undefined;
      },
      { ...home, awaitOptions: true },
    ),
    text(
      P,
      'pr_home_postal_code',
      RESIDENTIAL('postalCode'),
      'Residential address — postal code',
      'addresses',
      (p) => residentialOther(p)?.postalCode,
      { ...home, silent: true },
    ),
  ];
}

// ── IMM 0008 page 2: application details ───────────────────────────────────

/** The interview language: an explicit choice, else the correspondence language. */
const interviewLanguage = (p: Profile) =>
  irccLanguage(
    pickText(p, 'interview_language', 'preferred_interview_language'),
  ) ?? correspondence(p);

/**
 * An interpreter: the applicant's answer; otherwise "No" only when the
 * interview is in English or French and they said they speak it.
 */
export function interpreter(p: Profile): 'Yes' | 'No' | undefined {
  const said = declared(
    p,
    'interpreter_requested',
    'needs_interpreter',
    'interpreter_required',
  );
  if (said) return said;
  const lang = interviewLanguage(p);
  const speaks =
    pickText(
      p,
      'official_language_ability',
      'official_languages',
    )?.toLowerCase() ?? '';
  if (lang === 'English' && /english|both/.test(speaks)) return 'No';
  if (lang === 'French' && /french|both/.test(speaks)) return 'No';
  return undefined;
}

/** Where they plan to live: their answer, else the sponsor's home. */
function destination(p: Profile): { province?: string; city?: string } {
  const province = provinceAbbr(
    pick(
      p,
      'preferred_destination_province',
      'intended_province',
      'intended_province_of_residence',
      'preferred_provinces',
    ),
  );
  const city = pickText(
    p,
    'intended_city_of_residence',
    'intended_city',
    'destination_city',
  );
  const home = parseAddressLine(
    pickText(p, 'sponsor_residential_address', 'spouse_address'),
    'CAN',
  );
  const homeProvince =
    home?.country === 'CAN' ? provinceAbbr(home.province) : undefined;
  // A province answered without a city (live 2026-10-20: the Forms page's
  // "Toronto" was inferred, so it never reaches the fill): the sponsor's
  // city, when it is in that province.
  if (province)
    return {
      province,
      city: city ?? (homeProvince === province ? home?.city : undefined),
    };
  if (!homeProvince) return { city };
  return { province: homeProvince, city: city ?? home?.city };
}

function imm0008Page2(): FillFieldMapping[] {
  const P = PR_IMM0008(2);
  // `#correspondence` is not written here: the form copies it from the profile
  // and shows it DISABLED. Writing it made the probe report the page as
  // missing a field and refuse all of it (live 2026-10-21).
  return [
    option(
      P,
      'pr_interview_language',
      '#interview',
      'Language of interview',
      'addresses',
      interviewLanguage,
    ),
    option(
      P,
      'pr_interpreter',
      '#interpreterRequested',
      'Interpreter requested',
      'addresses',
      interpreter,
    ),
    option(
      P,
      'pr_destination_province',
      '#province',
      'Where you plan to live — province/territory',
      'addresses',
      (p) => destination(p).province,
    ),
    // The city list loads after the province (845 for Ontario).
    option(
      P,
      'pr_destination_city',
      '#city',
      'Where you plan to live — city/town',
      'addresses',
      (p) => destination(p).city,
      {
        awaitOptions: true,
      },
    ),
  ];
}

// ── IMM 0008 page 3: personal details ──────────────────────────────────────

const SEX_OPTIONS: ReadonlyArray<[RegExp, string]> = [
  [/^(m|male|man)$/, 'M Male'],
  [/^(f|female|woman)$/, 'F Female'],
  [/^(x|another gender|other|non-?binary)$/, 'X Another gender'],
];
export const sexOption = (p: Profile) => {
  const s = pickText(p, 'sex', 'gender')?.toLowerCase();
  return s ? SEX_OPTIONS.find(([re]) => re.test(s))?.[1] : undefined;
};

const EYE_COLOURS = [
  'Black',
  'Blue',
  'Brown',
  'Green',
  'Grey',
  'Hazel',
  'Other',
  'Pink',
  'Sea Green',
];
export function eyeColour(p: Profile): string | undefined {
  const s = pickText(p, 'eye_colour', 'eye_color')
    ?.toLowerCase()
    .replace('gray', 'grey');
  return s ? EYE_COLOURS.find((c) => c.toLowerCase() === s) : undefined;
}

/** Height in whole centimetres ("173 cm", "173"). */
export function heightCm(p: Profile): string | undefined {
  const s = pickText(p, 'height_cm', 'height');
  const m = s ? /(\d{2,3})(?:\s*cm)?\s*$/i.exec(s.trim()) : null;
  const n = m ? Number(m[1]) : NaN;
  return n >= 50 && n <= 250 ? String(n) : undefined;
}

const birthCountryOption = (p: Profile) => {
  const iso =
    pickCountry(p, 'country_of_birth', 'birth_country') ??
    splitPlace(pickText(p, 'place_of_birth', 'birth_place')).country;
  return placeOption(displayCountry(iso));
};
const birthCity = (p: Profile) =>
  pickText(p, 'city_of_birth', 'birth_city', 'place_of_birth_city') ??
  splitPlace(pickText(p, 'place_of_birth', 'birth_place')).city;

/** Status in the country of residence, as the portal's options. */
const STATUS_OPTIONS: ReadonlyArray<[RegExp, string]> = [
  [/permanent/, 'Permanent resident'],
  [/protected/, 'Protected Person'],
  [/refugee/, 'Refugee Claimant'],
  [/foreign national/, 'Foreign National'],
  [/citizen/, 'Citizen'],
  [/visit/, 'Visitor'],
  [/work/, 'Worker'],
  [/stud/, 'Student'],
  [/other/, 'Other'],
];
export const statusOption = (raw: string | undefined) => {
  const s = raw?.toLowerCase();
  return s ? STATUS_OPTIONS.find(([re]) => re.test(s))?.[1] : undefined;
};
/** Their status where they live: stated, or "Citizen" when they live in their own country. */
export function residenceStatus(p: Profile): string | undefined {
  const said = statusOption(
    pickText(
      p,
      'status_in_country_of_residence',
      'immigration_status',
      'residence_status',
    ),
  );
  if (said) return said;
  const home = residenceIso(p);
  return home && home === nationalityIso(p) ? 'Citizen' : undefined;
}
export const TEMPORARY_STATUS = [
  'Worker',
  'Student',
  'Visitor',
  'Other',
] as const;

const MARITAL_OPTIONS: ReadonlyArray<[RegExp, string]> = [
  [/common[- ]?law/, 'Common-Law'],
  [/annul/, 'Annulled Marriage'],
  [/divorc/, 'Divorced'],
  [/separat/, 'Separated'],
  [/widow/, 'Widowed'],
  [/never married|single|unmarried/, 'Single'],
  [/married/, 'Married'],
];
export const maritalOption = (p: Profile) => {
  const s = pickText(p, 'marital_status', 'civil_status')?.toLowerCase();
  return s ? MARITAL_OPTIONS.find(([re]) => re.test(s))?.[1] : undefined;
};
/** The partner questions IMM 0008 opens for these statuses. */
export const PARTNERED = ['Married', 'Common-Law'] as const;
/** Every status that keeps the previous-relationship question (all but Single / Unknown). */
const HAS_PAST = [
  'Married',
  'Common-Law',
  'Divorced',
  'Separated',
  'Widowed',
  'Annulled Marriage',
] as const;

/** The partner: the spouse on file, else the sponsor (in this route the spouse IS the sponsor). */
function partnerName(p: Profile): { family?: string; given?: string } {
  const spouse = nameParts(p, 'spouse');
  if (spouse.family) return spouse;
  return nameParts(p, 'sponsor');
}
const partnerSince = (p: Profile) =>
  pickDate(
    p,
    'marriage_date',
    'date_of_marriage',
    'common_law_start_date',
    'relationship_start_date',
  );

/** Other names: "Yes" only with a name the assistant can enter. */
function otherName(
  p: Profile,
): { family?: string; given?: string } | undefined {
  const v = pick(p, 'other_names', 'aliases', 'previous_names');
  const first: unknown = Array.isArray(v) ? (v as unknown[])[0] : v;
  if (first && typeof first === 'object') {
    const r = first as Profile;
    const family = pickText(r, 'family_name', 'surname', 'last_name');
    return family
      ? {
          family,
          given: pickText(r, 'given_name', 'given_names', 'first_name'),
        }
      : undefined;
  }
  if (
    typeof first !== 'string' ||
    !first.trim() ||
    intakeAnswerIsYes(first) !== undefined
  )
    return undefined;
  const words = first.trim().split(/\s+/);
  return words.length < 2
    ? { family: words[0] }
    : { family: words[words.length - 1], given: words.slice(0, -1).join(' ') };
}
export function usedOtherName(p: Profile): 'Yes' | 'No' | undefined {
  if (otherName(p)) return 'Yes';
  const v = pick(p, 'other_names');
  if (Array.isArray(v) && v.length === 0) return 'No';
  return declared(p, 'has_other_names', 'used_other_names') === 'No'
    ? 'No'
    : undefined;
}

/** One previous country of residence, complete; two or more are the applicant's (phase 2). */
function previousCountries(p: Profile): Profile[] | 'none' | undefined {
  const raw = pick(p, 'previous_countries_of_residence', 'previous_countries');
  if (intakeAnswerIsYes(raw) === false) return 'none';
  const rows = people(
    p,
    'previous_countries_of_residence',
    'previous_countries',
  );
  if (Array.isArray(raw) && raw.length === 0) return 'none';
  return rows.length > 0 ? rows : undefined;
}
interface PrevCountry {
  country: string;
  status: string;
  from: string;
  to: string;
}
function prevCountry(p: Profile): PrevCountry | undefined {
  const rows = previousCountries(p);
  if (!Array.isArray(rows) || rows.length !== 1) return undefined;
  const r = rows[0];
  const country = placeOption(
    displayCountry(
      pickCountry(r, 'country', 'country_of_residence') ?? undefined,
    ),
  );
  const status = statusOption(pickText(r, 'status', 'immigration_status'));
  const from = slashDate(pickDate(r, 'from', 'start_date', 'from_date'));
  const to = slashDate(pickDate(r, 'to', 'end_date', 'to_date'));
  return country && status && from && to
    ? { country, status, from, to }
    : undefined;
}
export function hasPreviousCountries(p: Profile): 'Yes' | 'No' | undefined {
  const rows = previousCountries(p);
  if (rows === 'none') return 'No';
  return prevCountry(p) ? 'Yes' : undefined;
}

interface PastPartner {
  family: string;
  given?: string;
  dob: string;
  type: 'Married' | 'Common-Law';
  from: string;
  to: string;
}
function pastPartner(p: Profile): PastPartner | undefined {
  const r = people(p, 'previous_relationships', 'previous_marriages')[0];
  if (!r) return undefined;
  const name = nameParts(r, 'spouse').family
    ? nameParts(r, 'spouse')
    : nameParts(r, 'partner');
  const family = name.family ?? pickText(r, 'family_name', 'surname');
  const born = slashDate(
    pickDate(r, 'date_of_birth', 'dob', 'spouse_date_of_birth'),
  );
  const kind = pickText(r, 'type', 'relationship_type')?.toLowerCase() ?? '';
  const type = /common/.test(kind)
    ? 'Common-Law'
    : /marri/.test(kind)
      ? 'Married'
      : undefined;
  const from = slashDate(pickDate(r, 'from', 'start_date', 'marriage_date'));
  const to = slashDate(pickDate(r, 'to', 'end_date', 'divorce_date'));
  if (!family || !born || !type || !from || !to) return undefined;
  return {
    family,
    given: name.given ?? pickText(r, 'given_name'),
    dob: born,
    type,
    from,
    to,
  };
}
/** "Yes" only with the previous partner's details complete; "No" when they said so. */
export function previouslyPartnered(p: Profile): 'Yes' | 'No' | undefined {
  if (pastPartner(p)) return 'Yes';
  const said = declared(
    p,
    'applicant_previous_relationship',
    'previously_married',
    'previous_relationship',
  );
  if (said === 'No') return 'No';
  const rows = pick(p, 'previous_relationships');
  return Array.isArray(rows) && rows.length === 0 ? 'No' : undefined;
}

function imm0008Page3(): FillFieldMapping[] {
  const P = PR_IMM0008(3);
  const PD = 'personalDetailsForm';
  const lastEntry: Extra = {
    parent: 'pr_current_country',
    parentValue: 'Canada',
    reveal: true,
  };
  const tempStatus: Extra = {
    parent: 'pr_status',
    parentValue: TEMPORARY_STATUS,
    reveal: true,
  };
  const partner: Extra = {
    parent: 'pr_marital_status',
    parentValue: PARTNERED,
    reveal: true,
  };
  const past: Extra = {
    parent: 'pr_previously_partnered',
    parentValue: 'Yes',
    reveal: true,
  };
  const prev: Extra = {
    parent: 'pr_previous_countries',
    parentValue: 'Yes',
    reveal: true,
  };
  return [
    // Names and date of birth are the profile's (disabled here).
    radio(
      P,
      'pr_used_other_name',
      'second-name-used',
      { Yes: `#${PD}-usedOtherName-yes`, No: `#${PD}-usedOtherName-no` },
      'Have you used any other name?',
      'passport',
      usedOtherName,
    ),
    text(
      P,
      'pr_other_family_name',
      `#${PD}-otherFamilyName`,
      'Other name — family name(s)',
      'passport',
      (p) => otherName(p)?.family,
      {
        parent: 'pr_used_other_name',
        parentValue: 'Yes',
        reveal: true,
      },
    ),
    text(
      P,
      'pr_other_given_name',
      `#${PD}-otherGivenName`,
      'Other name — given name(s)',
      'passport',
      (p) => otherName(p)?.given,
      {
        parent: 'pr_used_other_name',
        parentValue: 'Yes',
        reveal: true,
        silent: true,
      },
    ),
    text(
      P,
      'pr_uci',
      `#${PD}-uci`,
      'UCI',
      'passport',
      (p) =>
        pickText(p, 'uci', 'client_id', 'unique_client_identifier')?.replace(
          /\D/g,
          '',
        ) || undefined,
      {
        silent: true,
      },
    ),
    option(P, 'pr_sex', `#${PD}-sex`, 'Sex', 'passport', sexOption),
    option(
      P,
      'pr_eye_colour',
      `#${PD}-eyeColour`,
      'Eye colour',
      'passport',
      eyeColour,
    ),
    text(
      P,
      'pr_height_cm',
      `#${PD}-heightInCM`,
      'Height (cm)',
      'passport',
      heightCm,
    ),
    text(
      P,
      'pr_city_of_birth',
      `#${PD}-cityOfBirth`,
      'Place of birth (city/town)',
      'passport',
      birthCity,
    ),
    option(
      P,
      'pr_country_of_birth',
      `#${PD}-countryOfBirth`,
      'Country of birth',
      'passport',
      birthCountryOption,
    ),
    option(
      P,
      'pr_citizenship',
      `#${PD}-citizenship1`,
      'Citizenship',
      'passport',
      (p) => placeOption(displayCountry(nationalityIso(p))),
    ),
    option(
      P,
      'pr_second_citizenship',
      `#${PD}-citizenship2`,
      'Second citizenship',
      'passport',
      (p) =>
        declared(p, 'has_multiple_citizenship', 'multiple_citizenship') ===
        'Yes'
          ? placeOption(
              displayCountry(
                pickCountry(p, 'other_citizenship', 'other_citizenships') ??
                  undefined,
              ),
            )
          : undefined,
      { silent: true },
    ),
    option(
      P,
      'pr_current_country',
      `#${PD}-currentCountry`,
      'Current country of residence',
      'addresses',
      (p) => placeOption(displayCountry(residenceIso(p))),
    ),
    option(
      P,
      'pr_status',
      `#${PD}-immigrationStatus`,
      'Status in the country of residence',
      'travel_history',
      residenceStatus,
    ),
    text(
      P,
      'pr_status_from',
      `#${PD}-startDateofImmigrationStatus`,
      'Status — from',
      'travel_history',
      (p) =>
        slashDate(
          pickDate(
            p,
            'status_start_date',
            'immigration_status_start_date',
            'residence_status_from',
          ),
        ),
      tempStatus,
    ),
    text(
      P,
      'pr_status_to',
      `#${PD}-endDateOfImmigrationStatus`,
      'Status — to',
      'travel_history',
      (p) =>
        slashDate(
          pickDate(
            p,
            'status_end_date',
            'immigration_status_end_date',
            'residence_status_to',
          ),
        ),
      tempStatus,
    ),
    text(
      P,
      'pr_last_entry_date',
      `#${PD}-dateOfLastEntry`,
      'Date of last entry to Canada',
      'travel_history',
      (p) =>
        slashDate(
          pickDate(
            p,
            'date_of_last_entry',
            'last_entry_date',
            'last_entry_to_canada_date',
          ),
        ),
      lastEntry,
    ),
    text(
      P,
      'pr_last_entry_place',
      `#${PD}-placeOfLastEntry`,
      'Place of last entry to Canada',
      'travel_history',
      (p) =>
        pickText(
          p,
          'place_of_last_entry',
          'last_entry_place',
          'port_of_last_entry',
        ),
      lastEntry,
    ),
    radio(
      P,
      'pr_previous_countries',
      'previous-countries-check',
      {
        Yes: `#${PD}-hasPreviousCountries-yes`,
        No: `#${PD}-hasPreviousCountries-no`,
      },
      'Lived in another country in the past five years',
      'travel_history',
      hasPreviousCountries,
    ),
    option(
      P,
      'pr_prev_country',
      `#${PD}-prevCountry0`,
      'Previous country of residence',
      'travel_history',
      (p) => prevCountry(p)?.country,
      prev,
    ),
    option(
      P,
      'pr_prev_status',
      `#${PD}-prevImmigrationStatus0`,
      'Previous country — status',
      'travel_history',
      (p) => prevCountry(p)?.status,
      prev,
    ),
    text(
      P,
      'pr_prev_from',
      `#${PD}-prevStartDateOfImmigrationStatus0`,
      'Previous country — from',
      'travel_history',
      (p) => prevCountry(p)?.from,
      prev,
    ),
    text(
      P,
      'pr_prev_to',
      `#${PD}-prevEndDateOfImmigrationStatus0`,
      'Previous country — to',
      'travel_history',
      (p) => prevCountry(p)?.to,
      prev,
    ),
    option(
      P,
      'pr_marital_status',
      `#${PD}-maritalStatus`,
      'Current marital status',
      'dates',
      maritalOption,
    ),
    // Choosing the status clears the date the form held: written after it.
    text(
      P,
      'pr_partner_since',
      `#${PD}-dateOfMarriageOrCommonLaw`,
      'Date of marriage or start of common-law relationship',
      'dates',
      (p) => slashDate(partnerSince(p)),
      partner,
    ),
    text(
      P,
      'pr_partner_family_name',
      `#${PD}-familyNameOfSpouse`,
      'Spouse or partner — family name(s)',
      'dates',
      (p) => partnerName(p).family,
      partner,
    ),
    text(
      P,
      'pr_partner_given_name',
      `#${PD}-givenNameOfSpouse`,
      'Spouse or partner — given name(s)',
      'dates',
      (p) => partnerName(p).given,
      {
        ...partner,
        silent: true,
      },
    ),
    radio(
      P,
      'pr_previously_partnered',
      'previous-relationships-check',
      {
        Yes: `#${PD}-previouslyMarriedOrCommonLaw-yes`,
        No: `#${PD}-previouslyMarriedOrCommonLaw-no`,
      },
      'Previously married or in a common-law relationship',
      'dates',
      previouslyPartnered,
      { parent: 'pr_marital_status', parentValue: HAS_PAST, reveal: true },
    ),
    text(
      P,
      'pr_past_family_name',
      '#previousRelationshipForm-previousSpouseFamilyName',
      'Previous partner — family name(s)',
      'dates',
      (p) => pastPartner(p)?.family,
      past,
    ),
    text(
      P,
      'pr_past_given_name',
      '#previousRelationshipForm-previousSpouseGivenName',
      'Previous partner — given name(s)',
      'dates',
      (p) => pastPartner(p)?.given,
      {
        ...past,
        silent: true,
      },
    ),
    text(
      P,
      'pr_past_dob',
      '#previousRelationshipForm-previousSpouseDob',
      'Previous partner — date of birth',
      'dates',
      (p) => pastPartner(p)?.dob,
      past,
    ),
    option(
      P,
      'pr_past_type',
      '#previousRelationshipForm-typeOfRelationship',
      'Previous relationship — type',
      'dates',
      (p) => pastPartner(p)?.type,
      past,
    ),
    text(
      P,
      'pr_past_from',
      '#previousRelationshipForm-startDateofRelationship',
      'Previous relationship — from',
      'dates',
      (p) => pastPartner(p)?.from,
      past,
    ),
    text(
      P,
      'pr_past_to',
      '#previousRelationshipForm-endDateOfRelationship',
      'Previous relationship — to',
      'dates',
      (p) => pastPartner(p)?.to,
      past,
    ),
  ];
}

// ── IMM 0008 page 4: contact information ───────────────────────────────────

const PHONE_TYPES: ReadonlyArray<[RegExp, string]> = [
  [/cell|mobile/, 'Cellular'],
  [/home|residen/, 'Residence'],
  [/work|business|office/, 'Business'],
  [/other/, 'Other'],
];
const phoneType = (raw: string | undefined) => {
  const s = raw?.toLowerCase();
  return s ? PHONE_TYPES.find(([re]) => re.test(s))?.[1] : undefined;
};

/** A phone placed for the portal: its location radio, code and the number as shown. */
export function portalPhone(
  raw: string | undefined,
  p: Profile,
):
  | { location: 'Canada/US' | 'Other'; code?: string; number: string }
  | undefined {
  // "+1 416 555 0100; someone@example.com" — the number before any separator.
  const first = raw?.split(/[;,/]|\s{2,}/)[0];
  const placed: PlacedPhone | undefined = placePhone(first, {
    country: residenceIso(p),
  });
  if (!placed) return undefined;
  if (placed.location === 'Canada or the U.S.') {
    const d = placed.number;
    return {
      location: 'Canada/US',
      number: `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
    };
  }
  return placed.countryCode
    ? { location: 'Other', code: placed.countryCode, number: placed.number }
    : undefined;
}

function phoneFields(
  slot: 'Primary' | 'Alternate',
  radioName: string,
  naId: string,
  otherId: string,
  label: string,
  read: (p: Profile) => string | undefined,
  readType: (p: Profile) => string | undefined,
): FillFieldMapping[] {
  const P = PR_IMM0008(4);
  const key = `pr_${slot.toLowerCase()}_phone`;
  const phone = (p: Profile) => portalPhone(read(p), p);
  // The type, code and number follow the Canada/US-or-other radio: on a fresh
  // page the country code is disabled until "Other" is chosen (live
  // 2026-10-21), and a probed disabled target refuses the whole page. Revealed
  // fields are waited for after the radio instead of probed up front.
  const shown: Extra = { parent: `${key}_location`, reveal: true };
  return [
    radio(
      P,
      `${key}_location`,
      radioName,
      { 'Canada/US': `#${naId}`, Other: `#${otherId}` },
      `${label} — Canada/US or other`,
      'addresses',
      (p) => phone(p)?.location,
      slot === 'Alternate' ? { silent: true } : {},
    ),
    option(
      P,
      `${key}_type`,
      `#${slot}Type`,
      `${label} — type`,
      'addresses',
      (p) => phoneType(readType(p)),
      { ...shown, silent: true },
    ),
    text(
      P,
      `${key}_code`,
      `#${slot}CountryCode`,
      `${label} — country code`,
      'addresses',
      (p) => phone(p)?.code,
      {
        parent: `${key}_location`,
        parentValue: 'Other',
        reveal: true,
      },
    ),
    text(
      P,
      `${key}_number`,
      `#${slot}Number`,
      `${label} — number`,
      'addresses',
      (p) => phone(p)?.number,
      shown,
    ),
  ];
}

function imm0008Page4(): FillFieldMapping[] {
  const P = PR_IMM0008(4);
  return [
    // The mailing address is the profile's (disabled here).
    ...phoneFields(
      'Primary',
      'primaryPhone',
      'primaryNA',
      'primaryOther',
      'Primary telephone',
      (p) => pickText(p, 'phone_number', 'phone', 'telephone', 'mobile_phone'),
      (p) => pickText(p, 'phone_type', 'telephone_type'),
    ),
    ...phoneFields(
      'Alternate',
      'altPhone',
      'altNA',
      'altOther',
      'Alternate telephone',
      (p) => pickText(p, 'alternate_phone', 'secondary_phone', 'alt_phone'),
      (p) => pickText(p, 'alternate_phone_type'),
    ),
    // Whether IRCC writes to the account's own email is the applicant's
    // answer; with "No" the portal asks for the address to use.
    radio(
      P,
      'pr_contact_by_account_email',
      'emailContact',
      { Yes: '#contactYes', No: '#contactNo' },
      'Contact by the account’s email address',
      'addresses',
      (p) => declared(p, 'contact_by_account_email', 'use_account_email'),
    ),
    text(
      P,
      'pr_contact_email',
      '#Email',
      'Email for IRCC to contact you',
      'addresses',
      email,
      {
        parent: 'pr_contact_by_account_email',
        parentValue: 'No',
        reveal: true,
      },
    ),
  ];
}

// ── IMM 0008 pages 5 and 6: passport, national identity document ────────────

interface IdDoc {
  number: string;
  country: string;
  issued: string;
  expires: string;
}
function passport(p: Profile, now = Date.now()): IdDoc | undefined {
  const number = pickText(p, 'passport_number')
    ?.replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  const country = pickText(
    p,
    'passport_country',
    'passport_issuing_country',
    'nationality',
  );
  const issued = pickDate(p, 'passport_issue_date');
  const expires = pickDate(p, 'passport_expiry_date');
  const listed = country ? etaCountryCodeOption(country) : null;
  if (!number || !listed || !issued || !expires || !future(expires, now))
    return undefined;
  return {
    number,
    country: listed,
    issued: slashDate(issued)!,
    expires: slashDate(expires)!,
  };
}
/** "Yes" with the passport complete and valid; "No" only when they said they have none. */
export function validPassport(p: Profile): 'Yes' | 'No' | undefined {
  if (passport(p)) return 'Yes';
  return declared(p, 'has_valid_passport', 'has_passport') === 'No'
    ? 'No'
    : undefined;
}

function nationalId(p: Profile, now = Date.now()): IdDoc | undefined {
  // IRCC: letters and numbers only (CNIC 37405-5309209-7 → 3740553092097).
  const number = pickText(
    p,
    'national_id_number',
    'national_identity_number',
    'cnic',
    'cnic_number',
  )?.replace(/[^A-Za-z0-9]/g, '');
  const country = pickText(
    p,
    'national_id_country_of_issue',
    'national_id_country',
    'nationality',
  );
  const issued = pickDate(p, 'national_id_issue_date', 'cnic_issue_date');
  const expires = pickDate(p, 'national_id_expiry_date', 'cnic_expiry_date');
  const listed = country ? etaCountryCodeOption(country) : null;
  // The portal refuses an expiry in the past: an expired card is not "a
  // valid national identity document".
  if (!number || !listed || !issued || !expires || !future(expires, now))
    return undefined;
  return {
    number,
    country: listed,
    issued: slashDate(issued)!,
    expires: slashDate(expires)!,
  };
}
export function hasNationalId(p: Profile): 'Yes' | 'No' | undefined {
  if (nationalId(p)) return 'Yes';
  return declared(p, 'has_national_id', 'has_national_identity_document') ===
    'No'
    ? 'No'
    : undefined;
}

function idPage(
  page: string,
  key: string,
  radioName: string,
  yes: string,
  no: string,
  numberId: string,
  label: string,
  read: (p: Profile) => IdDoc | undefined,
  answer: (p: Profile) => 'Yes' | 'No' | undefined,
): FillFieldMapping[] {
  const shown: Extra = { parent: key, parentValue: 'Yes', reveal: true };
  return [
    radio(
      page,
      key,
      radioName,
      { Yes: `#${yes}`, No: `#${no}` },
      `Valid ${label}`,
      'passport',
      answer,
    ),
    text(
      page,
      `${key}_number`,
      `#${numberId}`,
      `${label} — number`,
      'passport',
      (p) => read(p)?.number,
      shown,
    ),
    option(
      page,
      `${key}_country`,
      '#countryOfIssue',
      `${label} — country of issue`,
      'passport',
      (p) => read(p)?.country,
      shown,
    ),
    text(
      page,
      `${key}_issued`,
      '#issueDate',
      `${label} — issue date`,
      'passport',
      (p) => read(p)?.issued,
      shown,
    ),
    text(
      page,
      `${key}_expires`,
      '#expiryDate',
      `${label} — expiry date`,
      'passport',
      (p) => read(p)?.expires,
      shown,
    ),
  ];
}

// ── IMM 0008 pages 7 and 8: education, occupation, language ────────────────

const EDUCATION_OPTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bdoctor|\bph\.?\s?d\b/, 'Doctorate - Ph D'],
  [/master/, 'Master’s Degree'],
  [
    /post[- ]?grad.*(no degree|diploma|certificate)/,
    'Post Graduate – No Degree',
  ],
  [/bachelor|undergrad.*degree|university degree/, 'Bachelor’s Degree'],
  [
    /post[- ]?secondary.*no degree|some (university|college)/,
    'Post-Secondary – No Degree',
  ],
  // School before diplomas: a "high school diploma" is secondary. Not
  // "post-secondary", which is a college or university level.
  [
    /(?<!post[- ]?)secondary|high school|primary|elementary|matric|intermediate/,
    'Secondary or less',
  ],
  [/trade|apprentice/, 'Trade/Apprenticeship Certificate/Diploma'],
  [/college|diploma|certificate/, 'Non-University Certificate/Diploma'],
  [/^(none|no (formal )?education)$/, 'None'],
];
export const educationOption = (p: Profile) => {
  const s = pickText(
    p,
    'highest_education_level',
    'education_level',
  )?.toLowerCase();
  return s ? EDUCATION_OPTIONS.find(([re]) => re.test(s))?.[1] : undefined;
};

/** English / French / Both / Neither from the languages they speak. */
export function officialAbility(p: Profile): string | undefined {
  const s = pickText(
    p,
    'official_language_ability',
    'official_languages',
  )?.toLowerCase();
  if (!s) return undefined;
  const en = /english/.test(s);
  const fr = /french|fran/.test(s);
  if (/both/.test(s) || (en && fr)) return 'Both';
  if (en) return 'English';
  if (fr) return 'French';
  return /neither|none/.test(s) ? 'Neither' : undefined;
}
export function languageTest(p: Profile): 'Yes' | 'No' | undefined {
  const said = declared(p, 'language_test_taken', 'took_language_test');
  if (said) return said;
  return pickText(p, 'language_test_type') ? 'Yes' : undefined;
}

function imm0008Pages7And8(): FillFieldMapping[] {
  const P7 = PR_IMM0008(7);
  const P8 = PR_IMM0008(8);
  return [
    option(
      P7,
      'pr_education_level',
      '#educationLevel',
      'Highest level of education',
      'employment',
      educationOption,
    ),
    text(
      P7,
      'pr_education_years',
      '#numberOfYear',
      'Years of education in total',
      'employment',
      (p) =>
        pickText(
          p,
          'years_of_education',
          'education_years',
          'total_years_of_education',
        )?.replace(/\D/g, '') || undefined,
    ),
    text(
      P7,
      'pr_current_occupation',
      '#currentOccupation',
      'Current occupation',
      'employment',
      (p) =>
        pickText(
          p,
          'current_job_title',
          'job_title',
          'current_occupation',
          'occupation',
        ),
    ),
    text(
      P7,
      'pr_intended_occupation',
      '#intendedOccupation',
      'Intended occupation',
      'employment',
      (p) => pickText(p, 'intended_occupation'),
    ),
    option(
      P8,
      'pr_native_language',
      '#nativeLanguage',
      'Native language',
      'employment',
      (p) => irccLanguage(pickText(p, 'native_language', 'mother_tongue')),
    ),
    option(
      P8,
      'pr_official_language',
      '#language',
      'Able to communicate in English and/or French',
      'employment',
      officialAbility,
    ),
    radio(
      P8,
      'pr_language_test',
      'testing',
      { Yes: '#testing-yes', No: '#testing-no' },
      'Language test from a designated agency',
      'employment',
      languageTest,
    ),
  ];
}

// ── IMM 5406: Section A (applicant, spouse, parents) ───────────────────────

/** IMM 5406's marital list: "Married - Physically Present" when the wedding had both of them. */
export function marital5406(p: Profile): string | undefined {
  const s = maritalOption(p);
  if (!s) return undefined;
  if (s === 'Married') {
    const proxy = declared(p, 'marriage_by_proxy', 'proxy_marriage');
    if (proxy === 'Yes') return 'Married - Not Physically Present';
    // A ceremony on record is a marriage they both attended.
    if (
      proxy === 'No' ||
      pick(p, 'relationship_ceremonies', 'relationship_ceremony_2_type')
    )
      return 'Married - Physically Present';
    return undefined;
  }
  if (s === 'Separated') return 'Legally Separated';
  return s;
}

/** "City, Country" for the form's 80-character address boxes. */
const cityCountry = (a: Address | undefined) =>
  a?.city && a.country ? `${a.city}, ${displayCountry(a.country)}` : undefined;

const partnered = (p: Profile) =>
  (PARTNERED as readonly string[]).includes(maritalOption(p) ?? '');

function parentFields(
  prefix: 'mother' | 'father',
  label: string,
): FillFieldMapping[] {
  const P = PR_IMM5406;
  const deceased = (p: Profile) =>
    declared(p, `${prefix}_deceased`, `${prefix}_is_deceased`) === 'Yes';
  return [
    text(
      P,
      `pr5406_${prefix}_name`,
      `#${prefix}FullName`,
      `${label} — full name`,
      'passport',
      (p) => pickText(p, `${prefix}_full_name`, `${prefix}_name`),
    ),
    text(
      P,
      `pr5406_${prefix}_dob`,
      `#${prefix}DOB`,
      `${label} — date of birth`,
      'passport',
      (p) => slashDate(pickDate(p, `${prefix}_date_of_birth`)),
    ),
    text(
      P,
      `pr5406_${prefix}_birthplace`,
      `#${prefix}Birthplace`,
      `${label} — country of birth`,
      'passport',
      (p) =>
        displayCountry(
          pickCountry(p, `${prefix}_country_of_birth`) ?? undefined,
        ),
    ),
    option(
      P,
      `pr5406_${prefix}_marital`,
      `#${prefix}MaritalStatus`,
      `${label} — marital status`,
      'passport',
      (p) => {
        if (deceased(p)) return 'Not Applicable - Deceased';
        const s = pickText(
          p,
          `${prefix}_marital_status`,
          'parents_marital_status',
        )?.toLowerCase();
        return s
          ? MARITAL_OPTIONS.find(([re]) => re.test(s))?.[1].replace(
              'Separated',
              'Legally Separated',
            )
          : undefined;
      },
    ),
    // A deceased parent's address is "city, country and date": left.
    text(
      P,
      `pr5406_${prefix}_address`,
      `#${prefix}Address`,
      `${label} — address`,
      'addresses',
      (p) => {
        if (deceased(p)) return undefined;
        if (declared(p, `${prefix}_same_address`) === 'Yes')
          return cityCountry(residentialAddress(p));
        return cityCountry(
          parseAddressLine(pickText(p, `${prefix}_address`)) ?? undefined,
        );
      },
      { maxLength: 80 },
    ),
  ];
}

function imm5406(): FillFieldMapping[] {
  const P = PR_IMM5406;
  const partnerHome = (p: Profile) =>
    parseAddressLine(
      pickText(p, 'spouse_address', 'sponsor_residential_address'),
      'CAN',
    );
  return [
    // Name and date of birth are the profile's (disabled here).
    text(
      P,
      'pr5406_birthplace',
      '#applicantBirthplace',
      'You — country of birth',
      'passport',
      (p) =>
        displayCountry(
          pickCountry(p, 'country_of_birth', 'birth_country') ??
            splitPlace(pickText(p, 'place_of_birth')).country,
        ),
    ),
    option(
      P,
      'pr5406_marital',
      '#applicantMaritalStatus',
      'You — marital status',
      'dates',
      marital5406,
    ),
    text(
      P,
      'pr5406_email',
      '#applicantEmail',
      'You — email',
      'addresses',
      email,
    ),
    text(
      P,
      'pr5406_address',
      '#applicantAddress',
      'You — address (city, country)',
      'addresses',
      (p) => cityCountry(residentialAddress(p)),
      { maxLength: 80 },
    ),
    text(
      P,
      'pr5406_partner_name',
      '#partnerFullName',
      'Spouse — full name',
      'dates',
      (p) => {
        if (!partnered(p)) return undefined;
        const n = partnerName(p);
        return n.family
          ? [n.given, n.family].filter(Boolean).join(' ')
          : undefined;
      },
    ),
    text(
      P,
      'pr5406_partner_dob',
      '#partnerDOB',
      'Spouse — date of birth',
      'dates',
      (p) =>
        partnered(p)
          ? slashDate(
              pickDate(p, 'spouse_date_of_birth', 'sponsor_date_of_birth'),
            )
          : undefined,
    ),
    text(
      P,
      'pr5406_partner_birthplace',
      '#partnerBirthplace',
      'Spouse — country of birth',
      'dates',
      (p) => {
        if (!partnered(p)) return undefined;
        const raw = pickText(
          p,
          'spouse_country_of_birth',
          'sponsor_country_of_birth',
        );
        return displayCountry(
          toIso3(raw) ?? splitPlace(raw).country ?? undefined,
        );
      },
    ),
    option(
      P,
      'pr5406_partner_marital',
      '#partnerMaritalStatus',
      'Spouse — marital status',
      'dates',
      (p) => (partnered(p) ? marital5406(p) : undefined),
    ),
    text(
      P,
      'pr5406_partner_email',
      '#partnerEmail',
      'Spouse — email',
      'addresses',
      (p) =>
        partnered(p)
          ? pickText(
              p,
              'spouse_email',
              'sponsor_email',
              'sponsor_email_address',
            )
          : undefined,
      { silent: true },
    ),
    text(
      P,
      'pr5406_partner_address',
      '#partnerAddress',
      'Spouse — address (city, country)',
      'addresses',
      (p) => (partnered(p) ? cityCountry(partnerHome(p)) : undefined),
      { maxLength: 80 },
    ),
    ...parentFields('mother', 'Mother'),
    ...parentFields('father', 'Father'),
  ];
}

// ── IMM 5406 sections B and C: children, brothers and sisters ──────────────
//
// Both sections REUSE the same row ids (relationship0, fullName0, dob0,
// countryOfBirth0, maritalStatus0 (select), emailAddress0, address0; live
// 2026-10-20) and the side navigation names both sections on every screen,
// so each is scoped to the heading of its first row: "Child 1" in Section B,
// "Siblings 1" in Section C. They show no principal marker: `>> principal`
// lets them through only on a form whose Section A showed it.
const SECTION_B_5406 = /\bChild 1\b/;
const SECTION_C_5406 = /\bSiblings? 1\b/;

/** A relative's marital status as IMM 5406 lists it; "Married" (present or not?) is not guessed. */
export function relativeMarital(raw: unknown): string | undefined {
  const s = known(raw)?.toLowerCase();
  if (!s) return undefined;
  const m = MARITAL_OPTIONS.find(([re]) => re.test(s))?.[1];
  if (m === 'Married') return undefined;
  return m === 'Separated' ? 'Legally Separated' : m;
}

const capitalised = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "son" → "Son", "step-daughter" → "Step-daughter"; only a child's relationship. */
export function childRelationship(r: Profile): string | undefined {
  const t = known(r.relationship)?.trim().toLowerCase();
  return t && /^(step-?|adopted )?(son|daughter|child)$/.test(t)
    ? capitalised(t)
    : undefined;
}

/** "brother" / "half-sister" as said, else from their sex. */
export function siblingRelationship(r: Profile): string | undefined {
  const t = known(r.relationship)?.trim().toLowerCase();
  if (t)
    return /^(half-|step-)?(brother|sister|sibling)$/.test(t)
      ? capitalised(t)
      : undefined;
  const sex = known(r.sex ?? r.gender)?.toLowerCase();
  if (sex && /^(m|male|man)$/.test(sex)) return 'Brother';
  if (sex && /^(f|female|woman)$/.test(sex)) return 'Sister';
  return undefined;
}

const personName = (r: Profile) =>
  known(r.full_name ?? r.name) ??
  ([known(r.given_name), known(r.family_name)].filter(Boolean).join(' ') ||
    undefined);

/** Where a relative lives, as the 80-character box takes it: "City, Country". */
function relativeHome(r: Profile, p: Profile): string | undefined {
  if (intakeAnswerIsYes(r.deceased ?? r.is_deceased) === true) return undefined;
  if (intakeAnswerIsYes(r.lives_with_applicant ?? r.lives_with_you) === true)
    return cityCountry(residentialAddress(p));
  const raw = known(r.address ?? r.current_address);
  const place = splitPlace(raw); // "Karachi, Pakistan"
  return (
    cityCountry(parseAddressLine(raw) ?? undefined) ??
    (place.city && place.country
      ? `${place.city}, ${displayCountry(place.country)}`
      : undefined) ??
    cityAndCountry(r)
  );
}

const relativeBirthCountry = (r: Profile) =>
  countryText(r.country_of_birth ?? r.birth_country) ??
  displayCountry(splitPlace(known(r.place_of_birth)).country);

const relativeDob = (r: Profile) =>
  slashDate(pickDate(r, 'date_of_birth', 'dob', 'birth_date'));

/** The children in IMM 5406's order (as listed), each row complete, or none. */
const childrenOf5406 = (p: Profile) =>
  completeRows(people(p, 'children', 'children_details'), (r) =>
    relativeComplete(r, p, childRelationship),
  );
const siblingsOf = (p: Profile) =>
  completeRows(people(p, 'siblings', 'brothers_and_sisters'), (r) =>
    relativeComplete(r, p, siblingRelationship),
  );

function relativeComplete(
  r: Profile,
  p: Profile,
  relationship: (r: Profile) => string | undefined,
): boolean {
  const home = relativeHome(r, p);
  return (
    !!relationship(r) &&
    !!personName(r) &&
    !!relativeDob(r) &&
    !!relativeBirthCountry(r) &&
    !!relativeMarital(r.marital_status) &&
    !!home &&
    home.length <= 80
  );
}

const relativeFields = (
  relationship: (r: Profile) => string | undefined,
): RowField[] => [
  { id: 'relationship', label: 'relationship', read: (r) => relationship(r) },
  { id: 'fullName', label: 'full name', read: (r) => personName(r) },
  { id: 'dob', label: 'date of birth', read: (r) => relativeDob(r) },
  {
    id: 'countryOfBirth',
    label: 'country of birth',
    read: (r) => relativeBirthCountry(r),
  },
  {
    id: 'emailAddress',
    label: 'email',
    read: (r) => known(r.email ?? r.email_address),
  },
  {
    id: 'address',
    label: 'address (city, country)',
    read: (r, p) => relativeHome(r, p),
    maxLength: 80,
  },
  {
    id: 'maritalStatus',
    label: 'marital status',
    read: (r) => relativeMarital(r.marital_status),
    select: true,
  },
];

function imm5406Rows(): FillFieldMapping[] {
  const at = (pageMatch: RegExp): RowPlace => ({
    page: PR_IMM5406,
    pageMatch,
    principalForm: true,
  });
  return [
    ...rowSection(
      'pr5406_child',
      'Child',
      at(SECTION_B_5406),
      'passport',
      childrenOf5406,
      relativeFields(childRelationship),
    ),
    ...rowSection(
      'pr5406_sibling',
      'Brother or sister',
      at(SECTION_C_5406),
      'passport',
      siblingsOf,
      relativeFields(siblingRelationship),
    ),
  ];
}

// ── IMM 5562: your travels (one form per application, the principal's) ────
//
// /…/imm5562?pageId=page2..4, no documentId (live 2026-10-20): not one form
// per person, so no principal marker is needed. Sections A (you), B (your
// spouse or partner) and C (children 18 and over) reuse trip-from-{i},
// trip-to-{i}, trip-length-{i}, trip-purpose-{i} and #haveNotTravelled; each
// is scoped to the section by the destination id only it has
// (trip-destination / sectionB-destination / sectionC-destination).
const IN_5562_A = 'body:has(#trip-destination-0)';
const IN_5562_B = 'body:has(#sectionB-destination-0)';
const IN_5562_C = 'body:has(#sectionC-destination-0)';

/** "6 days": as said, else counted from exact dates (both days inclusive). */
export function tripLength(r: Profile): string | undefined {
  const said = known(r.length ?? r.duration ?? r.length_of_stay);
  // "6" says nothing (days? weeks?): only a length with its unit.
  if (said) return /^\d+([.,]\d+)?$/.test(said) ? undefined : said;
  const from = pickDate(r, 'from', 'from_date', 'start_date');
  const to = pickDate(r, 'to', 'to_date', 'end_date');
  const a = from ? isoDayMs(from) : null;
  const b = to ? isoDayMs(to) : null;
  if (a === null || b === null || b < a) return undefined;
  const days = Math.round((b - a) / 86_400_000) + 1;
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

const tripDestination = (r: Profile) =>
  cityAndCountry(r) ?? countryText(r.country ?? r.destination);

const tripComplete = (r: Profile) =>
  !!monthOf(r.from) &&
  !!monthOf(r.to) &&
  !!tripDestination(r) &&
  !!tripLength(r) &&
  !!known(r.purpose);

/** "No" to travel in the past 10 years, said in so many words. */
const noTravel = (p: Profile) =>
  declared(p, 'has_travel_history_last_10_years', 'travelled_last_10_years') ===
  'No';

/**
 * The applicant's trips of the past 10 years. The interview's 5-year list
 * (`travel_history`) is NOT used: written here it would read as all of the
 * last 10 years.
 */
const tripsOf = (p: Profile) =>
  noTravel(p)
    ? []
    : completeRows(
        lastTenYears(people(p, 'travel_history_10_years', 'trips_10_years')),
        tripComplete,
      );

/** A "No" with trips on the list: the answers disagree, nothing is written. */
const travelConflict = (p: Profile) =>
  noTravel(p) &&
  people(p, 'travel_history_10_years', 'trips_10_years').length > 0;

/** Newest first, without trips that ended more than 10 years ago (IMM 5562 asks 10). */
function lastTenYears(trips: Profile[]): Profile[] {
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10);
  const since = cutoff.toISOString().slice(0, 7).replace('-', '/');
  return newestFirst(trips).filter((t) => {
    const end = monthOf(t.to);
    return !end || end >= since;
  });
}

const spouseTripsOf = (p: Profile) =>
  completeRows(
    lastTenYears(people(p, 'spouse_travel_history_10_years')),
    tripComplete,
  );

/** Children 18 or over on the application, one row per trip with their given name. */
function adultChildTripsOf(p: Profile): Profile[] {
  const rows: Profile[] = [];
  const adult = Date.now() - 18 * 365.25 * 86_400_000;
  for (const c of people(p, 'children', 'children_details')) {
    const born = pickDate(c, 'date_of_birth', 'dob');
    const ms = born ? isoDayMs(born) : null;
    if (ms === null || ms > adult) continue;
    const given = known(c.given_name) ?? personName(c)?.split(/\s+/)[0];
    for (const t of lastTenYears(people(c, 'travel_history_10_years')))
      rows.push({ ...t, given_name: given });
  }
  return completeRows(rows, (r) => !!known(r.given_name) && tripComplete(r));
}

const tripFields = (destinationId: string): RowField[] => [
  { id: 'trip-from-', label: 'from', read: (r) => monthOf(r.from) },
  { id: 'trip-to-', label: 'to', read: (r) => monthOf(r.to) },
  { id: destinationId, label: 'destination', read: tripDestination },
  { id: 'trip-length-', label: 'length of stay', read: tripLength },
  { id: 'trip-purpose-', label: 'purpose', read: (r) => known(r.purpose) },
];

function imm5562(): FillFieldMapping[] {
  const P = PR_IMM5562;
  const within =
    (guard: string) =>
    (id: string, i: number): string =>
      `${guard} #${id}${i}`;
  return [
    text(
      P,
      'pr5562_family_name',
      `${IN_5562_A} #familyName`,
      'Your travels — family name',
      'travel_history',
      familyName,
      { keepExisting: true },
    ),
    text(
      P,
      'pr5562_given_name',
      `${IN_5562_A} #givenName`,
      'Your travels — given name(s)',
      'travel_history',
      givenName,
      { keepExisting: true, silent: true },
    ),
    // Factual, but never defaulted: ticked only from an explicit "No".
    check(
      P,
      'pr5562_not_travelled',
      `${IN_5562_A} #haveNotTravelled`,
      'Your travels — did not travel in the past 10 years',
      'travel_history',
      (p) => (noTravel(p) && !travelConflict(p) ? 'Yes' : undefined),
      { declaration: true },
    ),
    ...rowSection(
      'pr5562_trip',
      'Your trip',
      { page: P, css: within(IN_5562_A) },
      'travel_history',
      tripsOf,
      tripFields('trip-destination-'),
    ),
    ...rowSection(
      'pr5562_spouse_trip',
      'Spouse’s trip',
      { page: P, css: within(IN_5562_B) },
      'travel_history',
      spouseTripsOf,
      tripFields('sectionB-destination-'),
    ),
    ...rowSection(
      'pr5562_child_trip',
      'Child’s trip',
      { page: P, css: within(IN_5562_C) },
      'travel_history',
      adultChildTripsOf,
      [
        {
          id: 'trip-givenName-',
          label: 'given name',
          read: (r) => known(r.given_name),
        },
        ...tripFields('sectionC-destination-'),
      ],
    ),
  ];
}

// ── IMM 5669: Section A, the questionnaire, the "None" sections ────────────

/**
 * The background questions, each from the applicant's own answer under the
 * keys the spousal interview (IRCC_SPOUSAL_FACTS) and older answers use.
 */
const BACKGROUND: ReadonlyArray<{
  name: string;
  label: string;
  keys: readonly string[];
}> = [
  {
    name: 'isConvictedInCanada',
    label: 'Convicted of a crime in Canada (no pardon)',
    keys: ['convicted_in_canada'],
  },
  {
    name: 'isConvictedOutsideCanada',
    label: 'Convicted, charged or on trial outside Canada',
    keys: ['convicted_outside_canada'],
  },
  {
    name: 'isClaimedRefugeeProtection',
    label: 'Made a previous claim for refugee protection',
    keys: ['refugee_claim_made', 'claimed_refugee_protection'],
  },
  {
    name: 'isRefusedRefugeeOrVisa',
    label: 'Refused refugee status or a visa, or refused a permit',
    keys: [],
  },
  {
    name: 'isOrderedToLeaveCountry',
    label: 'Refused admission to, or ordered to leave, any country',
    keys: [],
  },
  {
    name: 'isWarCriminal',
    label: 'Involved in genocide, a war crime or a crime against humanity',
    keys: ['war_crimes_involvement', 'war_crimes'],
  },
  {
    name: 'isCommittedActOfViolence',
    label: 'Used, planned or advocated armed struggle or violence',
    keys: ['advocated_violence'],
  },
  {
    name: 'isAssociatedWithViolentGroup',
    label: 'Associated with a group that uses or advocates violence',
    keys: ['violent_organization_member'],
  },
  {
    name: 'isMemberOfCriminalOrg',
    label: 'Member of an organization engaged in criminal activity',
    keys: [
      'criminal_pattern_organization_member',
      'criminal_organization_member',
    ],
  },
  {
    name: 'isDetainedOrJailed',
    label: 'Detained, incarcerated or put in jail',
    keys: ['ever_detained', 'detained_or_jailed'],
  },
  {
    name: 'isPhysicalOrMentalDisorder',
    label: 'Any serious disease or physical or mental disorder',
    keys: ['serious_medical_condition'],
  },
];

/**
 * One background answer (phase 2: not written yet, see PRINCIPAL ONLY). The
 * two conviction questions also read the interview's combined answers: "No"
 * to being charged AND convicted is "No" to both; a "Yes" says nothing about
 * where, so it is left. Question 4 covers a refused visa or permit AND
 * refused refugee status, question 5 refused admission AND an order to
 * leave: each is "No" only when every part was answered "No" (the combined
 * refused_or_ordered_to_leave "No" counts for the refusal and order parts).
 */
/** Any of the keys answered "Yes" (declared() stops at the first answer). */
const anyYes = (p: Profile, ...keys: string[]) =>
  keys.some((k) => declared(p, k) === 'Yes');

export function backgroundAnswer(
  p: Profile,
  name: string,
): 'Yes' | 'No' | undefined {
  const q = BACKGROUND.find((b) => b.name === name);
  if (!q) return undefined;
  const own = declared(p, ...q.keys);
  if (own) return own;
  if (name === 'isConvictedInCanada' || name === 'isConvictedOutsideCanada')
    return declared(p, 'ever_convicted') === 'No' &&
      declared(p, 'ever_charged') === 'No'
      ? 'No'
      : undefined;
  const combinedNo = declared(p, 'refused_or_ordered_to_leave') === 'No';
  if (name === 'isRefusedRefugeeOrVisa') {
    // A claim made is not a claim refused: refugee_claim_made only says "No".
    if (anyYes(p, 'refused_visa', 'visa_refused', 'refused_refugee_status'))
      return 'Yes';
    const visaNo =
      declared(p, 'refused_visa', 'visa_refused') === 'No' || combinedNo;
    const refugeeNo =
      declared(p, 'refused_refugee_status', 'refugee_claim_made') === 'No';
    return visaNo && refugeeNo ? 'No' : undefined;
  }
  if (name === 'isOrderedToLeaveCountry') {
    if (
      anyYes(
        p,
        'refused_admission',
        'denied_entry',
        'ordered_to_leave',
        'removal_order',
        'deported',
      )
    )
      return 'Yes';
    const admissionNo =
      declared(p, 'refused_admission', 'denied_entry') === 'No' || combinedNo;
    const orderNo =
      declared(p, 'ordered_to_leave', 'removal_order', 'deported') === 'No' ||
      combinedNo;
    return admissionNo && orderNo ? 'No' : undefined;
  }
  return undefined;
}

/**
 * "None" for a section the applicant answered with nothing to list. Phase 2:
 * sections E, F and G (like the questionnaire) carry no principal-applicant
 * marker, so they are not filled yet (see PRINCIPAL ONLY below).
 */
export const noneOf =
  (...keys: string[]) =>
  (p: Profile): 'Yes' | undefined => {
    // Only an explicit answer ticks "None": a declared "No" / "none" on the
    // key. An empty list or no answer is not "none" (review M1).
    // The FIRST answered key decides: free text there ("Rotary Club") is a
    // membership, so a later yes/no key saying "No" never overrides it.
    const v = pick(p, ...keys);
    if (Array.isArray(v)) return undefined;
    return intakeAnswerIsYes(v) === false ? 'Yes' : undefined;
  };

function imm5669(): FillFieldMapping[] {
  const P = PR_IMM5669;
  const father = (p: Profile) => nameParts(p, 'father');
  const fatherBirth = (p: Profile) =>
    splitPlace(pickText(p, 'father_place_of_birth'));
  const motherBirth = (p: Profile) =>
    splitPlace(pickText(p, 'mother_place_of_birth'));
  return [
    // Section A. Name and date of birth are the profile's (disabled here).
    text(
      P,
      'pr5669_native_name',
      '#nativeFullName',
      'Full name in your native script',
      'passport',
      (p) =>
        pickText(
          p,
          'native_script_name',
          'name_in_native_script',
          'native_full_name',
        ),
    ),
    text(
      P,
      'pr5669_father_family',
      '#familyNameFather',
      'Father — family name(s)',
      'passport',
      (p) => father(p).family,
    ),
    text(
      P,
      'pr5669_father_given',
      '#givenNameFather',
      'Father — given name(s)',
      'passport',
      (p) => father(p).given,
    ),
    text(
      P,
      'pr5669_father_dob',
      '#sectionAFormFatherDOB',
      'Father — date of birth',
      'passport',
      (p) => slashDate(pickDate(p, 'father_date_of_birth')),
    ),
    text(
      P,
      'pr5669_father_death',
      '#sectionAFormFatherDeceasedDate',
      'Father — date of death',
      'passport',
      (p) =>
        declared(p, 'father_deceased') === 'Yes'
          ? slashDate(pickDate(p, 'father_date_of_death'))
          : undefined,
      { silent: true },
    ),
    text(
      P,
      'pr5669_father_birth_city',
      '#sectionAFormFatherCityOfBirth',
      'Father — town/city of birth',
      'passport',
      (p) => pickText(p, 'father_city_of_birth') ?? fatherBirth(p).city,
    ),
    text(
      P,
      'pr5669_father_birth_country',
      '#sectionAFormFatherCountryOfBirth',
      'Father — country of birth',
      'passport',
      (p) =>
        displayCountry(
          pickCountry(p, 'father_country_of_birth') ?? fatherBirth(p).country,
        ),
    ),
    // "Family name at birth": only a recorded birth or maiden name, never a
    // guess from her current name.
    text(
      P,
      'pr5669_mother_family',
      '#familyNameMother',
      'Mother — family name(s) at birth',
      'passport',
      (p) =>
        pickText(
          p,
          'mother_family_name_at_birth',
          'mother_maiden_name',
          'mother_birth_family_name',
        ),
    ),
    text(
      P,
      'pr5669_mother_given',
      '#givenNameMother',
      'Mother — given name(s)',
      'passport',
      (p) => pickText(p, 'mother_given_name') ?? nameParts(p, 'mother').given,
    ),
    text(
      P,
      'pr5669_mother_dob',
      '#sectionAFormMotherDOB',
      'Mother — date of birth',
      'passport',
      (p) => slashDate(pickDate(p, 'mother_date_of_birth')),
    ),
    text(
      P,
      'pr5669_mother_death',
      '#sectionAFormMotherDeceasedDate',
      'Mother — date of death',
      'passport',
      (p) =>
        declared(p, 'mother_deceased') === 'Yes'
          ? slashDate(pickDate(p, 'mother_date_of_death'))
          : undefined,
      { silent: true },
    ),
    text(
      P,
      'pr5669_mother_birth_city',
      '#sectionAFormMotherCityOfBirth',
      'Mother — town/city of birth',
      'passport',
      (p) => pickText(p, 'mother_city_of_birth') ?? motherBirth(p).city,
    ),
    text(
      P,
      'pr5669_mother_birth_country',
      '#sectionAFormMotherCountryOfBirth',
      'Mother — country of birth',
      'passport',
      (p) =>
        displayCountry(
          pickCountry(p, 'mother_country_of_birth') ?? motherBirth(p).country,
        ),
    ),
  ];
}

// ── IMM 5669 sections B–H (principal applicant's form only) ────────────────

/** The section headings of IMM 5669 (live 2026-10-20); the ids repeat across them. */
const SECTION_B = /Section B: Questionnaire/;
const SECTION_C = /Section C: Education/;
const SECTION_D = /Section D: Personal history/;
const SECTION_E = /Section E: Membership/;
const SECTION_F = /Section F: Government positions/;
const SECTION_G = /Section G: Military/;
const SECTION_H = /Section H: Addresses/;

/** Most rows the assistant adds to one section. */
export const MAX_ROWS = 10;

const UNKNOWN = /^(unknown|not known|n\/?a|none|-+)$/i;
const ONGOING =
  /^(present|now|current(ly)?|ongoing|to date|today|still studying)$/i;
const known = (v: unknown): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const t = String(v).trim();
  return t && !UNKNOWN.test(t) ? t : undefined;
};

/**
 * This month, YYYY/MM (an ongoing period ends now). "Now" is when the fill
 * instructions are built (the review lock), so a lock taken in one month and
 * filled in the next writes the earlier month — the reviewed value.
 */
const thisMonth = () => new Date().toISOString().slice(0, 7).replace('-', '/');

/** "2016-10" / "2016-10-03" → "2016/10"; "present" → this month; else nothing. */
export function monthOf(v: unknown, ongoingOk = false): string | undefined {
  const t = known(v);
  if (!t) return undefined;
  if (ongoingOk && ONGOING.test(t)) return thisMonth();
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(t);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const countryText = (v: unknown) => {
  const t = known(v);
  return t ? (displayCountry(toIso3(t) ?? undefined) ?? t) : undefined;
};
const cityAndCountry = (r: Profile) => {
  const city = known(r.city);
  const country = countryText(r.country);
  return city && country ? `${city}, ${country}` : undefined;
};

/** Newest first by the "from" month (IRCC: start with the most recent). */
const newestFirst = (rows: Profile[]) =>
  [...rows].sort((a, b) =>
    (known(b.from) ?? '').localeCompare(known(a.from) ?? ''),
  );

/**
 * A section's rows, or nothing: every row must be complete (an incomplete
 * row cannot be saved), and no more than MAX_ROWS.
 */
function completeRows(
  rows: Profile[],
  complete: (r: Profile, i: number) => boolean,
): Profile[] {
  if (rows.length === 0 || rows.length > MAX_ROWS) return [];
  return rows.every(complete) ? rows : [];
}

/** The diploma box takes 17 characters: the usual names, shortened. */
export function diplomaText(level: unknown): string | undefined {
  const t = known(level);
  if (!t) return undefined;
  const s = t.toLowerCase();
  if (/\bdoctor|\bph\.?\s?d\b/.test(s)) return 'Doctorate';
  if (/master/.test(s)) return "Master's Degree";
  if (/bachelor/.test(s)) return "Bachelor's Degree";
  if (/associate/.test(s)) return 'Associate Degree';
  if (/(?<!post[- ]?)secondary|high school|matric|intermediate/.test(s))
    return 'High School';
  if (/diploma/.test(s)) return 'Diploma';
  if (/certificate/.test(s)) return 'Certificate';
  return t.length <= 17 ? t : undefined;
}

const schoolsOf = (p: Profile) =>
  completeRows(
    newestFirst(
      people(p, 'education_history', 'schools', 'post_secondary_schools'),
    ),
    (r) =>
      !!monthOf(r.from) &&
      !!monthOf(r.to, true) &&
      !!known(r.school ?? r.institution ?? r.name) &&
      !!cityAndCountry(r) &&
      !!diplomaText(r.level ?? r.level_of_study) &&
      !!known(r.field_of_study ?? r.field),
  );

/** "Unemployed" rows say so; IRCC's box for them takes the employer "N/A". */
const isUnemployed = (r: Profile) =>
  /^(unemployed|not working|no work|job ?seeking)$/i.test(
    known(r.activity) ?? '',
  );

/** Status where they lived, in the 14 characters the box takes. */
export function shortStatus(r: Profile, p: Profile): string | undefined {
  const said = known(r.status);
  if (said) {
    const s = said.toLowerCase();
    if (/citizen/.test(s)) return 'Citizen';
    if (/permanent/.test(s)) return 'Perm. resident';
    if (/work/.test(s)) return 'Worker';
    if (/stud/.test(s)) return 'Student';
    if (/visit/.test(s)) return 'Visitor';
    return said.length <= 14 ? said : undefined;
  }
  const where = toIso3(known(r.country) ?? '');
  return where && where === nationalityIso(p) ? 'Citizen' : undefined;
}

const activityOf = (r: Profile) =>
  isUnemployed(r)
    ? 'Unemployed'
    : known(r.activity ?? r.job_title ?? r.occupation);
const employerOf = (r: Profile) =>
  known(r.employer ?? r.school ?? r.company) ??
  (isUnemployed(r) ? 'N/A' : undefined);

const historyOf = (p: Profile) =>
  completeRows(
    newestFirst(
      people(
        p,
        'work_history',
        'employment_history',
        'previous_jobs',
        'previous_employment',
      ),
    ),
    // Every box a row needs, within the form's limits (activity 21, status
    // 14): a row with one blank box cannot be saved, and the section is left
    // whole rather than half-filled.
    (r) =>
      !!monthOf(r.from) &&
      !!monthOf(r.to, true) &&
      (activityOf(r)?.length ?? 99) <= 21 &&
      !!shortStatus(r, p) &&
      !!employerOf(r) &&
      !!cityAndCountry(r),
  );

const addressesOf = (p: Profile) =>
  completeRows(
    newestFirst(people(p, 'address_history', 'previous_addresses')),
    // Row 0 is IRCC's current-address row: copied from the portal profile and
    // locked, so only its "from" is ours (live 2026-10-21). That holds only
    // when the newest address is still current (no end date, or "present");
    // a newest address that ended is not the row IRCC shows, and the section
    // is left whole.
    (r, i) =>
      !!monthOf(r.from) &&
      (i === 0
        ? !known(r.to) || ONGOING.test(String(known(r.to)))
        : !!monthOf(r.to, true) &&
          !!known(r.street ?? r.address) &&
          !!known(r.city) &&
          !!countryText(r.country)),
  );

interface RowField {
  id: string;
  label: string;
  read: (r: Profile, p: Profile) => string | undefined;
  maxLength?: number;
  /** Not on row 0: the portal fills and locks it there (Section H's current address). */
  notOnFirstRow?: boolean;
  /** A <select>, chosen by option text (IMM 5406 marital status). */
  select?: boolean;
}

/** Where a repeating section lives and how its row boxes are named. */
interface RowPlace {
  page: string;
  /** The screen text of this section (ids repeat across sections). */
  pageMatch?: RegExp;
  /** Only on the principal applicant's own form (IMM 5406 / IMM 5669). */
  principalForm?: boolean;
  /**
   * Row i's box: `#<id><i>` by default. IMM 5562 scopes its boxes to the
   * section by an id only that section has (`body:has(#…) #…`).
   */
  css?: (id: string, i: number) => string;
}

/**
 * One repeating section: row i's fields are `#<id><i>`. Row 0 is on the page;
 * each later row is first added (`row_add`: one guarded "Add another" click,
 * only when the row is not there) and its fields then fill as they appear.
 * Every write is scoped to the section (its heading, or an id only it has)
 * and, on IMM 5406 / IMM 5669, to the principal applicant's own form.
 */
function rowSection(
  prefix: string,
  title: string,
  place: RegExp | RowPlace,
  category: Category,
  rows: (p: Profile) => Profile[],
  fields: RowField[],
): FillFieldMapping[] {
  const at: RowPlace =
    place instanceof RegExp
      ? { page: PR_IMM5669, pageMatch: place, principalForm: true }
      : place;
  const P = at.page;
  const css = at.css ?? ((id: string, i: number) => `#${id}${i}`);
  // One group: excluding any of its entries excludes the section (review L6).
  const scope: Extra = {
    ...(at.pageMatch ? { pageMatch: at.pageMatch } : {}),
    ...(at.principalForm ? { principalForm: true } : {}),
    group: prefix,
  };
  const first = fields[0].id;
  const out: FillFieldMapping[] = [
    // The section guard, before any of its rows: the page may hold no more
    // rows than the reviewed data (`>> rows=N`), or the section is refused —
    // never mixed with rows someone else entered (review L5).
    {
      page: P,
      profileKey: `${prefix}_rows`,
      selector: css(first, 0),
      choices: Object.fromEntries(
        Array.from({ length: MAX_ROWS }, (_, k) => [
          `${title}: ${k + 1} ${k === 0 ? 'row' : 'rows'}`,
          `${css(first, 0)} >> rows=${k + 1}`,
        ]),
      ),
      action: 'fill',
      op: 'row_add',
      label: `${title} — rows on the page`,
      category,
      derive: (p) => {
        const n = rows(p).length;
        return n > 0 ? `${title}: ${n} ${n === 1 ? 'row' : 'rows'}` : undefined;
      },
      silent: true,
      ...scope,
    },
  ];
  for (let i = 0; i < MAX_ROWS; i++) {
    const rowAt = (p: Profile) => rows(p)[i];
    const row: Extra =
      i === 0
        ? { ...scope, parent: `${prefix}_rows` }
        : { ...scope, parent: `${prefix}_row${i}`, reveal: true };
    if (i > 0)
      out.push({
        page: P,
        profileKey: `${prefix}_row${i}`,
        selector: css(first, i),
        action: 'fill',
        op: 'row_add',
        label: `${title} — add row ${i + 1}`,
        category,
        derive: (p) => (rowAt(p) ? `${title} row ${i + 1}` : undefined),
        silent: true,
        ...scope,
        parent: `${prefix}_rows`,
      });
    for (const f of fields.filter((x) => i > 0 || !x.notOnFirstRow)) {
      const read = (p: Profile) => {
        const r = rowAt(p);
        return r ? f.read(r, p) : undefined;
      };
      const label = `${title} ${i + 1} — ${f.label}`;
      out.push(
        f.select
          ? // A select keeps nothing (`keep` is for boxes): it comes after
            // the row's text boxes, so a row that already holds someone
            // else's name stops the run before it is reached.
            option(
              P,
              `${prefix}_${f.id}${i}`,
              css(f.id, i),
              label,
              category,
              read,
              {
                ...row,
                silent: true,
              },
            )
          : text(
              P,
              `${prefix}_${f.id}${i}`,
              css(f.id, i),
              label,
              category,
              read,
              {
                ...row,
                // A box already holding a different value is not overwritten.
                keepExisting: true,
                silent: true,
                ...(f.maxLength ? { maxLength: f.maxLength } : {}),
              },
            ),
      );
    }
  }
  return out;
}

function imm5669Later(): FillFieldMapping[] {
  const P = PR_IMM5669;
  const years = (key: string, label: string, ...keys: string[]) =>
    text(
      P,
      `pr5669_years_${key}`,
      `#${key}`,
      `Years of school — ${label}`,
      'employment',
      // The first whole number only ("12 years (10 + 2)" → 12), never
      // digits run together.
      (p) => /^\s*(\d{1,2})\b/.exec(pickText(p, ...keys) ?? '')?.[1],
      { pageMatch: SECTION_C, principalForm: true, silent: true },
    );
  return [
    // Section B: legal declarations, explicit answers only.
    ...BACKGROUND.map((q) =>
      radio(
        P,
        `pr5669_${q.name}`,
        q.name,
        { Yes: `#${q.name}_yes`, No: `#${q.name}_no` },
        q.label,
        'travel_history',
        (p) => backgroundAnswer(p, q.name),
        { declaration: true, pageMatch: SECTION_B, principalForm: true },
      ),
    ),
    // Section C: education.
    years(
      'elementarySchoolYears',
      'elementary',
      'elementary_school_years',
      'primary_school_years',
    ),
    years(
      'secondarySchoolYears',
      'secondary',
      'secondary_school_years',
      'high_school_years',
    ),
    years(
      'universityAndCollegeYears',
      'university/college',
      'university_years',
      'post_secondary_years',
    ),
    years(
      'otherSchoolYears',
      'trade or other',
      'other_school_years',
      'trade_school_years',
    ),
    ...rowSection(
      'pr5669_edu',
      'Education',
      SECTION_C,
      'employment',
      schoolsOf,
      [
        { id: 'from', label: 'from', read: (r) => monthOf(r.from) },
        { id: 'to', label: 'to', read: (r) => monthOf(r.to, true) },
        {
          id: 'nameOfInstitution',
          label: 'institution',
          read: (r) => known(r.school ?? r.institution ?? r.name),
        },
        {
          id: 'cityAndCountry',
          label: 'city and country',
          read: (r) => cityAndCountry(r),
        },
        {
          id: 'typeOfDiploma',
          label: 'diploma',
          read: (r) => diplomaText(r.level ?? r.level_of_study),
          maxLength: 17,
        },
        {
          id: 'fieldOfStudy',
          label: 'field of study',
          read: (r) => known(r.field_of_study ?? r.field),
        },
      ],
    ),
    // Section D: personal history, most recent first.
    ...rowSection(
      'pr5669_hist',
      'Personal history',
      SECTION_D,
      'employment',
      historyOf,
      [
        { id: 'from', label: 'from', read: (r) => monthOf(r.from) },
        { id: 'to', label: 'to', read: (r) => monthOf(r.to, true) },
        { id: 'activity', label: 'activity', read: activityOf, maxLength: 21 },
        {
          id: 'cityAndCountry',
          label: 'city and country',
          read: (r) => cityAndCountry(r),
        },
        {
          id: 'status',
          label: 'status',
          read: (r, p) => shortStatus(r, p),
          maxLength: 14,
        },
        {
          id: 'nameOfEmployerOrSchool',
          label: 'employer or school',
          read: employerOf,
        },
      ],
    ),
    // Sections E, F and G reuse one checkbox id; each is scoped to its heading.
    check(
      P,
      'pr5669_no_memberships',
      '#noneSelected',
      'Memberships and associations — none',
      'travel_history',
      noneOf('organization_memberships', 'has_organization_memberships'),
      { pageMatch: SECTION_E, principalForm: true, declaration: true },
    ),
    check(
      P,
      'pr5669_no_government_positions',
      '#noneSelected',
      'Government positions — none',
      'employment',
      noneOf('government_positions'),
      { pageMatch: SECTION_F, principalForm: true, declaration: true },
    ),
    check(
      P,
      'pr5669_no_military_service',
      '#noneSelected',
      'Military and paramilitary service — none',
      'employment',
      noneOf('military_service', 'military_service_history'),
      { pageMatch: SECTION_G, principalForm: true, declaration: true },
    ),
    // Section H: addresses, most recent first. All text boxes. Row 0 is the
    // current address IRCC copies from the profile and DISABLES (to, street,
    // city, province, country, postal code; live 2026-10-21): only its "from"
    // is written.
    ...rowSection(
      'pr5669_addr',
      'Address',
      SECTION_H,
      'addresses',
      addressesOf,
      [
        { id: 'from', label: 'from', read: (r) => monthOf(r.from) },
        {
          id: 'to',
          label: 'to',
          read: (r) => monthOf(r.to, true),
          notOnFirstRow: true,
        },
        {
          id: 'street',
          notOnFirstRow: true,
          label: 'street and number',
          read: (r) => known(r.street ?? r.address),
        },
        {
          id: 'city',
          label: 'city or town',
          read: (r) => known(r.city),
          notOnFirstRow: true,
        },
        {
          id: 'provinceOrState',
          notOnFirstRow: true,
          label: 'province or state',
          read: (r) => known(r.province ?? r.state),
        },
        {
          id: 'country',
          notOnFirstRow: true,
          label: 'country',
          read: (r) => countryText(r.country),
        },
        {
          id: 'postalCode',
          notOnFirstRow: true,
          label: 'postal code',
          read: (r) => known(r.postal_code ?? r.postcode),
        },
      ],
    ),
  ];
}

/**
 * PRINCIPAL ONLY. Every person on the application has their own IMM 5406
 * and IMM 5669 at the SAME path with the SAME ids; only Section A's
 * disabled radio says whose form it is ("Yourself (the principal
 * applicant)" checked — #principalAppYes on IMM 5406, #principalApplicant on
 * IMM 5669, recorded live 2026-10-20). Every write is scoped to a page whose
 * checked radio says principal (`body:has(#… :checked) …`), so a
 * dependant's form resolves to nothing and is never written with the
 * applicant's data. Every write on those forms also carries `principalForm`
 * (`>> principal`): the extension remembers the form's `documentId` when its
 * Section A shows the principal radio checked, and lets the later sections
 * (which show no marker) through only for a remembered form.
 */
export const PRINCIPAL_5406 = 'body:has(#principalAppYes:checked)';
export const PRINCIPAL_5669 = 'body:has(#principalApplicant:checked)';
function principalOnly(
  guard: string,
  fields: FillFieldMapping[],
): FillFieldMapping[] {
  const scope = (css: string) => `${guard} ${css}`;
  return fields.map((f) => ({
    ...f,
    principalForm: true,
    selector: scope(f.selector),
    ...(f.choices
      ? {
          choices: Object.fromEntries(
            Object.entries(f.choices).map(([a, c]) => [a, scope(c)]),
          ),
        }
      : {}),
  }));
}

// ── the application page: PDF forms, supporting documents, fee receipt ────
//
// /en/application/case/<id> (live 2026-10-20). Every table is rendered two or
// three times for different screen widths and only one copy is shown; ids
// repeat across copies and rows (all five supporting documents use
// #supporting-documents-input). The extension finds a slot by the text of its
// one VISIBLE row (`::upload:<pattern>`), never by id. "Additional
// application forms" / "Additional supporting documents" (no label to match)
// and "Consent and declaration" are never touched; "Pay your fees" is never
// clicked — a fee RECEIPT the applicant already has is only attached.
//
// DISABLED until one upload is recorded live; see review B1 (PR #285). How
// the row shows an uploaded file was never seen, so a re-run could not tell
// an uploaded row from an empty one. The slots are kept (and the extension's
// case-page machinery), but no `uploadMappings(PR_CASE, PR_UPLOAD_SLOTS,
// 'pr_upload')` is registered in PR_FAMILY_MAPPING: the uploads, PDF forms
// and fee receipt are the applicant's (see prUploadNotes).

/** The signed forms: consultant-approved copies only, PDF only (the rows accept application/pdf). */
const PDF_FORM = { signatureRequired: true, mimeTypes: ['application/pdf'] };

export const PR_UPLOAD_SLOTS: readonly UploadSlot[] = [
  {
    key: 'imm1344',
    label:
      'IMM 1344 — Application to Sponsor, Sponsorship Agreement and Undertaking',
    rowPattern: '\\bIMM ?1344\\b',
    documentTypes: [
      'imm1344*',
      'imm_1344*',
      'application_to_sponsor*',
      'sponsorship_agreement*',
      'sponsorship_undertaking*',
    ],
    category: 'addresses',
    ...PDF_FORM,
  },
  {
    key: 'imm5532',
    label: 'IMM 5532 — Relationship Information and Sponsorship Evaluation',
    rowPattern: '\\bIMM ?5532\\b',
    documentTypes: [
      'imm5532*',
      'imm_5532*',
      'relationship_information*',
      'sponsorship_evaluation*',
    ],
    category: 'addresses',
    ...PDF_FORM,
  },
  {
    key: 'imm5533',
    label: 'IMM 5533 — Document Checklist: Spousal Sponsorship',
    rowPattern: '\\bIMM ?5533\\b',
    documentTypes: [
      'imm5533*',
      'imm_5533*',
      'document_checklist*',
      'spousal_checklist*',
    ],
    category: 'addresses',
    ...PDF_FORM,
  },
  {
    key: 'passport',
    label: 'Travel documents and passports',
    rowPattern: 'travel documents and passports',
    documentTypes: [
      'passport_copy',
      'passport',
      'passport_valid_entire_stay',
      'passport_biographic_page',
      'travel_document*',
    ],
    category: 'passport',
  },
  {
    key: 'police',
    label: 'Police certificates and clearances',
    rowPattern: 'police certificates',
    documentTypes: [
      'police_clearance*',
      'police_certificate*',
      'police_check*',
    ],
    category: 'passport',
  },
  {
    key: 'photo',
    label: 'Photo(s)',
    rowPattern: '\\bphoto\\(s\\)',
    documentTypes: [
      'applicant_photo*',
      'photo',
      'photos',
      'photo_*',
      'passport_photo*',
      'digital_photo*',
    ],
    category: 'passport',
  },
  {
    key: 'birth',
    label: 'Birth certificates',
    rowPattern: 'birth certificates?',
    documentTypes: ['birth_certificate*'],
    category: 'passport',
  },
  {
    key: 'status',
    label: 'Proof of status',
    rowPattern: 'proof of status',
    documentTypes: [
      'proof_of_status*',
      'sponsor_proof_of_status*',
      'sponsor_status*',
      'sponsor_citizenship*',
      'canadian_citizenship*',
      'citizenship_certificate*',
      'sponsor_pr_card*',
      'pr_card*',
      'permanent_resident_card*',
    ],
    category: 'passport',
  },
  {
    key: 'payment',
    label: 'Proof of payment (fee receipt)',
    rowPattern: 'proof of payment',
    documentTypes: [
      'processing_fee_receipt*',
      'fee_receipt*',
      'fee_payment_receipt*',
      'ircc_fee_receipt*',
      'payment_receipt*',
      'proof_of_payment*',
    ],
    category: 'employment',
  },
];

// ── profile: "Add dependant" ───────────────────────────────────────────────
//
// /en/application/profile/<id>, section "Spouse, partner or dependant(s)
// profiles" (live 2026-10-20). "Add dependant" (a type=button, no id) opens an
// INLINE form (no dialog): #dependantYes / #dependantNo ("Is the dependant
// accompanying you?"), #dependantForm-relationship, #dependantForm-familyName,
// #dependantForm-givenName and a date of birth #personalDetailsForm-dob — the
// SAME id as the principal's own (editable) date of birth higher on the page;
// a page-wide selector overwrote it during the recording. Every field of the
// form is therefore resolved inside that one open form (`>> dependant`).
// "Save details" closes the form and shows a card (Accompanying,
// Relationship, Name = given + family, Date of birth) under "Saved
// dependants". In a spousal sponsorship the principal is the sponsored
// person; the sponsor is not a dependant, and a spouse who applies alongside
// is not the usual case: only the principal's dependent children are added.

export const DEPENDANT_ADD = '::dependant-add';
export const DEPENDANT_SAVE = '::dependant-save';
export const MAX_DEPENDANTS = 6;

/** The dependant form's relationship option for a child (Child, Step-Child, Adopted Child). */
export function dependantRelationship(r: Profile): string | undefined {
  const rel = childRelationship(r);
  if (!rel) return undefined;
  if (/^adopted/i.test(rel)) return 'Adopted Child';
  if (/^step/i.test(rel)) return 'Step-Child';
  return 'Child';
}

/** Whole years between an ISO date and now. */
function ageOn(iso: string, now = Date.now()): number | undefined {
  const born = isoDayMs(iso);
  if (born === null) return undefined;
  const b = new Date(born);
  const n = new Date(now);
  let age = n.getUTCFullYear() - b.getUTCFullYear();
  if (
    n.getUTCMonth() < b.getUTCMonth() ||
    (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())
  )
    age -= 1;
  return age;
}

/** A marital status that says "not a spouse or partner" (word by word, negations included). */
const SINGLE_STATUS =
  /\b(single|unmarried|never[\s-]+married|not[\s-]+married|divorced|widow(ed|er)?|annulled)\b/;
const PARTNERED_STATUS = /\b(married|common[\s-]*law|partnered)\b/;

/**
 * Is this child a DEPENDENT child (IRCC: under 22 and not a spouse or
 * common-law partner)? An explicit answer wins. Otherwise by age first:
 * under 18 → yes, whatever else is recorded. 18 to 21 → yes when their
 * marital status says single ("single", "unmarried", "never married", "not
 * married", divorced, widowed), no when it says married or common-law,
 * undecided otherwise. 22 or older (who may still be dependent through a
 * condition), no date of birth, or anything unclear → not decided here.
 */
export function dependentChild(
  r: Profile,
  now = Date.now(),
): 'Yes' | 'No' | undefined {
  const said = declared(
    r,
    'dependent',
    'is_dependent',
    'dependant',
    'is_dependant',
    'dependent_child',
  );
  if (said) return said;
  const iso = pickDate(r, 'date_of_birth', 'dob', 'birth_date');
  const age = iso ? ageOn(iso, now) : undefined;
  if (age === undefined || age < 0) return undefined;
  if (age >= 22) return undefined;
  const marital = known(r.marital_status)?.toLowerCase();
  // IRCC: under 22 AND not a spouse or partner — a married minor is not added.
  const partnered =
    !!marital && !SINGLE_STATUS.test(marital) && PARTNERED_STATUS.test(marital);
  if (age < 18) return partnered ? undefined : 'Yes';
  if (!marital) return undefined;
  if (SINGLE_STATUS.test(marital)) return 'Yes';
  if (PARTNERED_STATUS.test(marital)) return 'No';
  return undefined;
}

/**
 * "Is the dependant accompanying you?" — only from an explicit answer: the
 * child's own, or a list answer that names them ("Yes") or says nobody
 * ("none", false: "No"). A list of OTHER names is not a "No" for this child
 * (a name spelled differently would turn into a wrong answer): undecided.
 */
export function accompanyingAnswer(
  r: Profile,
  p: Profile,
  name: string | undefined,
): 'Yes' | 'No' | undefined {
  const own = declared(
    r,
    'accompanying',
    'coming_to_canada',
    'travelling_with_applicant',
    'traveling_with_applicant',
  );
  if (own) return own;
  const v = p.children_accompanying;
  if (v === false) return 'No';
  if (
    typeof v === 'string' &&
    /^(none|no|nobody|no one|neither|n\/a)$/i.test(v.trim())
  )
    return 'No';
  if (Array.isArray(v) && v.length === 0) return 'No';
  if (!name) return undefined;
  const listed = listAnswer(
    p,
    'children_accompanying',
    name,
    childrenListed(p).length,
  );
  return listed === 'Yes' ? 'Yes' : undefined;
}

export interface DependantFacts {
  family: string;
  given: string;
  /** YYYY/MM/DD, as the form's mask and the card show it. */
  dob: string;
  relationship: string;
  accompanying: 'Yes' | 'No';
}

/** The children on the application, as listed (IMM 5406's list). */
const childrenListed = (p: Profile) =>
  people(p, 'children', 'children_details');

/**
 * One child as a dependant to add, or what is missing. Names come only from
 * a separate family name and given name: a single full-name string is not
 * split (which part is the family name is not guessed).
 */
export function dependantFacts(
  r: Profile,
  p: Profile,
): { facts?: DependantFacts; missing: string[] } {
  const family = known(pickText(r, 'family_name', 'last_name', 'surname'));
  const first = known(pickText(r, 'given_name', 'given_names', 'first_name'));
  // Given name(s) = first + middle names, when the middle is kept apart.
  const middle = known(pickText(r, 'middle_name', 'middle_names'));
  const given =
    first && middle && !first.toLowerCase().includes(middle.toLowerCase())
      ? `${first} ${middle}`
      : first;
  const dob = relativeDob(r);
  const relationship = dependantRelationship(r);
  const name =
    known(pickText(r, 'full_name', 'name')) ??
    ([given, family].filter(Boolean).join(' ') || undefined);
  const accompanying = accompanyingAnswer(r, p, name);
  const missing: string[] = [];
  if (!family || !given)
    missing.push('family name and given name(s) separately');
  if (!dob) missing.push('full date of birth');
  if (!relationship)
    missing.push('relationship (son, daughter, step- or adopted)');
  if (!accompanying) missing.push('whether they are accompanying you');
  if (missing.length) return { missing };
  return {
    facts: {
      family: family!,
      given: given!,
      dob: dob!,
      relationship: relationship!,
      accompanying: accompanying!,
    },
    missing,
  };
}

const isDeceased = (r: Profile) =>
  intakeAnswerIsYes(r.deceased ?? r.is_deceased) === true;

/** The dependants the assistant adds, in the listed order (at most MAX_DEPENDANTS). */
export function dependantsOf(p: Profile, now = Date.now()): DependantFacts[] {
  const out: DependantFacts[] = [];
  for (const r of childrenListed(p)) {
    if (isDeceased(r) || dependentChild(r, now) !== 'Yes') continue;
    const f = dependantFacts(r, p).facts;
    if (f) out.push(f);
  }
  return out.slice(0, MAX_DEPENDANTS);
}

/**
 * The dependant as its saved card shows it (Name = given + family, Date of
 * birth, Relationship, Accompanying) plus the family name on its own: the
 * extension matches cards field by field, and refuses to add a dependant
 * when a card has the same family name and date of birth but another name
 * (twins, or a name entered differently).
 */
export const dependantSummary = (d: DependantFacts) =>
  `Name: ${d.given} ${d.family}; Family name: ${d.family}; Date of birth: ${d.dob}; Relationship: ${d.relationship}; Accompanying: ${d.accompanying}`;

function dependantFields(): FillFieldMapping[] {
  const P = PR_PROFILE;
  const out: FillFieldMapping[] = [];
  for (let i = 0; i < MAX_DEPENDANTS; i++) {
    const dep = (p: Profile) => dependantsOf(p)[i];
    const key = `pr_dependant${i}`;
    const n = i + 1;
    // One dependant stands or falls together (review "not applicable").
    const group: Extra = { group: key, silent: true };
    const field: Extra = {
      ...group,
      reveal: true,
      parent: key,
      dependantForm: true,
    };
    out.push(
      {
        page: P,
        profileKey: key,
        selector: DEPENDANT_ADD,
        action: 'fill',
        op: 'dependant_open',
        label: `Dependant ${n} — "Add dependant"`,
        category: 'passport',
        derive: (p) => {
          const d = dep(p);
          return d ? dependantSummary(d) : undefined;
        },
        // Not probed: the add button is clicked only after the principal's
        // own fields are written, and waited for then.
        reveal: true,
        ...group,
      },
      radio(
        P,
        `${key}_accompanying`,
        'dependants',
        { Yes: '#dependantYes', No: '#dependantNo' },
        `Dependant ${n} — accompanying you`,
        'passport',
        (p) => dep(p)?.accompanying,
        field,
      ),
      option(
        P,
        `${key}_relationship`,
        '#dependantForm-relationship',
        `Dependant ${n} — relationship`,
        'passport',
        (p) => dep(p)?.relationship,
        field,
      ),
      text(
        P,
        `${key}_family_name`,
        '#dependantForm-familyName',
        `Dependant ${n} — family name(s)`,
        'passport',
        (p) => dep(p)?.family,
        field,
      ),
      text(
        P,
        `${key}_given_name`,
        '#dependantForm-givenName',
        `Dependant ${n} — given name(s)`,
        'passport',
        (p) => dep(p)?.given,
        field,
      ),
      // The SAME id as the principal's date of birth: `>> dependant` keeps
      // this write inside the open dependant form.
      text(
        P,
        `${key}_date_of_birth`,
        '#personalDetailsForm-dob',
        `Dependant ${n} — date of birth`,
        'passport',
        (p) => dep(p)?.dob,
        field,
      ),
      {
        page: P,
        profileKey: `${key}_save`,
        selector: DEPENDANT_SAVE,
        action: 'fill',
        op: 'dependant_save',
        label: `Dependant ${n} — "Save details"`,
        category: 'passport',
        derive: (p) => {
          const d = dep(p);
          return d ? dependantSummary(d) : undefined;
        },
        ...group,
        reveal: true,
        parent: key,
      },
    );
  }
  return out;
}

/** Why a listed child is not added by the assistant (coverage notes). */
function dependantNotes(p: Profile, now = Date.now()): string[] {
  const notes: string[] = [];
  const rows = childrenListed(p);
  let added = 0;
  rows.forEach((r, i) => {
    const n = `Child ${i + 1} in your VisaAI data`;
    if (isDeceased(r)) {
      notes.push(
        `${n}: recorded as deceased, so the assistant does not add them as a dependant.`,
      );
      return;
    }
    const dependent = dependentChild(r, now);
    if (dependent === 'No') {
      notes.push(
        `${n}: not added — your VisaAI data says they are not a dependent child (married or common-law, or as you answered). If they are your dependant, add them with "Add dependant" yourself.`,
      );
      return;
    }
    if (dependent === undefined) {
      notes.push(
        `${n}: VisaAI cannot tell whether they are your dependent child (under 22 and not married or in a common-law relationship). If they are, add them with "Add dependant" yourself.`,
      );
      return;
    }
    const { facts, missing } = dependantFacts(r, p);
    if (!facts) {
      notes.push(
        `${n}: missing ${missing.join(', ')}. Add them with "Add dependant" yourself, or complete their details in VisaAI.`,
      );
      return;
    }
    added += 1;
    if (added > MAX_DEPENDANTS)
      notes.push(
        `${n}: the assistant adds at most ${MAX_DEPENDANTS} dependants. Add this one with "Add dependant" yourself.`,
      );
  });
  return notes;
}

export const PR_FAMILY_MAPPING: FillFieldMapping[] = [
  ...profileFields(),
  // Last on the profile: the principal's own fields are written before the
  // dependant form (which reuses the date-of-birth id) is opened.
  ...dependantFields(),
  ...imm0008Page2(),
  ...imm0008Page3(),
  ...imm0008Page4(),
  ...idPage(
    PR_IMM0008(5),
    'pr_passport',
    'passport-check',
    'validPassportYes',
    'validPassportNo',
    'passportNumber',
    'Passport',
    passport,
    validPassport,
  ),
  ...idPage(
    PR_IMM0008(6),
    'pr_national_id',
    'national-identity-check',
    'NICYes',
    'NICNo',
    'nationalIdentityNumber',
    'National identity document',
    nationalId,
    hasNationalId,
  ),
  ...imm0008Pages7And8(),
  ...principalOnly(PRINCIPAL_5406, imm5406()),
  ...imm5406Rows(),
  ...principalOnly(PRINCIPAL_5669, imm5669()),
  ...imm5669Later(),
  ...imm5562(),
  // No PR_CASE uploads: disabled until one upload is recorded live (review B1).
];

/**
 * The application page's rows, all the applicant's for now (review B1): for
 * each, the documents of that kind they have in VisaAI, so they know which
 * file goes where.
 */
function prUploadNotes(p: Profile): ManualFieldNote[] {
  return PR_UPLOAD_SLOTS.map((slot) => {
    const names = documentsOfSlot(p, slot).map((d) => d.fileName);
    const have = names.length
      ? ` In VisaAI you have: ${names.join(', ')}.`
      : '';
    const sign = slot.signatureRequired
      ? ' Download the form from this row, complete and sign it first, and upload the signed PDF.'
      : '';
    return {
      page: PR_CASE,
      label: `Upload: ${slot.label}`,
      reason: 'fill_yourself' as const,
      note: `Upload it on IRCC yourself.${sign}${have}`,
    };
  });
}

/** What the applicant fills or does on the portal themselves. */
function leftForApplicant(
  p: Profile,
  exclude: ReadonlySet<string> = new Set(),
): ManualFieldNote[] {
  const yours = (
    page: string,
    label: string,
    note?: string,
  ): ManualFieldNote => ({
    page,
    label,
    reason: 'fill_yourself',
    ...(note ? { note } : {}),
  });
  const notes: ManualFieldNote[] = [
    yours(
      PR_PROFILE,
      'Spouse, partner or dependant profiles',
      'The assistant adds your dependent children from your VisaAI data with "Add dependant", one at a time, and skips one whose card is already saved. A spouse or partner who is applying with you is yours to add. Check each card, then click "Save and continue" yourself.',
    ),
    ...dependantNotes(p).map((note) =>
      yours(PR_PROFILE, 'Dependant not added', note),
    ),
    yours(PR_IMM0008(4), 'Fax number'),
    yours(
      PR_IMM5669,
      'Open Section A first',
      'The assistant fills IMM 5669 sections B to H only on your own form, which it recognises from Section A. Open Section A of your IMM 5669 first (with this panel open), then the later sections.',
    ),
    yours(
      PR_IMM5406,
      'Forms of your spouse or dependants',
      'The assistant fills only your own IMM 5406 and IMM 5669. Complete the forms of anyone else on the application yourself.',
    ),
    yours(
      PR_CASE,
      'PDF forms, documents, fee, declaration and submission',
      'Your application page is yours: the assistant does not upload files there yet. Upload IMM 1344, 5532 and 5533 (signed), your supporting documents and your fee receipt, pay the fee ("Pay your fees"), complete the consent and declaration (your e-signature) and submit on IRCC yourself. The assistant never signs, pays or submits.',
    ),
    yours(
      PR_CASE,
      'Additional supporting documents',
      'Your marriage certificate and other proof of your relationship go under "Additional supporting documents": upload them there yourself.',
    ),
    ...prUploadNotes(p),
  ];
  // IMM 5406 sections B and C: rows from complete data only; a section the
  // applicant said does not apply is theirs to mark "Not Applicable".
  const relativesNote = (
    label: string,
    rows: Profile[],
    none: boolean,
    what: string,
  ) => {
    if (rows.length > 0) return;
    notes.push(
      yours(
        PR_IMM5406,
        label,
        none
          ? 'You told VisaAI there is no one to list: write "Not Applicable" in this section yourself.'
          : `List every ${what} yourself: the assistant enters them only when each has the relationship, full name, date of birth, country of birth, marital status (not "Married") and a city and country of residence (at most 80 characters).`,
      ),
    );
  };
  relativesNote(
    'Section B: children',
    childrenOf5406(p),
    declared(p, 'has_children', 'have_children') === 'No',
    'child',
  );
  relativesNote(
    'Section C: brothers and sisters',
    siblingsOf(p),
    !Array.isArray(pick(p, 'siblings', 'brothers_and_sisters')) &&
      intakeAnswerIsYes(pick(p, 'siblings', 'brothers_and_sisters')) === false,
    'brother and sister',
  );
  // IMM 5562.
  if (travelConflict(p))
    notes.push(
      yours(
        PR_IMM5562,
        'Section A: your trips in the past 10 years',
        'You told VisaAI you have not travelled in the past 10 years, but also listed trips. Check which is right and fill Section A yourself.',
      ),
    );
  else if (!noTravel(p) && tripsOf(p).length === 0)
    notes.push(
      yours(
        PR_IMM5562,
        'Section A: your trips in the past 10 years',
        'Enter your trips yourself (or tick "Did not travel"): the assistant enters them only when every trip has its months, destination, length of stay and purpose.',
      ),
    );
  if (spouseTripsOf(p).length === 0)
    notes.push(
      yours(
        PR_IMM5562,
        'Section B: your spouse’s or partner’s trips',
        'If your spouse or partner is on this application, enter their trips (or "Did not travel") yourself.',
      ),
    );
  if (adultChildTripsOf(p).length === 0)
    notes.push(
      yours(
        PR_IMM5562,
        'Section C: trips of children 18 or older',
        'If a child 18 or older is on this application, enter their trips (or "Did not travel") yourself.',
      ),
    );
  const sectionNote = (label: string, rows: Profile[], note: string) => {
    if (rows.length === 0) notes.push(yours(PR_IMM5669, label, note));
  };
  sectionNote(
    'Section C: education',
    schoolsOf(p),
    'Enter your schools yourself: the assistant enters them only when every school has its dates, name, city and country, diploma and field (diploma box: 17 characters).',
  );
  sectionNote(
    'Section D: personal history',
    historyOf(p),
    'Enter your last 10 years yourself, most recent first, with no gaps: the assistant enters them only when every period has its dates, activity, city and country (activity box: 21 characters, status: 14).',
  );
  if (addressesOf(p).length > 0)
    notes.push(
      yours(
        PR_IMM5669,
        'Section H: your current address',
        'IRCC copies your current address (row 1) from your IRCC portal profile (My Profile) and locks it. The assistant enters only when you moved in; to correct the address itself, change it on My Profile.',
      ),
    );
  sectionNote(
    'Section H: addresses',
    addressesOf(p),
    'Enter your addresses for the last 10 years yourself, most recent first: the assistant enters them only when every address has its dates, street, city and country.',
  );
  if (BACKGROUND.some((q) => backgroundAnswer(p, q.name) === 'Yes'))
    notes.push(
      yours(
        PR_IMM5669,
        'Section B: details of a "Yes"',
        'Explain each "Yes" background answer in the details box yourself.',
      ),
    );
  // An unanswered "None" box is a declaration: coverage already lists it as
  // needs-your-answer. When the assistant ticks it, the page's own rows are
  // not checked first (review M2), so say so.
  for (const [keys, label] of [
    [
      ['organization_memberships', 'has_organization_memberships'],
      'Section E: memberships and associations',
    ],
    [['government_positions'], 'Section F: government positions'],
    [
      ['military_service', 'military_service_history'],
      'Section G: military and paramilitary service',
    ],
  ] as const)
    if (noneOf(...keys)(p))
      notes.push(
        yours(
          PR_IMM5669,
          `${label}: "None"`,
          'The assistant ticks "None" from your answer. If you had already entered rows in this section, untick it and keep your rows.',
        ),
      );
  if (
    contactAddress(p)?.same !== 'Yes' &&
    (!residentialOther(p) ||
      [...exclude].some(
        (k) => k === 'pr_residential_same' || k.startsWith('pr_home_'),
      ))
  )
    notes.push(
      yours(
        PR_PROFILE,
        'Residential address',
        'If your home address is not your mailing address, answer "No" and enter it yourself.',
      ),
    );
  else if (residentialOther(p) && !residentialOther(p)?.postalCode)
    notes.push(
      yours(
        PR_PROFILE,
        'Residential address — postal code',
        'Your home address has no postal code in your VisaAI data: add it if it has one.',
      ),
    );
  if (Array.isArray(previousCountries(p)) && !prevCountry(p))
    notes.push(
      yours(
        PR_IMM0008(3),
        'Previous countries of residence',
        'Enter your previous countries of residence yourself (the assistant enters one complete row only).',
      ),
    );
  if (
    declared(p, 'has_other_names', 'used_other_names') === 'Yes' &&
    !otherName(p)
  )
    notes.push(yours(PR_IMM0008(3), 'Other names you have used'));
  if (
    declared(p, 'applicant_previous_relationship', 'previously_married') ===
      'Yes' &&
    !pastPartner(p)
  )
    notes.push(
      yours(PR_IMM0008(3), 'Your previous marriage or common-law relationship'),
    );
  return notes;
}

registerPortalFill('ircc-pr-family', PR_FAMILY_MAPPING, {
  pages: PR_FAMILY_PAGES,
  left: leftForApplicant,
});
