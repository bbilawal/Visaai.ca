import {
  registerPortalFill,
  type FillFieldMapping,
  type FillTransform,
  type ManualFieldNote,
  type PortalPageInfo,
} from '../../../strategies/portal-integration/portal-fill.registry';
import {
  ETA_LISTED_CONDITIONS,
  IRCC_ETA_FACTS,
  intakeAnswerIsYes,
  isEtaConditional,
  isEtaVisaExempt,
  looksLikeIrccNumber,
  profileNationality,
} from '@visaai/types';
import {
  declared,
  pick,
  pickDate,
  pickText,
  residentialAddress,
  splitPlace,
  pickCountry,
  type Profile,
} from './ircc-profile';
import {
  refusalDetails,
  refusedByCanada,
  refusedOrOrderedToLeave,
} from './canada-ircc';
import { toIso3 } from './country-names';
import { etaNationalityOption } from './eta-options';
import { etaTimeZoneOption } from './eta-timezones';
import {
  ETA_MARITAL_OPTIONS,
  ETA_OCCUPATION,
  ETA_OCCUPATION_OPTIONS,
  ETA_TITLED,
  ETA_TITLES,
  ETA_WITH_DETAILS,
  ETA_WORKING,
  etaMaritalOption,
  etaStatusesIn,
  etaWorkFor,
  exactOption,
} from './eta-occupations';

/**
 * Canada eTA (electronic travel authorization) portal fill mapping, read off
 * the live form on 2026-10-16:
 * https://eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/welcome?lang=en#/application
 *
 * Portal facts the mapping relies on:
 *  - ONE page. The path stays /eta/welcome (hash #/application) from the first
 *    question to the declaration, so the page is `progressive`: the assistant
 *    fills what is on the page, looks again for what those answers revealed,
 *    and leaves the sections behind the form's own Next button for a later
 *    launch. It never presses Next.
 *  - Every question is a <select> whose option VALUES are list indexes ("0",
 *    "1", …), so every answer is chosen by its option TEXT (`select_text`).
 *  - Ids carry dots (`applicationDetails.personalDetails_passportNumber`), so
 *    every selector names the id by attribute — `#a.b` would mean id "a" with
 *    class "b".
 *  - Each country question has its own list (see eta-options.ts). Dates are
 *    three selects: year "1960", month "May", day zero-padded "01".
 *
 * KEYS. The eTA interview writes the profile under the keys of IRCC_ETA_FACTS
 * (@visaai/types intake-requirements). Every reader below starts from those
 * keys and their aliases (`factKeys`), so the mapping cannot drift from the
 * interview again: dry run 2026-10-17 (app 2f1c9cc9) showed only the TB answer
 * mapped, because the refusal, criminality and conditions answers were stored
 * under keys this mapping never read. test/ircc-eta-intake-contract.spec.ts
 * holds every form fact of the interview to a mapped field.
 *
 * MARITAL STATUS AND OCCUPATION (recorded live 2026-10-18, both required;
 * eta-occupations.ts has the option texts). The occupation group is chosen
 * from the interview's employment answers only when they name one
 * unambiguously — Retired / Homemaker / Unemployed / Student from the status,
 * a working group from the job title by the tr-rt rules — otherwise it is
 * left for the applicant. The job title is chosen only from the recorded list
 * of that group. Its list loads 1–5 s after the group changes: the title is
 * the last write of the employment block and the extension waits for the
 * option to be listed before choosing it (content.ts, select_text).
 *
 * SAFETY. The background questions (refusals, criminality, tuberculosis,
 * listed health conditions) are legal declarations: answered only from the
 * applicant's explicit answers, never defaulted, flagged `declaration` so the
 * readback gate shows them apart. A broader IRCC answer is used only where it
 * covers the eTA question exactly (a "no" to all three of refused / denied
 * entry / ordered to leave, any country, is "No"; a "no" to one part alone
 * answers nothing; a "yes" to any part is "Yes"). The consent checkbox
 * (`consentAndDeclaration_inAggreance`) and the signature
 * (`consentAndDeclaration_fullName`) are NOT mapped and never will be: the
 * applicant ticks and signs. Payment and submission have no code path.
 *
 * "YES" BRANCHES (recorded live 2026-10-18, Mexican persona for CAN+):
 *  - CAN+ nationals (visa-required, eTA instead of a visitor visa) are asked,
 *    after the passport's country, whether they are a U.S. lawful permanent
 *    resident (Yes: IRCC says no eTA is needed and shows nothing else), then
 *    the nationality noted, travelling by air (No: cannot apply), a Canadian
 *    visitor visa in the past 10 years, and a valid U.S. non-immigrant visa
 *    (both No: cannot apply). A U.S. visa "Yes" asks its number (twice) and
 *    expiry date. Ids carry `prerequisite.etaExpansion_` — dot included.
 *  - A refusal or criminality "Yes" opens a details box, written only from the
 *    applicant's own details (a list of records is composed into sentences,
 *    nothing added); a "Yes" without them is listed as needing their answer.
 *  - A tuberculosis "Yes" asks whether the contact came from health-care work;
 *    a "Yes" there asks whether they were ever diagnosed.
 *
 * RECORDED LIVE 2026-10-19 (British persona):
 *  - the arrival hour and minute options are zero-padded 24-hour text
 *    ("00".."23", "00".."59"), as written; the time zone is required, one of
 *    160 options (eta-timezones.ts), chosen from the Canadian arrival city
 *    or a zone the applicant named — the time is local where the flight
 *    lands;
 *  - personalDetails_additionalCitizenship is an optional single select of
 *    the nationality list minus the passport's own nationality: the first
 *    other citizenship is chosen, and a second one is noted;
 *  - personalDetails_uci is optional: "I don't know" leaves it blank.
 *
 * NOT MAPPED — left for the applicant:
 *  - the representative's page after "Yes" to welcome_isRepresentative (the
 *    representative signs its declarations);
 *  - the job title of Military/armed forces (68 Canadian Armed Forces trades:
 *    the applicant chooses theirs);
 *  - province / postal code fields for some address countries, and
 *    contactDetails_district / _streetAddressAlt (meaning not confirmed);
 *  - backgroundQuestions_haveOrWillHaveHealthInsuranceValidInCanadaDuringStayDetails;
 *  - any travel-document type other than an ordinary passport, and the
 *    option text of every country other than Pakistan and the UK.
 */

/** The path the extension reports for every step of the form. */
export const ETA_PAGE = '/eta/welcome';

export const ETA_PAGES: PortalPageInfo[] = [
  { page: ETA_PAGE, title: 'eTA application', progressive: true },
];

// ── building blocks ─────────────────────────────────────────────────────────
type Category = FillFieldMapping['category'];
type Extra = Partial<
  Pick<
    FillFieldMapping,
    | 'parent'
    | 'parentValue'
    | 'declaration'
    | 'transform'
    | 'silent'
    | 'awaitOptions'
  >
>;

/** `[id="applicationDetails.<suffix>"]` — the id contains a dot. */
const app = (suffix: string) => `[id="applicationDetails.${suffix}"]`;

/** A <select> answered by option text. Its derivation reads `profileKey` first. */
function choose(
  profileKey: string,
  selector: string,
  label: string,
  category: Category,
  derive: ((p: Profile) => unknown) | undefined,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page: ETA_PAGE,
    profileKey,
    selector,
    action: 'select',
    op: 'select_text',
    label,
    category,
    ...(derive ? { derive } : {}),
    ...extra,
  };
}

function text(
  profileKey: string,
  selector: string,
  label: string,
  category: Category,
  derive?: (p: Profile) => unknown,
  extra: Extra = {},
): FillFieldMapping {
  return {
    page: ETA_PAGE,
    profileKey,
    selector,
    action: 'fill',
    label,
    category,
    ...(derive ? { derive } : {}),
    ...extra,
  };
}

/** An ISO date → the form's year / month-name / zero-padded day selects. */
function dateSelects(
  profileKey: string,
  idPrefix: string,
  label: string,
  category: Category,
  extra: Extra = {},
): FillFieldMapping[] {
  const parts: Array<[string, FillTransform, string]> = [
    ['Year', 'date_year', 'year'],
    ['Month', 'date_month_name', 'month'],
    ['Day', 'date_day_padded', 'day'],
  ];
  return parts.map(([suffix, transform, part]) =>
    choose(
      profileKey,
      app(`${idPrefix}${suffix}`),
      `${label} — ${part}`,
      category,
      // The interview's own key or one of its aliases (dob, birth_date, …).
      fact(profileKey),
      { transform, ...extra },
    ),
  );
}

/** A background question: explicit answer only, flagged a declaration. */
function declaration(
  profileKey: string,
  suffix: string,
  label: string,
  derive: (p: Profile) => string | undefined,
  extra: Extra = {},
): FillFieldMapping {
  return choose(
    profileKey,
    app(`backgroundQuestions_${suffix}`),
    label,
    'travel_history',
    derive,
    { declaration: true, ...extra },
  );
}

// ── interview keys ──────────────────────────────────────────────────────────
const ETA_FACTS = new Map(IRCC_ETA_FACTS.map((f) => [f.key, f]));

/**
 * The interview's canonical key for an eTA fact, then its aliases. Throws at
 * load for a key the interview does not define, so a rename there fails every
 * test here instead of silently mapping nothing.
 */
export function factKeys(key: string): string[] {
  const f = ETA_FACTS.get(key);
  if (!f) throw new Error(`eTA mapping reads unknown intake fact "${key}"`);
  return [f.key, ...(f.aliases ?? [])];
}

/** True when any key holds an explicit "yes". */
function anyYes(p: Profile, keys: readonly string[]): boolean {
  return keys.some((k) => intakeAnswerIsYes(p[k]) === true);
}

/** The interview's own value for a fact (canonical key or alias), raw. */
const fact = (key: string) => (p: Profile) => pick(p, ...factKeys(key));

// ── facts ───────────────────────────────────────────────────────────────────
const NATIONALITY_KEYS = factKeys('nationality');
const PASSPORT_COUNTRY_KEYS = factKeys('passport_country');

const nationality = (p: Profile) =>
  pickCountry(p, ...NATIONALITY_KEYS, ...PASSPORT_COUNTRY_KEYS);

/** The passport's issuing country, else the nationality. */
const passportCountry = (p: Profile) =>
  pickCountry(p, ...PASSPORT_COUNTRY_KEYS, ...NATIONALITY_KEYS);

function isRepresentative(p: Profile): 'Yes' | 'No' | undefined {
  const keys = [
    ...factKeys('applying_on_behalf'),
    'is_representative',
    'applying_on_behalf_of_someone',
    'eta_is_representative',
  ];
  const yn = declared(p, ...keys);
  if (yn) return yn;
  const said = pickText(p, ...keys)
    ?.toLowerCase()
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!said) return undefined;
  // "Myself", "just me", "for me only", "I'm applying for myself".
  if (
    /^(i'?m |i am )?(applying |filling (it |this )?in )?(just |only )?(for )?(me|myself|self)( only| alone)?$/.test(
      said,
    )
  )
    return 'No';
  // "On behalf of my son", "for my daughter", "for someone else" — and
  // never when the answer also names the applicant ("for me and my son").
  if (
    !/\b(me|myself)\b/.test(said) &&
    /^(i'?m |i am )?(applying |filling (it |this )?in )?(on behalf of|for (my|our|a|an|someone|somebody|another|other)\b)/.test(
      said,
    )
  )
    return 'Yes';
  return undefined;
}

/** Only an ordinary passport's option text was recorded. */
function travelDocumentType(p: Profile): string | undefined {
  const t = pickText(p, ...factKeys('travel_document_type'))
    ?.toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return undefined;
  if (
    /^(p|pp|p<|passport|ordinary|regular|ordinary passport|regular passport|passport - ordinary\/regular)$/.test(
      t,
    )
  )
    return 'Passport - ordinary/regular';
  return undefined;
}

function gender(p: Profile): string | undefined {
  const g = pickText(p, ...factKeys('sex'))?.toLowerCase();
  if (!g) return undefined;
  if (/^(f|female|woman)$/.test(g)) return 'Female';
  if (/^(m|male|man)$/.test(g)) return 'Male';
  if (/^(x|another|another gender)$/.test(g)) return 'Another gender';
  return undefined;
}

/** Country of birth as written (the place list needs "England", not GBR). */
const birthCountryText = (p: Profile) =>
  pickText(p, ...factKeys('country_of_birth')) ?? pickText(p, 'place_of_birth');

/**
 * City of birth. `place_of_birth` is an alias of the interview's fact but may
 * be "Leeds, England", so it is split rather than written whole; a value that
 * names a country is never a city.
 */
function birthCity(p: Profile): string | undefined {
  const keys = factKeys('city_of_birth').filter((k) => k !== 'place_of_birth');
  const city =
    pickText(p, ...keys, 'place_of_birth_city') ??
    splitPlace(p.place_of_birth).city;
  return city && !toIso3(city) ? city : undefined;
}

function preferredLanguage(p: Profile): string | undefined {
  const said = pickText(
    p,
    ...factKeys('preferred_contact_language'),
    'language_of_correspondence',
  )?.toLowerCase();
  if (!said) return undefined;
  if (/english/.test(said) && !/french|fran/.test(said)) return 'English';
  if (/french|fran/.test(said) && !/english/.test(said)) return 'French';
  return undefined;
}

const applicantEmail = (p: Profile) => pickText(p, ...factKeys('email'));

/**
 * A UCI or visa number has digits; "I don't know" is not one. The
 * previous-application answer may itself be the number (`previous_canadian_visa`).
 */
function uci(p: Profile): string | undefined {
  const v = pickText(p, ...factKeys('uci'), 'ircc_uci');
  if (v && /\d{4}/.test(v)) return v;
  return previousApplicationNumber(p);
}

/** An IRCC number stored as the answer to "applied to Canada before?". */
function previousApplicationNumber(p: Profile): string | undefined {
  for (const k of factKeys('previous_canada_application')) {
    const v = p[k];
    if (looksLikeIrccNumber(v)) return String(v).trim();
  }
  return undefined;
}

/** Yes / no; an IRCC number held under the question's keys is a "Yes". */
const previouslyApplied = (p: Profile) =>
  declared(
    p,
    ...factKeys('previous_canada_application'),
    'applied_to_canada_before',
  ) ?? (previousApplicationNumber(p) ? 'Yes' : undefined);

const STREET_NUMBER = /^(\d+[A-Za-z]?)\s+(.+)$/;
/**
 * Number after the street, as Mexico, most of Latin America and much of
 * Europe write it: "Av. Prueba 123", "Hauptstraße 5", "Calle Sol No. 12".
 * Live 2026-10-19: "Av. Prueba 123" left IRCC's street-number box blank.
 */
const TRAILING_NUMBER = /^(.*?\p{L}.*?)\s+(?:No\.?\s*|N[º°]\s*|#\s*)?(\d+[A-Za-z]?)$/u;

function streetParts(p: Profile): { number?: string; name?: string } {
  const a = residentialAddress(p);
  if (!a) return {};
  if (a.streetNumber || a.streetName)
    return { number: a.streetNumber, name: a.streetName };
  if (!a.street) return {};
  const m = STREET_NUMBER.exec(a.street);
  if (m) return { number: m[1], name: m[2] };
  const t = TRAILING_NUMBER.exec(a.street.trim());
  return t
    ? { number: t[2], name: t[1].replace(/[,\s]+$/, '') }
    : { name: a.street };
}

/**
 * Address country as written ("England"), else the parsed address's country.
 * The eTA place list names the UK by nation and has no "United Kingdom", so
 * "…, England, United Kingdom" answers "England" and a line ending only in
 * "United Kingdom" resolves to no option (the applicant chooses).
 */
function addressCountryText(p: Profile): string | undefined {
  const flat = pickText(
    p,
    'residential_address_country',
    'residential_country',
    'address_country',
    'country_of_residence',
    'current_country_of_residence',
  );
  if (flat) return flat;
  for (const k of factKeys('residential_address')) {
    const v = p[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const c = pickText(v as Profile, 'country');
      if (c) return c;
    }
    if (typeof v === 'string' && v.includes(',')) {
      const parts = v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      // "…, England, United Kingdom": the nation, not the state.
      let i = parts.length - 1;
      const iso = toIso3(parts[i]);
      if (iso && i > 0 && toIso3(parts[i - 1]) === iso) i -= 1;
      if (parts[i]) return parts[i];
    }
  }
  const a = residentialAddress(p);
  return a?.countryText ?? a?.country;
}

/**
 * The arrival time as IRCC's hour and minute selects: the interview's
 * `planned_entry_time` ("14:30", "2:30 pm", "14h30"), else a time stored on
 * the entry date itself ("2026-12-01T14:30"). Anything else answers nothing.
 */
export function arrivalTime(
  p: Profile,
): { hour: string; minute: string } | undefined {
  const said = pickText(p, ...factKeys('planned_entry_time'));
  const onDate = pickText(p, ...factKeys('planned_entry_date'));
  const raw =
    said ?? (onDate && /T\d{1,2}:\d{2}/.test(onDate) ? onDate.split('T')[1] : undefined);
  if (!raw) return undefined;
  const m = /^(\d{1,2})\s*[:h.]\s*(\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*[a-z]{2,5})?$/i.exec(
    raw.trim(),
  );
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3]?.toLowerCase().replace(/\./g, '');
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { hour: pad(hour), minute: pad(minute) };
}

/** The arrival time zone as IRCC's option text (eta-timezones.ts). */
const arrivalTimeZone = (p: Profile) =>
  etaTimeZoneOption(pickText(p, ...factKeys('planned_entry_timezone')));

/**
 * The other citizenships the interview recorded (names or {country}), as
 * alpha-3, without the passport's own nationality — the form's list leaves
 * that one out (live 2026-10-19).
 */
function additionalCitizenships(p: Profile): string[] {
  const raw = pick(p, ...factKeys('other_citizenships'));
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const own = nationality(p);
  const out: string[] = [];
  for (const v of list) {
    const iso = toIso3(v && typeof v === 'object' ? (v as Profile).country : v);
    if (iso && iso !== own && !out.includes(iso)) out.push(iso);
  }
  return out;
}

function travelDateKnown(p: Profile): 'Yes' | 'No' | undefined {
  return (
    declared(p, ...factKeys('travel_date_known')) ??
    (pickDate(p, ...factKeys('planned_entry_date')) ? 'Yes' : undefined)
  );
}

/**
 * "Have you ever been refused a visa or permit, denied entry to, or ordered
 * to leave Canada or any other country/territory?" — the interview asks this
 * exact question (`refused_visa_or_denied_entry`), so its answer maps both
 * ways. Otherwise IRCC tr-rt's three parts (refused, denied, ordered to
 * leave, any country) answer it together: "No" only when all three are no.
 * A "yes" to any narrower question (a visa refusal, a Canadian refusal) is a
 * "Yes" here; a "no" to one of them alone answers nothing.
 */
function refusedOrDenied(p: Profile): 'Yes' | 'No' | undefined {
  const own = declared(p, 'refused_visa_or_denied_entry');
  if (own) return own;
  // A refusal by Canada wins over "No" to the general parts.
  if (refusedByCanada(p)) return 'Yes';
  const parts = refusedOrOrderedToLeave(p);
  if (parts) return parts;
  return anyYes(p, [
    ...factKeys('refused_visa_or_denied_entry'),
    'refused_by_canada',
    'refused_visa_or_permit_or_denied_entry_to_canada',
    'canada_refusal',
    'refused_canada',
  ])
    ? 'Yes'
    : undefined;
}

const NO_CHARGES = (p: Profile) =>
  declared(p, 'criminal_charges_or_convictions') === 'No' ? 'No' : undefined;

/**
 * One question for four facts: committed, arrested, charged or convicted, in
 * any country. The interview's `criminal_offence` asks exactly this; its
 * aliases name only part of it, so they answer "Yes" but never "No" alone.
 */
function criminalOffence(p: Profile): 'Yes' | 'No' | undefined {
  const own = declared(
    p,
    'criminal_offence',
    'criminal_offence_anywhere',
    'committed_or_arrested_or_charged_or_convicted',
  );
  if (own) return own;
  if (anyYes(p, factKeys('criminal_offence'))) return 'Yes';
  const answers = [
    declared(
      p,
      'committed_crime',
      'committed_criminal_offence',
      'committed_criminal_offense',
      'crime_committed',
    ),
    declared(p, 'ever_arrested', 'arrested', 'been_arrested'),
    declared(p, 'ever_charged', 'been_charged', 'criminal_charges') ??
      NO_CHARGES(p),
    declared(
      p,
      'ever_convicted',
      'been_convicted',
      'criminal_conviction',
      'criminal_convictions',
      'criminal_record',
    ) ?? NO_CHARGES(p),
  ];
  if (answers.includes('Yes')) return 'Yes';
  if (answers.every((a) => a === 'No')) return 'No';
  return undefined;
}

/**
 * "In the past two years, were you diagnosed with tuberculosis or in close
 * contact with a person with tuberculosis?" IRCC tr-rt asks diagnosis over two
 * years (same window) and contact over FIVE: "No" to both covers this; a
 * contact "Yes" over five years does not say when, so it answers nothing.
 */
function tuberculosis(p: Profile): 'Yes' | 'No' | undefined {
  // The interview's question and its aliases are this exact question.
  const own = declared(p, ...factKeys('tuberculosis_last_2_years'));
  if (own) return own;
  const diagnosed = declared(
    p,
    'tuberculosis',
    'tuberculosis_diagnosed',
    'tb_diagnosed',
    'has_tuberculosis',
  );
  if (diagnosed === 'Yes') return 'Yes';
  const contact = declared(
    p,
    'tuberculosis_contact',
    'tb_close_contact',
    'close_contact_tuberculosis',
  );
  return diagnosed === 'No' && contact === 'No' ? 'No' : undefined;
}

/** The form's options for the listed conditions, exactly as worded. */
const CONDITION_OPTIONS = [...ETA_LISTED_CONDITIONS, 'None of the above'];

/**
 * The answer to "which one?" after a "yes": an option's own words, with or
 * without "Untreated" (the question names only untreated conditions). Never
 * a pattern match: "alcohol addiction" or two conditions answer nothing.
 */
function whichCondition(p: Profile): string | undefined {
  const said = pickText(p, ...factKeys('eta_medical_condition'));
  if (!said) return undefined;
  const s = normalAnswer(said).replace(/^an? /, '');
  return ETA_LISTED_CONDITIONS.find(
    (o) =>
      o.toLowerCase() === s || o.toLowerCase().replace(/^untreated /, '') === s,
  );
}

const normalAnswer = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');

/**
 * "Do you have one of these conditions?" (untreated syphilis, untreated
 * drug or alcohol addiction, untreated mental health condition with
 * psychosis, None of the above). The interview asks exactly this
 * (`eta_medical_conditions`) and its answer is read STRICTLY: false / "no" /
 * "none" / "none of the above" is "None of the above"; an answer that IS one
 * option's text chooses it; anything else — a bare yes, or free text such as
 * "No drug or alcohol problems" or "addiction, but treated" — is left for the
 * applicant. Free text is never pattern-matched into a health declaration.
 *
 * With no answer to it: "None of the above" only when the applicant said no
 * to every broader IRCC question that covers one of them. A "Yes" to a
 * broader question is not one of the listed conditions (treated, or no
 * psychosis), so the applicant answers it.
 */
function healthConditions(p: Profile): string | undefined {
  const keys = [...factKeys('eta_medical_conditions'), 'eta_health_conditions'];
  for (const k of keys) {
    const v = p[k];
    if (v === false) return 'None of the above';
    // "Yes": the follow-up says which one (one only — the select has one).
    if (intakeAnswerIsYes(v) === true) return whichCondition(p);
    if (typeof v === 'string' && v.trim()) {
      const said = normalAnswer(v);
      if (said === 'no' || said === 'none') return 'None of the above';
      return CONDITION_OPTIONS.find((o) => o.toLowerCase() === said);
    }
    if (v != null) return undefined; // a number, a list: not an option
  }
  const answers = [
    declared(p, 'syphilis', 'has_syphilis'),
    declared(
      p,
      'addiction',
      'drug_or_alcohol_addiction',
      'substance_addiction',
    ),
    declared(p, 'mental_health_condition', 'mental_health'),
  ];
  return answers.every((a) => a === 'No') ? 'None of the above' : undefined;
}

// ── CAN+ prerequisites (visa-required nationals; live 2026-10-18) ───────────

/**
 * A national of a CAN+ country (visa-required, may apply for an eTA when
 * flying with a Canadian visa in the past 10 years or a valid U.S. visa). The
 * passport decides, as in the eligibility check. Only they see these
 * questions; for anyone else the fields are not on the form.
 */
const canPlus = (p: Profile) => isEtaConditional(profileNationality(p));

/** A CAN+ national's explicit yes/no to an interview fact, else nothing. */
const canPlusAnswer = (key: string) => (p: Profile) =>
  canPlus(p) ? declared(p, ...factKeys(key)) : undefined;

// ── background follow-ups ───────────────────────────────────────────────────

/**
 * "For each arrest, charge, or conviction, please indicate where (city,
 * country), when (month/year), the nature of the offence, and the sentence."
 * The interview's own words only: its text, or its list of records one
 * sentence each, else the visitor-visa interview's per-part details joined.
 * Nothing is added; no details → nothing written.
 */
export function criminalDetails(p: Profile): string | undefined {
  for (const k of factKeys('criminal_offence_details')) {
    const v = p[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    const listed = offenceRecordsText(v);
    if (listed) return listed;
  }
  const parts = [
    'committed_crime_details',
    'ever_arrested_details',
    'arrest_details',
    'ever_charged_details',
    'charge_details',
    'criminal_charge_details',
    'ever_convicted_details',
    'conviction_details',
    'criminal_conviction_details',
  ]
    .map((k) => pickText(p, k))
    .filter((x): x is string => !!x);
  const distinct = [...new Set(parts)];
  return distinct.length
    ? distinct.map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)).join(' ')
    : undefined;
}

function offenceRecordsText(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined;
  const str = (r: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) {
      const x = r[k];
      if (typeof x === 'string' && x.trim()) return x.trim().replace(/\.$/, '');
    }
    return undefined;
  };
  const lines = v
    .map((r) => {
      if (typeof r === 'string') return r.trim() || undefined;
      if (!r || typeof r !== 'object') return undefined;
      const rec = r as Record<string, unknown>;
      const offence = str(rec, 'offence', 'offense', 'nature', 'charge');
      const place = [str(rec, 'city'), str(rec, 'country')]
        .filter(Boolean)
        .join(', ');
      const when = str(rec, 'month_year', 'date', 'when');
      const sentence = str(rec, 'sentence', 'outcome');
      if (!offence && !place && !when) return undefined;
      const what = offence
        ? offence.charAt(0).toUpperCase() + offence.slice(1)
        : 'Offence';
      const head = `${what}${place ? ` in ${place}` : ''}${when ? ` in ${when}` : ''}.`;
      return sentence ? `${head} Sentence: ${sentence}.` : head;
    })
    .filter((x): x is string => !!x);
  return lines.length ? lines.join(' ') : undefined;
}

/**
 * "Have you ever been diagnosed with tuberculosis?" — the interview's own
 * answer; else a "Yes" to a diagnosis in the past two years, which it covers.
 * A "No" to the two-year question says nothing about earlier years.
 */
function everDiagnosedWithTb(p: Profile): 'Yes' | 'No' | undefined {
  const own = declared(p, ...factKeys('tuberculosis_ever_diagnosed'));
  if (own) return own;
  return declared(
    p,
    'tuberculosis',
    'tuberculosis_diagnosed',
    'tb_diagnosed',
    'has_tuberculosis',
  ) === 'Yes'
    ? 'Yes'
    : undefined;
}

// ── marital status and occupation ──────────────────────────────────────────
const MARITAL_KEYS = factKeys('marital_status');
const OCCUPATION_KEYS = factKeys('occupation');
const JOB_TITLE_KEYS = factKeys('job_title');

const maritalStatus = (p: Profile) =>
  etaMaritalOption(pickText(p, ...MARITAL_KEYS));

/**
 * The occupation group and, when the recorded list has it, the job title.
 *
 *  1. The answer IS one of the form's options (the consultant's correction,
 *     or the applicant naming the group): that option.
 *  2. A non-working status named ANYWHERE in the employment answers —
 *     "Retired school teacher", "unemployed (former engineer)", "Pensioner
 *     (retired doctor)" — or an explicit retired / student flag. The former
 *     job beside it never picks a working group. "Not working" beside another
 *     status adds nothing. Two different statuses answer nothing, as does a
 *     "semi-retired" one; a student who also names a job ("Student, part-time
 *     cashier") answers nothing (which one IRCC wants is the applicant's call).
 *  3. A former job with no current status ("former teacher", "ex-police
 *     officer", "previously accountant") answers nothing.
 *  4. Otherwise a working group from the job title (then the occupation
 *     answer) by the IRCC tr-rt rules, unless the applicant said they are not
 *     employed. Armed-forces service is Military/armed forces, never a title.
 *
 * Anything else is undefined: the applicant chooses.
 */
export function etaOccupation(p: Profile): {
  category?: string;
  title?: string;
} {
  const said = pickText(p, ...OCCUPATION_KEYS);
  const job = pickText(p, ...JOB_TITLE_KEYS);
  // The applicant's own choice from IRCC's list, asked when the answers
  // above do not name a group (audit 2026-10-19).
  const group = etaGroupAnswer(p);
  if (group) return withTitle(group, job);
  const exact = exactOption(said, ETA_OCCUPATION_OPTIONS);
  if (exact) return withTitle(exact, job);

  const texts = [said, job, pickText(p, 'employment_status', 'employed')];
  const readings = texts.map(etaStatusesIn);
  if (readings.some((r) => r.unsure)) return {};
  const statuses = new Set(readings.flatMap((r) => r.statuses));
  if (declared(p, 'is_retired', 'retired') === 'Yes')
    statuses.add(ETA_OCCUPATION.retired);
  if (declared(p, 'is_student') === 'Yes') statuses.add(ETA_OCCUPATION.student);
  // "Retired, not working": not working is part of the other status.
  if (statuses.size > 1) statuses.delete(ETA_OCCUPATION.unemployed);

  if (statuses.size > 1) return {};
  if (statuses.size === 1) {
    const [status] = [...statuses];
    if (
      status === ETA_OCCUPATION.student &&
      [said, job].some((t) => etaWorkFor(t))
    )
      return {};
    return { category: status };
  }
  if (readings.some((r) => r.past)) return {};
  if (declared(p, 'employed', 'is_employed', 'currently_employed') === 'No')
    return {};
  const work = etaWorkFor(job) ?? etaWorkFor(said);
  return work ? withTitle(work.category, job ?? said) : {};
}

/**
 * The group the applicant chose from IRCC's list: its exact text, or the text
 * without the trailing "occupations" ("Health" for "Health occupations").
 */
function etaGroupAnswer(p: Profile): string | undefined {
  const said = pickText(p, ...factKeys('eta_occupation_group'));
  if (!said) return undefined;
  return (
    exactOption(said, ETA_OCCUPATION_OPTIONS) ??
    ETA_OCCUPATION_OPTIONS.find(
      (o) =>
        / occupations$/.test(o) &&
        exactOption(said, [o.replace(/ occupations$/, '')]),
    )
  );
}

/** The group, and its title only from that group's recorded list. */
function withTitle(
  category: string,
  job: string | undefined,
): { category: string; title?: string } {
  if (!ETA_TITLED.includes(category)) return { category };
  const exact = exactOption(job, ETA_TITLES[category] ?? []);
  if (exact) return { category, title: exact };
  const work = etaWorkFor(job);
  return work?.category === category && work.title
    ? { category, title: work.title }
    : { category };
}

const employerOrSchool = (p: Profile) =>
  pickText(p, ...factKeys('employer_name'));

const UK_NATIONS = /^(England|Scotland|Wales|Northern Ireland)$/i;

/**
 * Country of employer or school. The eTA place list names the UK by nation and
 * has no "United Kingdom" (dry run 2026-10-18: "United Kingdom" left the field
 * blank). When the applicant works in the city they live in, in the same
 * country, the nation is the one their address already names ("England");
 * otherwise a UK employer's nation is unknown and the applicant chooses.
 */
function employmentCountry(p: Profile): string | undefined {
  const said = pickText(p, ...factKeys('employment_country'));
  if (!said) return undefined;
  const iso = toIso3(said);
  const home = addressCountryText(p);
  const workCity = employmentCity(p)?.trim().toLowerCase();
  const homeCity = residentialAddress(p)?.city?.trim().toLowerCase();
  if (
    iso === 'GBR' &&
    !UK_NATIONS.test(said.trim()) &&
    home &&
    UK_NATIONS.test(home.trim()) &&
    workCity &&
    workCity === homeCity
  )
    return home.trim();
  return said;
}


/** A city, never a country named as one. */
function employmentCity(p: Profile): string | undefined {
  const city = pickText(p, ...factKeys('employment_city'));
  return city && !toIso3(city) ? city : undefined;
}

/**
 * "Since what year?" — a four-digit year (or the year of a date) between
 * 1900 and this year, the range of the form's list. Anything else answers
 * nothing.
 */
function sinceYear(p: Profile): string | undefined {
  const raw = pickText(
    p,
    ...factKeys('employment_since_year'),
    'employment_start_date',
  );
  const m = raw ? /^(\d{4})(?:$|[-/.\s])/.exec(raw.trim()) : null;
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= 1900 && year <= new Date().getUTCFullYear() ? m[1] : undefined;
}

/** Follow-ups of the occupation select, gated on the group that opens them. */
const DETAILS: Extra = { parent: 'occupation', parentValue: ETA_WITH_DETAILS };

// ── the mapping, in form order ──────────────────────────────────────────────
export const ETA_MAPPING: FillFieldMapping[] = [
  // ── Welcome (then the form's own Next) ────────────────────────────────────
  choose(
    'applying_on_behalf',
    '[id="welcome_isRepresentative"]',
    'Applying on behalf of someone',
    'passport',
    isRepresentative,
  ),

  // ── Prerequisites (then Next) ─────────────────────────────────────────────
  choose(
    'travel_document_type',
    app('prerequisite_travelDocumentType'),
    'Travel document',
    'passport',
    travelDocumentType,
  ),
  choose(
    'passport_country',
    app('prerequisite_countryOfCitizenship'),
    'Passport country code',
    'passport',
    passportCountry,
    { transform: 'eta_country_code' },
  ),
  // CAN+ only. "Yes": IRCC says no eTA is needed and shows nothing else, so
  // the chain below waits for a "No". Silent: `left` explains a blank.
  choose(
    'us_permanent_resident',
    app('prerequisite_isPermanentResidentOfUSAndHaveProofOfPermResidence'),
    'Lawful permanent resident of the U.S. with proof of status',
    'passport',
    canPlusAnswer('us_permanent_resident'),
    { silent: true },
  ),
  choose(
    'nationality',
    app('prerequisite_passportNotedNationality'),
    'Nationality noted on passport',
    'passport',
    nationality,
    { transform: 'eta_nationality' },
  ),
  choose(
    'travel_by_air',
    app('prerequisite_isTravellingByAir'),
    'Travelling to Canada by air',
    'passport',
    canPlusAnswer('travel_by_air'),
    { parent: 'us_permanent_resident', parentValue: 'No' },
  ),
  choose(
    'canadian_visa_last_10y',
    app('prerequisite.etaExpansion_hasCanadianTemporaryVisa'),
    'Held a valid Canadian temporary resident visa in the past 10 years',
    'passport',
    canPlusAnswer('canadian_visa_last_10y'),
    { parent: 'travel_by_air', parentValue: 'Yes' },
  ),
  // Shown once the 10-year question is answered, Yes or No.
  choose(
    'valid_us_nonimmigrant_visa',
    app('prerequisite.etaExpansion_hasNonImmigrantVisa'),
    'Currently holds a valid U.S. non-immigrant visa',
    'passport',
    canPlusAnswer('valid_us_nonimmigrant_visa'),
    { parent: 'canadian_visa_last_10y' },
  ),
  text(
    'us_nonimmigrant_visa_number',
    app('prerequisite.etaExpansion_nonImmigrantVisaNumber'),
    'U.S. non-immigrant visa number',
    'passport',
    fact('us_nonimmigrant_visa_number'),
    { parent: 'valid_us_nonimmigrant_visa', parentValue: 'Yes' },
  ),
  text(
    'us_nonimmigrant_visa_number',
    app('prerequisite.etaExpansion_nonImmigrantVisaNumberReEnter'),
    'U.S. non-immigrant visa number (confirm)',
    'passport',
    fact('us_nonimmigrant_visa_number'),
    { parent: 'valid_us_nonimmigrant_visa', parentValue: 'Yes' },
  ),
  ...dateSelects(
    'us_nonimmigrant_visa_expiry_date',
    'prerequisite.etaExpansion_nonImmigrantVisaNumberExpiryDate',
    'U.S. non-immigrant visa expiry date',
    'passport',
    { parent: 'valid_us_nonimmigrant_visa', parentValue: 'Yes' },
  ),

  // ── Personal details ──────────────────────────────────────────────────────
  text(
    'passport_number',
    app('personalDetails_passportNumber'),
    'Passport number',
    'passport',
    fact('passport_number'),
  ),
  text(
    'passport_number',
    app('personalDetails_passportNumberReEnter'),
    'Passport number (confirm)',
    'passport',
    fact('passport_number'),
  ),
  text(
    'family_name',
    app('personalDetails_lastName'),
    'Surname(s) / last name(s)',
    'passport',
    fact('family_name'),
  ),
  text(
    'given_name',
    app('personalDetails_firstName'),
    'Given name(s) / first name(s)',
    'passport',
    fact('given_name'),
  ),
  ...dateSelects(
    'date_of_birth',
    'personalDetails_dob',
    'Date of birth',
    'passport',
  ),
  choose('sex', app('personalDetails_gender'), 'Gender', 'passport', gender),
  choose(
    'country_of_birth',
    app('personalDetails_countryOfBirth'),
    'Country of birth',
    'passport',
    birthCountryText,
    { transform: 'eta_place_country' },
  ),
  text(
    'city_of_birth',
    app('personalDetails_cityTownOfBirth'),
    'City / town of birth',
    'passport',
    birthCity,
  ),
  ...dateSelects(
    'passport_issue_date',
    'personalDetails_issueDate',
    'Passport issue date',
    'passport',
  ),
  ...dateSelects(
    'passport_expiry_date',
    'personalDetails_expiryDate',
    'Passport expiry date',
    'passport',
  ),
  // Optional, one country (live 2026-10-19): the nationality list without
  // the passport's own. Silent: `left` notes a second or unlisted one.
  choose(
    'other_citizenships',
    app('personalDetails_additionalCitizenship'),
    'Additional citizenship',
    'passport',
    (p) => additionalCitizenships(p).find((c) => etaNationalityOption(c)),
    { transform: 'eta_nationality', silent: true },
  ),
  // Required (live 2026-10-18). Silent: a blank is explained by `left`.
  choose(
    'marital_status',
    app('personalDetails_maritalStatus'),
    'Marital status',
    'passport',
    maritalStatus,
    { silent: true },
  ),
  choose(
    'previous_canada_application',
    app('personalDetails_hasPreviouslyAppliedToCanada'),
    'Applied to come to Canada before',
    'travel_history',
    previouslyApplied,
  ),
  text(
    // Not 'uci': a text field writes its own key's value as stored, and the
    // interview's 'uci' may hold "I don't know". `uci()` reads it, filtered.
    'ircc_uci',
    app('personalDetails_uci'),
    'Unique client identifier (UCI)',
    'travel_history',
    uci,
    // Silent: `left` says why it is blank ("I don't know" is an answer).
    { parent: 'previous_canada_application', parentValue: 'Yes', silent: true },
  ),
  text(
    // Not 'uci': a text field writes its own key's value as stored, and the
    // interview's 'uci' may hold "I don't know". `uci()` reads it, filtered.
    'ircc_uci',
    app('personalDetails_uciReEnter'),
    'Unique client identifier (UCI) (confirm)',
    'travel_history',
    uci,
    { parent: 'previous_canada_application', parentValue: 'Yes', silent: true },
  ),

  // ── Employment (required; live 2026-10-18) ────────────────────────────────
  // Silent: a blank group or title is explained by `left`, which knows why.
  choose(
    'occupation',
    app('employmentDetails_occupation'),
    'Occupation',
    'employment',
    (p) => etaOccupation(p).category,
    { silent: true },
  ),
  text(
    'employer_name',
    app('employmentDetails_companyEmployerSchoolFacilityName'),
    'Name of employer or school',
    'employment',
    employerOrSchool,
    DETAILS,
  ),
  choose(
    'employment_country',
    app('employmentDetails_country'),
    'Country of employer or school',
    'employment',
    employmentCountry,
    { ...DETAILS, transform: 'eta_place_country' },
  ),
  text(
    'employment_city',
    app('employmentDetails_city'),
    'City / town of employer or school',
    'employment',
    employmentCity,
    DETAILS,
  ),
  choose(
    'employment_since_year',
    app('employmentDetails_fromDateYear'),
    'Since what year',
    'employment',
    sinceYear,
    DETAILS,
  ),
  // LAST of the block: its options load 1–5 s after the group is chosen, so
  // the writes above give the list time to arrive, and the extension waits
  // for the option before choosing it. Never for Military/armed forces.
  choose(
    'job_title',
    app('employmentDetails_title'),
    'Job title',
    'employment',
    (p) => etaOccupation(p).title,
    {
      parent: 'occupation',
      parentValue: ETA_TITLED,
      silent: true,
      awaitOptions: true,
    },
  ),

  // ── Contact details ───────────────────────────────────────────────────────
  choose(
    'preferred_contact_language',
    app('contactDetails_languageOfPreference'),
    'Preferred language of contact',
    'addresses',
    preferredLanguage,
  ),
  text(
    'email',
    app('contactDetails_emailAddress'),
    'Email address',
    'addresses',
    applicantEmail,
  ),
  text(
    'email',
    app('contactDetails_emailAddressReEnter'),
    'Email address (confirm)',
    'addresses',
    applicantEmail,
  ),
  text(
    'residential_address_apartment',
    app('contactDetails_aptUnit'),
    'Apartment / unit',
    'addresses',
    (p) => residentialAddress(p)?.apartment,
  ),
  text(
    'residential_address_street_number',
    app('contactDetails_streetNo'),
    'Street / civic number',
    'addresses',
    (p) => streetParts(p).number,
  ),
  text(
    'residential_address_street_name',
    app('contactDetails_streetAddress'),
    'Street address',
    'addresses',
    (p) => streetParts(p).name,
  ),
  text(
    'residential_address_city',
    app('contactDetails_city'),
    'City / town',
    'addresses',
    (p) => residentialAddress(p)?.city,
  ),
  choose(
    'residential_address_country',
    app('contactDetails_country'),
    'Country',
    'addresses',
    addressCountryText,
    { transform: 'eta_place_country' },
  ),

  // ── Travel details ────────────────────────────────────────────────────────
  choose(
    'travel_date_known',
    app('travelDetails_isTravelDateKnown'),
    'Know when you will travel to Canada',
    'dates',
    travelDateKnown,
  ),
  ...dateSelects(
    'planned_entry_date',
    'travelDetails_travelDate',
    'Date of travel to Canada',
    'dates',
    { parent: 'travel_date_known', parentValue: 'Yes' },
  ),
  // Required once the date is known (live 2026-10-18). Options are
  // zero-padded 24-hour text, "00".."23" and "00".."59" (live 2026-10-19).
  // Silent: `left` lists the time when it is not written.
  choose(
    'planned_entry_time',
    app('travelDetails_travelDateTimeHour'),
    'Time of arrival — hour',
    'dates',
    (p) => arrivalTime(p)?.hour,
    { parent: 'travel_date_known', parentValue: 'Yes', silent: true },
  ),
  choose(
    'planned_entry_time',
    app('travelDetails_travelDateTimeMinute'),
    'Time of arrival — minute',
    'dates',
    (p) => arrivalTime(p)?.minute,
    { parent: 'travel_date_known', parentValue: 'Yes', silent: true },
  ),
  // Required with the time (live 2026-10-19, 160 options): the zone of the
  // local time the flight lands, only alongside a time it qualifies.
  choose(
    'planned_entry_timezone',
    app('travelDetails_travelDateTimeTimezone'),
    'Time of arrival — time zone',
    'dates',
    (p) => (arrivalTime(p) ? arrivalTimeZone(p) : undefined),
    { parent: 'travel_date_known', parentValue: 'Yes', silent: true },
  ),

  // ── Background questions (declarations) ───────────────────────────────────
  declaration(
    'refused_visa_or_denied_entry',
    'refusedVisaOrPermitOrDeniedEntryToCanada',
    'Ever refused a visa or permit, denied entry or ordered to leave Canada or any other country',
    refusedOrDenied,
  ),
  text(
    'refusal_details',
    app('backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanadaDetails'),
    'Refusal, denied entry or removal — details',
    'travel_history',
    // The record is used under THIS question's "Yes", whichever key gave it.
    (p) => refusalDetails(p, refusedOrDenied(p) === 'Yes'),
    {
      parent: 'refused_visa_or_denied_entry',
      parentValue: 'Yes',
      declaration: true,
    },
  ),
  declaration(
    'criminal_offence',
    'committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhere',
    'Ever committed, been arrested for, charged with or convicted of a criminal offence in any country',
    criminalOffence,
  ),
  text(
    'criminal_offence_details',
    app(
      'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhereDetails',
    ),
    'Arrest, charge or conviction — details',
    'travel_history',
    criminalDetails,
    { parent: 'criminal_offence', parentValue: 'Yes', declaration: true },
  ),
  declaration(
    'tuberculosis_last_2_years',
    'inThePastTwoYearsWereYouDiagnosedOrInCloseContactWithTuberculosis',
    'In the past two years, diagnosed with tuberculosis or in close contact with a person with tuberculosis',
    tuberculosis,
  ),
  // IRCC's id spells it "Heath" (live 2026-10-18).
  declaration(
    'tuberculosis_health_care_worker',
    'isYourContactWithTuberculosisTheResultOfBeingAHeathCareWorker',
    'Tuberculosis contact the result of being a health care worker',
    (p) => declared(p, ...factKeys('tuberculosis_health_care_worker')),
    { parent: 'tuberculosis_last_2_years', parentValue: 'Yes' },
  ),
  declaration(
    'tuberculosis_ever_diagnosed',
    'haveYouEverBeenDiagnosedWithTuberculosis',
    'Ever diagnosed with tuberculosis',
    everDiagnosedWithTb,
    { parent: 'tuberculosis_health_care_worker', parentValue: 'Yes' },
  ),
  declaration(
    'eta_medical_conditions',
    'doYouHaveOneOfTheseConditions',
    'Has one of the listed health conditions',
    healthConditions,
  ),
];

/**
 * Marital status, occupation group and job title: required on the form, and
 * left blank whenever the answers do not name one option. The note says why —
 * nothing to go on, or an answer that does not match IRCC's list closely
 * enough to choose for the applicant. (Values only ever appear in the review;
 * a note never repeats them.)
 *
 * A field the consultant EXCLUDED in the review is not written either, and
 * the generic coverage skips excluded fields; these are required, so they
 * are listed here — and so are the required follow-ups of the group.
 */
function maritalAndOccupationNotes(
  p: Profile,
  exclude: ReadonlySet<string>,
): ManualFieldNote[] {
  const notes: ManualFieldNote[] = [];
  const excluded = (label: string, extra = ''): ManualFieldNote => ({
    page: ETA_PAGE,
    label,
    reason: 'fill_yourself',
    note: `${EXCLUDED_NOTE}${extra}`,
  });
  if (exclude.has('marital_status')) notes.push(excluded('Marital status'));
  else if (!maritalStatus(p)) {
    const said = pickText(p, ...MARITAL_KEYS);
    notes.push({
      page: ETA_PAGE,
      label: 'Marital status',
      reason: said ? 'fill_yourself' : 'not_in_profile',
      ...(said
        ? {
            note: `Your answer does not match one of IRCC's options (${ETA_MARITAL_OPTIONS.join(', ')}). Choose the one that applies.`,
          }
        : {}),
    });
  }
  const { category, title } = etaOccupation(p);
  if (exclude.has('occupation')) {
    notes.push(excluded('Occupation', ` ${FOLLOW_UPS}`));
    return notes;
  }
  if (!category) {
    const said =
      pickText(p, ...OCCUPATION_KEYS, ...JOB_TITLE_KEYS, 'employment_status') ??
      declared(p, 'employed', 'is_employed');
    notes.push({
      page: ETA_PAGE,
      label: 'Occupation',
      reason: said ? 'fill_yourself' : 'not_in_profile',
      note: `${
        said
          ? "The assistant could not match your answers to one of IRCC's occupation groups with confidence, so you choose it. "
          : ''
      }${FOLLOW_UPS}`,
    });
    return notes;
  }
  if (ETA_WITH_DETAILS.includes(category))
    for (const [key, label] of DETAIL_LABELS)
      if (exclude.has(key)) notes.push(excluded(label));
  if (ETA_WORKING.includes(category)) {
    if (exclude.has('job_title')) notes.push(excluded('Job title'));
    else if (!title)
      notes.push({
        page: ETA_PAGE,
        label: 'Job title',
        reason: 'fill_yourself',
        note:
          category === ETA_OCCUPATION.military
            ? 'IRCC lists Canadian Armed Forces trades for this group; choose yours.'
            : "Choose the title closest to your job from IRCC's list for your occupation group. The list appears a few seconds after the group is chosen.",
      });
  }
  return notes;
}

/** Said in the review: the consultant took the value out of the fill. */
const EXCLUDED_NOTE =
  "Taken out of the assistant's fill in the review. IRCC requires it: answer it yourself.";

const FOLLOW_UPS =
  'If you work or study, IRCC then asks your job title, the name of your employer or school, its country and city, and since what year.';

/** The group's required follow-ups, by interview key. */
const DETAIL_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['employer_name', 'Name of employer or school'],
  ['employment_country', 'Country of employer or school'],
  ['employment_city', 'City / town of employer or school'],
  ['employment_since_year', 'Since what year'],
];

/**
 * The U.S. permanent-residence question. A CAN+ national's answer is filled
 * (blank: their answer is needed); "Yes" ends the form. Another visa-required
 * national (or an unknown one) may see the question, unrecorded for them.
 */
function usPermanentResidenceNotes(
  p: Profile,
  exclude: ReadonlySet<string>,
): ManualFieldNote[] {
  const label = 'U.S. permanent residence question';
  if (canPlus(p)) {
    if (exclude.has('us_permanent_resident'))
      return [
        { page: ETA_PAGE, label, reason: 'fill_yourself', note: EXCLUDED_NOTE },
      ];
    const said = canPlusAnswer('us_permanent_resident')(p);
    if (said === 'Yes')
      return [
        {
          page: ETA_PAGE,
          label: 'The rest of the eTA form',
          reason: 'fill_yourself',
          note: 'IRCC says a lawful permanent resident of the United States does not need an eTA, and the form shows nothing after this answer. Travel with your passport and green card.',
        },
      ];
    return said ? [] : [{ page: ETA_PAGE, label, reason: 'not_in_profile' }];
  }
  if (isEtaVisaExempt(profileNationality(p))) return [];
  return [
    {
      page: ETA_PAGE,
      label,
      reason: 'fill_yourself',
      note: 'Shown only to some nationalities.',
    },
  ];
}

/**
 * personalDetails_additionalCitizenship (optional, one country): the first
 * other citizenship is chosen. Noted only when the form cannot hold what the
 * applicant told us (a second one, or one not on IRCC's list), or when we do
 * not know.
 */
function additionalCitizenshipNotes(p: Profile): ManualFieldNote[] {
  const label = 'Additional citizenship';
  const other = pick(p, ...factKeys('other_citizenships'));
  const none =
    (Array.isArray(other) && other.length === 0) ||
    declared(p, ...factKeys('other_citizenships')) === 'No' ||
    declared(p, 'multiple_citizenship', 'dual_citizenship', 'dual_national') ===
      'No';
  if (none) return [];
  const list = additionalCitizenships(p);
  const chosen = list.find((c) => etaNationalityOption(c));
  const name = (iso: string) => etaNationalityOption(iso) ?? iso;
  if (chosen && list.length > 1)
    return [
      {
        page: ETA_PAGE,
        label,
        reason: 'fill_yourself',
        note: `IRCC's form takes only one additional citizenship: the assistant chose ${name(chosen)}. Your others (${list
          .filter((c) => c !== chosen)
          .map(name)
          .join(', ')}) do not fit on the form.`,
      },
    ];
  if (chosen) return [];
  if (list.length || pickText(p, ...factKeys('other_citizenships')))
    return [
      {
        page: ETA_PAGE,
        label,
        reason: 'fill_yourself',
        note: "Choose the other citizenship you told us about from IRCC's list (it is optional).",
      },
    ];
  return [
    {
      page: ETA_PAGE,
      label,
      reason: 'fill_yourself',
      note: 'Optional: if you are also a citizen of another country, choose it; otherwise leave it empty.',
    },
  ];
}

/**
 * The UCI after "applied before = Yes", when no number is on file. Optional
 * on the form (live 2026-10-19): a gentle pointer, never a blocker.
 */
function uciNotes(p: Profile, exclude: ReadonlySet<string>): ManualFieldNote[] {
  if (exclude.has('previous_canada_application')) return [];
  if (previouslyApplied(p) !== 'Yes' || uci(p)) return [];
  return [
    {
      page: ETA_PAGE,
      label: 'Unique client identifier (UCI)',
      reason: 'fill_yourself',
      note: 'Optional. If you have it (on an earlier Canadian visa, permit or eTA approval, or IRCC letters), you may enter it; otherwise leave it empty.',
    },
  ];
}

/**
 * The time of travel: hour, minute and time zone are required once the
 * date is known. Listed only for what the assistant could not choose.
 */
function arrivalTimeNotes(
  p: Profile,
  exclude: ReadonlySet<string>,
): ManualFieldNote[] {
  if (travelDateKnown(p) !== 'Yes' || exclude.has('travel_date_known'))
    return [];
  const timed = !exclude.has('planned_entry_time') && arrivalTime(p);
  if (!timed)
    return [
      {
        page: ETA_PAGE,
        label: 'Time and time zone of your flight',
        reason: 'fill_yourself',
        note: 'Enter the local time your flight lands and the time zone of that Canadian airport.',
      },
    ];
  if (!exclude.has('planned_entry_timezone') && arrivalTimeZone(p)) return [];
  const said = pickText(p, ...factKeys('planned_entry_timezone'));
  return [
    {
      page: ETA_PAGE,
      label: 'Time zone of your flight',
      reason: said ? 'fill_yourself' : 'not_in_profile',
      note: said
        ? `VisaAI could not tell the time zone of "${said}": choose the time zone of the Canadian airport where you land.`
        : 'Choose the time zone of the Canadian airport where you land.',
    },
  ];
}

/** What the applicant fills on the eTA form, given this profile. */
function leftForApplicant(
  p: Profile,
  exclude: ReadonlySet<string> = new Set(),
): ManualFieldNote[] {
  const notes: ManualFieldNote[] = [
    {
      page: ETA_PAGE,
      label: 'Representative details',
      reason: 'fill_yourself',
      when: () => isRepresentative(p) === 'Yes',
    },
    ...usPermanentResidenceNotes(p, exclude),
    ...additionalCitizenshipNotes(p),
    ...uciNotes(p, exclude),
    ...maritalAndOccupationNotes(p, exclude),
    {
      page: ETA_PAGE,
      label: 'Province or state, postal code and district of your address',
      reason: 'fill_yourself',
      note: 'Shown for some countries only.',
    },
    ...arrivalTimeNotes(p, exclude),
    {
      page: ETA_PAGE,
      label: 'Which listed health condition',
      reason: 'needs_your_answer',
      note: 'You said yes to the listed health conditions. IRCC asks you to choose the one that applies: the assistant does not choose a health declaration for you.',
      when: () =>
        !exclude.has('eta_medical_conditions') &&
        declared(p, ...factKeys('eta_medical_conditions')) === 'Yes' &&
        !healthConditions(p),
    },
    {
      page: ETA_PAGE,
      label: 'Additional details (health insurance)',
      reason: 'fill_yourself',
    },
    {
      page: ETA_PAGE,
      label: 'Consent and declaration, and your signature',
      reason: 'fill_yourself',
      note: 'You tick the declaration and type your name to sign it. The assistant never does.',
    },
  ];
  return notes.filter((n) => !n.when || n.when(p));
}

registerPortalFill('ircc-eta', ETA_MAPPING, {
  pages: ETA_PAGES,
  left: leftForApplicant,
});
