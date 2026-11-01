import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import {
  IRCC_STUDY_FACTS,
  intakeAnswerIsYes,
  looksLikeIrccNumber,
  readIntakeFact,
  type IntakeFactSpec,
  type PrefilledFormPayload,
  type PrefilledFormField,
} from '@visaai/types';

/**
 * IMM 1294 — Application for Study Permit Made Outside of Canada (IRCC).
 *
 * Since 2025-03-25 a study permit from outside Canada is applied for in the
 * IRCC secure account (GCKey): the applicant downloads IMM 1294 from the
 * account's document checklist, fills it in Adobe Reader, clicks Validate and
 * uploads it. The study route's interview (IRCC_STUDY_FACTS) asks what
 * IMM 1294 asks, so VisaAI prepares the answers instead of leaving the
 * applicant a bare form code.
 *
 * WHY AN ANSWER SHEET AND NOT THE OFFICIAL PDF
 *
 * The official IMM 1294 is an XFA form handed out inside the applicant's
 * account; there is no blank VisaAI can stamp. This renders every IMM 1294
 * answer, in the form's own section order and wording, on a printable sheet:
 * the applicant copies them onto the official form. The signature and its
 * date are never filled — only the applicant may sign.
 *
 * Declarations (background questions, yes/no items) come only from an
 * explicit answer. An absent one is listed as missing, never written as "No".
 */

export type Profile = Record<string, unknown>;

export interface Imm1294Line {
  section: string;
  label: string;
  value: string;
}

export interface Imm1294Answers {
  lines: Imm1294Line[];
  /** Answers the profile does not hold: the applicant writes them in. */
  missing: string[];
}

// ── reading the profile ─────────────────────────────────────────────────────

/** The study route's specs, so every alias the interview records is read. */
const SPECS = new Map<string, IntakeFactSpec>(
  IRCC_STUDY_FACTS.map((s) => [s.key, s]),
);

/**
 * Keys IMM 1294 asks that the study interview does not (yet) record under a
 * spec of its own: the aliases other IRCC routes use for them.
 */
const EXTRA_ALIASES: Record<string, readonly string[]> = {
  uci: [
    'unique_client_identifier',
    'previous_canadian_visa_number',
    'client_id',
  ],
  passport_country: [
    'passport_issuing_country',
    'passport_country_code',
    'issuing_country',
  ],
  passport_issue_date: [
    'issue_date',
    'date_of_issue',
    'passport_date_of_issue',
  ],
  us_permanent_resident: [
    'is_us_permanent_resident',
    'us_lawful_permanent_resident',
    'has_us_green_card',
    'us_green_card',
  ],
  us_pr_card_number: ['us_green_card_number', 'green_card_number'],
  us_pr_card_expiry_date: [
    'us_green_card_expiry_date',
    'green_card_expiry_date',
  ],
  national_id_country: [
    'national_id_issuing_country',
    'national_identity_card_country',
    'national_identity_document_country',
    'national_id_card_country',
  ],
  national_id_issue_date: [
    'national_identity_card_issue_date',
    'national_identity_document_issue_date',
    'national_id_card_issue_date',
    'cnic_issue_date',
  ],
  national_id_expiry_date: [
    'national_identity_card_expiry_date',
    'national_id_card_expiry_date',
    'cnic_expiry_date',
  ],
  residence_status: [
    'status_in_country_of_residence',
    'country_of_residence_status',
    'immigration_status',
  ],
  residence_since: ['living_since', 'resident_since'],
  applying_from_country: ['country_applying_from', 'applying_from'],
  preferred_contact_language: ['preferred_language'],
  language_test_taken: ['took_language_test', 'has_language_test'],
  language_test_type: [
    'english_test_type',
    'language_test',
    'french_test_type',
  ],
  previously_married: [
    'applicant_previous_relationship',
    'has_previous_relationship',
  ],
  previous_relationships: ['previous_marriages', 'former_spouses'],
  other_costs_cad: ['other_study_costs_cad', 'other_expenses_cad'],
  has_post_secondary_education: ['post_secondary_education'],
  tuberculosis: ['tuberculosis_diagnosed', 'tb_diagnosed', 'has_tuberculosis'],
  multiple_citizenship: [
    'dual_citizenship',
    'dual_national',
    'has_multiple_citizenships',
  ],
  other_citizenships: ['other_citizenship', 'additional_citizenships'],
  ever_arrested: ['arrested', 'been_arrested'],
  ever_charged: ['been_charged', 'criminal_charges'],
  ever_convicted: [
    'been_convicted',
    'criminal_conviction',
    'criminal_convictions',
    'criminal_record',
  ],
};

function raw(p: Profile, key: string): unknown {
  const spec = SPECS.get(key);
  const extra = EXTRA_ALIASES[key] ?? [];
  return readIntakeFact(p, {
    key,
    aliases: [...(spec?.aliases ?? []), ...extra],
  });
}

function text(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

function fact(p: Profile, key: string): string | undefined {
  return text(raw(p, key));
}

/** A yes/no answer, or undefined when the profile does not hold one. */
function yesNo(p: Profile, key: string): boolean | undefined {
  return intakeAnswerIsYes(raw(p, key));
}

function formValue(
  payload: PrefilledFormPayload | null | undefined,
  key: string,
): string | undefined {
  const f = payload?.fields?.find((x: PrefilledFormField) => x.key === key);
  return text(f?.value);
}

function records(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter(
    (r): r is Record<string, unknown> =>
      !!r &&
      typeof r === 'object' &&
      !Array.isArray(r) &&
      (r as Record<string, unknown>).remove !== true,
  );
}

/** One record as "a, b, c", skipping empty and "unknown" pieces. */
function joinParts(...parts: unknown[]): string {
  return parts
    .map(text)
    .filter((s): s is string => !!s && s.toLowerCase() !== 'unknown')
    .join(', ');
}

/** A list answer (strings or records) as one line, or undefined. */
function listText(v: unknown): string | undefined {
  if (typeof v === 'string' || typeof v === 'number') return text(v);
  if (!Array.isArray(v)) return undefined;
  const items = v
    .map((x) =>
      x && typeof x === 'object'
        ? joinParts(...Object.values(x as Record<string, unknown>))
        : text(x),
    )
    .filter((s): s is string => !!s);
  return items.length ? items.join('; ') : undefined;
}

function money(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return /^\d[\d,.]*$/.test(v) ? `CAD ${v}` : v;
}

const yn = (b: boolean) => (b ? 'Yes' : 'No');

/** WinAnsi punctuation stand-ins; anything else outside Latin-1 is lost. */
function normalizePunct(s: string): string {
  return s.replace(/[—–]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** Can Helvetica (WinAnsi) print this value without dropping characters? */
function encodable(s: string): boolean {
  return !/[^\x20-\x7E\xA0-\xFF]/.test(normalizePunct(s));
}

const OWN_SCRIPT = 'write in your own script/letters as on passport';

// ── the answers ─────────────────────────────────────────────────────────────

/** Every IMM 1294 answer the profile supports, in the form's order. Pure. */
export function imm1294Answers(
  profile: Profile,
  payload?: PrefilledFormPayload | null,
): Imm1294Answers {
  const p = profile ?? {};
  const lines: Imm1294Line[] = [];
  const missing: string[] = [];
  // A value the sheet's font cannot print would come out corrupted: the
  // applicant writes it in by hand instead.
  const note = (section: string, label: string, value: string) => {
    if (encodable(value)) lines.push({ section, label, value });
    else missing.push(`${section}: ${label} (${OWN_SCRIPT})`);
  };
  const add = (section: string, label: string, value: string | undefined) => {
    if (value) note(section, label, value);
    else missing.push(`${section}: ${label}`);
  };
  const get = (key: string) => formValue(payload, key) ?? fact(p, key);

  // ── Personal details ─────────────────────────────────────────────────────
  const PD = 'Personal details';
  const prevApplied = raw(p, 'previous_canada_application');
  const uci =
    get('uci') ??
    (looksLikeIrccNumber(prevApplied) ? text(prevApplied) : undefined);
  // Optional on the form: only applicants who have one write it.
  note(PD, '1. UCI (if known)', uci ?? 'None - leave blank');
  const lang = fact(p, 'preferred_contact_language');
  add(
    PD,
    '2. I want service in',
    lang && /^(english|french)$/i.test(lang)
      ? lang[0].toUpperCase() + lang.slice(1).toLowerCase()
      : lang,
  );
  add(PD, '3. Full name: family name(s)', get('family_name'));
  add(PD, '3. Full name: given name(s)', get('given_name'));
  const hasOther = yesNo(p, 'has_other_names');
  const otherNames = records(raw(p, 'other_names'));
  if (otherNames.length) {
    note(
      PD,
      '4. Have you ever used any other name?',
      `Yes - ${otherNames
        .map((n) =>
          joinParts(
            [text(n.family_name), text(n.given_name)]
              .filter(Boolean)
              .join(' ') || text(n.name ?? n.full_name),
            n.kind,
          ),
        )
        .join('; ')}`,
    );
  } else if (hasOther === true) {
    note(PD, '4. Have you ever used any other name?', 'Yes');
    missing.push(`${PD}: 4. Other names used (family and given names)`);
  } else if (hasOther === false) {
    note(PD, '4. Have you ever used any other name?', 'No');
  } else missing.push(`${PD}: 4. Have you ever used any other name?`);
  add(PD, '5. Sex', get('sex'));
  add(PD, '6. Date of birth (YYYY-MM-DD)', get('date_of_birth'));
  add(PD, '7. Place of birth: city/town', get('city_of_birth'));
  add(PD, '7. Place of birth: country or territory', get('country_of_birth'));
  const citizenship = get('nationality');
  add(PD, '8. Citizenship', citizenship);

  const residence = get('country_of_residence');
  add(PD, '9. Current country or territory of residence', residence);
  // "Citizen" only for a sole citizen living in their citizenship country.
  const otherCits = raw(p, 'other_citizenships');
  const soleCitizen =
    yesNo(p, 'multiple_citizenship') !== true &&
    !(Array.isArray(otherCits)
      ? otherCits.length
      : text(otherCits) && intakeAnswerIsYes(otherCits) !== false);
  const status =
    fact(p, 'residence_status') ??
    (soleCitizen &&
    residence &&
    citizenship &&
    residence.toLowerCase() === citizenship.toLowerCase()
      ? 'Citizen'
      : undefined);
  add(PD, '9. Status in that country', status);
  const since = fact(p, 'residence_since');
  add(
    PD,
    '9. From (YYYY-MM-DD)',
    since && /birth/i.test(since) ? (get('date_of_birth') ?? since) : since,
  );
  if (residence) note(PD, '9. To', 'Present');

  const prevRaw = raw(p, 'previous_countries_of_residence');
  const prevRows = records(prevRaw);
  const prevNone =
    (Array.isArray(prevRaw) && prevRaw.length === 0) ||
    intakeAnswerIsYes(prevRaw) === false;
  const Q10 =
    '10. Previous countries of residence (past 5 years, more than 6 months)';
  if (prevRows.length) {
    prevRows.forEach((r, i) =>
      note(
        PD,
        `${Q10} - ${i + 1}`,
        joinParts(
          r.country,
          r.status && `status: ${text(r.status)}`,
          (r.from || r.to) && `${text(r.from) ?? '?'} to ${text(r.to) ?? '?'}`,
        ),
      ),
    );
  } else if (prevNone) note(PD, Q10, 'None');
  else add(PD, Q10, listText(prevRaw));

  add(
    PD,
    '11. Country or territory where applying',
    fact(p, 'applying_from_country'),
  );

  const marital = get('marital_status');
  add(PD, '12a. Current marital status', marital);
  const partnered =
    !!marital &&
    /married|common/i.test(marital) &&
    !/never|un-?married/i.test(marital);
  if (partnered) {
    add(
      PD,
      '12b. Date of marriage or start of common-law relationship (YYYY-MM-DD)',
      get('marriage_date'),
    );
    add(
      PD,
      "12c. Spouse's or common-law partner's family and given names",
      fact(p, 'spouse_name'),
    );
  }
  const prevRels = records(raw(p, 'previous_relationships'));
  const prevMarried =
    yesNo(p, 'previously_married') ??
    // Separated is still married: only a marriage that ended answers it.
    (prevRels.length || (marital && /divorc|widow|annul/i.test(marital))
      ? true
      : undefined);
  const Q13 =
    '13. Have you previously been married or in a common-law relationship?';
  if (prevMarried === undefined) missing.push(`${PD}: ${Q13}`);
  else if (!prevMarried) note(PD, Q13, 'No');
  else if (prevRels.length)
    note(
      PD,
      Q13,
      `Yes - ${prevRels
        .map((r) =>
          joinParts(
            r.name,
            r.date_of_birth,
            r.type,
            (r.from || r.to) &&
              `${text(r.from) ?? '?'} to ${text(r.to) ?? '?'}`,
          ),
        )
        .join('; ')}`,
    );
  else {
    note(PD, Q13, 'Yes');
    missing.push(
      `${PD}: 13. Previous spouse or partner: name, date of birth, type of relationship, from and to`,
    );
  }

  // ── Languages ────────────────────────────────────────────────────────────
  const L = 'Languages';
  add(L, 'a. Native language/mother tongue', fact(p, 'native_language'));
  const ability = fact(p, 'official_language_ability');
  add(L, 'b. Are you able to communicate in English and/or French?', ability);
  if (ability && /both/i.test(ability)) {
    add(
      L,
      'c. In which language are you most at ease?',
      lang && /^(english|french)$/i.test(lang) ? lang : undefined,
    );
  }
  const testRaw = fact(p, 'language_test_type');
  const testNo =
    !!testRaw &&
    (intakeAnswerIsYes(testRaw) === false || /^(no|none)\b/i.test(testRaw));
  const testType = testNo ? undefined : testRaw;
  const tookTest =
    yesNo(p, 'language_test_taken') ??
    (testNo ? false : testType ? true : undefined);
  const QT =
    'd. Have you taken a test from a designated testing organization to assess your English or French?';
  if (tookTest === undefined) missing.push(`${L}: ${QT}`);
  else note(L, QT, tookTest && testType ? `Yes - ${testType}` : yn(tookTest));

  // ── Passport ─────────────────────────────────────────────────────────────
  const PP = 'Passport';
  add(PP, 'Passport number', get('passport_number'));
  add(PP, 'Country or territory of issue', get('passport_country'));
  add(PP, 'Issue date (YYYY-MM-DD)', get('passport_issue_date'));
  add(PP, 'Expiry date (YYYY-MM-DD)', get('passport_expiry_date'));

  // ── National identity document ───────────────────────────────────────────
  const NI = 'National identity document';
  const idNumber = get('national_id_number');
  const hasId = idNumber ? true : yesNo(p, 'has_national_id');
  const QN = 'Do you have a national identity document?';
  if (hasId === undefined) missing.push(`${NI}: ${QN}`);
  else {
    note(NI, QN, yn(hasId));
    if (hasId) {
      add(NI, 'Document number', idNumber);
      add(NI, 'Country or territory of issue', fact(p, 'national_id_country'));
      add(NI, 'Issue date (YYYY-MM-DD)', fact(p, 'national_id_issue_date'));
      add(NI, 'Expiry date (YYYY-MM-DD)', fact(p, 'national_id_expiry_date'));
    }
  }

  // ── US PR card ───────────────────────────────────────────────────────────
  const US = 'US permanent resident card';
  const usPr = yesNo(p, 'us_permanent_resident');
  const QU =
    'Are you a lawful permanent resident of the United States with a valid alien registration card (green card)?';
  if (usPr === undefined) missing.push(`${US}: ${QU}`);
  else {
    note(US, QU, yn(usPr));
    if (usPr) {
      add(US, 'Document number', fact(p, 'us_pr_card_number'));
      add(US, 'Expiry date (YYYY-MM-DD)', fact(p, 'us_pr_card_expiry_date'));
    }
  }

  // ── Contact information ──────────────────────────────────────────────────
  const C = 'Contact information';
  const home = listText(raw(p, 'residential_address'));
  const sameMail = yesNo(p, 'mailing_same_as_residential');
  add(
    C,
    '1. Current mailing address',
    listText(raw(p, 'mailing_address')) ??
      (sameMail === true ? home : undefined),
  );
  add(
    C,
    '2. Residential address',
    sameMail === true && home ? `Same as mailing address (${home})` : home,
  );
  add(C, '3. Telephone number', get('phone_number'));
  add(C, '5. Email address', get('email'));

  // ── Details of intended study in Canada ──────────────────────────────────
  const S = 'Details of intended study in Canada';
  add(S, '1. Name of school', fact(p, 'study_school_name'));
  add(S, '2. Level of study', fact(p, 'study_level'));
  add(S, '3. Field of study', fact(p, 'study_field'));
  add(S, '4. Province or territory', fact(p, 'study_province'));
  add(S, '4. City/town', fact(p, 'study_city'));
  add(S, '4. Address of the school', fact(p, 'school_address'));
  add(
    S,
    '5. Designated learning institution number (DLI #)',
    fact(p, 'dli_number'),
  );
  const studentId = fact(p, 'student_id_number');
  note(
    S,
    '6. Student ID (if applicable)',
    studentId && intakeAnswerIsYes(studentId) !== false
      ? studentId
      : 'None - leave blank',
  );
  add(
    S,
    '7. Duration of expected study: from (YYYY-MM-DD)',
    fact(p, 'study_start_date'),
  );
  add(
    S,
    '7. Duration of expected study: to (YYYY-MM-DD)',
    fact(p, 'study_end_date'),
  );
  add(S, '8. Cost of studies: tuition', money(fact(p, 'tuition_cad')));
  add(
    S,
    '8. Cost of studies: room and board',
    money(fact(p, 'room_and_board_cad')),
  );
  const other = fact(p, 'other_costs_cad');
  note(
    S,
    '8. Cost of studies: other',
    money(other) ?? 'None - leave blank unless you have other costs',
  );
  add(
    S,
    '9. Funds available for my stay (CAD)',
    money(fact(p, 'study_funds_available_cad')),
  );
  add(
    S,
    '10. My expenses in Canada will be paid by',
    fact(p, 'study_expenses_paid_by'),
  );
  // The e-application asks the PAL/TAL (or CAQ in Quebec) beside the study.
  const pal = raw(p, 'has_attestation_letter');
  const palNumber = fact(p, 'attestation_letter_number');
  if (palNumber)
    note(
      S,
      'Provincial or territorial attestation letter (PAL/TAL) number',
      palNumber,
    );
  else if (/^\s*(yes|true)\b/i.test(text(pal) ?? (pal === true ? 'yes' : '')))
    missing.push(
      `${S}: Provincial or territorial attestation letter (PAL/TAL) number`,
    );
  else if (text(pal))
    note(
      S,
      'Provincial or territorial attestation letter (PAL/TAL)',
      text(pal)!,
    );
  const caq = fact(p, 'caq_number');
  const province = fact(p, 'study_province') ?? '';
  if (caq) note(S, 'Quebec acceptance certificate (CAQ) number', caq);
  else if (/qu[eé]bec|\bqc\b/i.test(province))
    missing.push(`${S}: Quebec acceptance certificate (CAQ) number`);

  // ── Education ────────────────────────────────────────────────────────────
  const E = 'Education';
  const schools = records(raw(p, 'education_history'));
  const QE =
    'Have you had any post-secondary education (including university, college or apprenticeship training)?';
  const postSec = schools.length
    ? true
    : yesNo(p, 'has_post_secondary_education');
  if (postSec === undefined) missing.push(`${E}: ${QE}`);
  else {
    note(E, QE, yn(postSec));
    if (postSec && !schools.length)
      missing.push(
        `${E}: Post-secondary schools (from, to, field, school, city, country)`,
      );
    schools.forEach((s, i) =>
      note(
        E,
        `School ${i + 1}`,
        joinParts(
          `${text(s.from) ?? '?'} to ${text(s.to) ?? '?'}`,
          s.field_of_study ?? s.field,
          s.level,
          s.school ?? s.name,
          s.city,
          s.country,
        ),
      ),
    );
  }

  // ── Employment ───────────────────────────────────────────────────────────
  const W = 'Employment (past 10 years)';
  const jobs = records(raw(p, 'work_history'));
  const title = fact(p, 'job_title');
  // Not via the employer_name spec: one of its aliases (school_name) can hold
  // the Canadian school on this route, which is not an employer.
  const studySchools = [fact(p, 'study_school_name'), text(p.dli_name)]
    .filter((x): x is string => !!x)
    .map((x) => x.toLowerCase());
  const employerRaw = [
    'employer_name',
    'employer',
    'company',
    'company_name',
    'current_employer_name',
  ]
    .map((k) => text(p[k]))
    .find(Boolean);
  const employer =
    employerRaw && !studySchools.includes(employerRaw.toLowerCase())
      ? employerRaw
      : undefined;
  const rows = jobs.map((j) =>
    joinParts(
      `${text(j.from) ?? '?'} to ${text(j.to) ?? 'present'}`,
      j.activity ?? j.occupation ?? j.job_title,
      j.employer,
      j.city,
      j.country,
    ),
  );
  // The current job, when the history does not already hold it.
  const current =
    title &&
    !jobs.some(
      (j) =>
        (employer &&
          text(j.employer)?.toLowerCase() === employer.toLowerCase()) ||
        /^(present|ongoing|current|now)$/i.test(text(j.to) ?? ''),
    );
  if (current)
    rows.unshift(
      joinParts(
        `${fact(p, 'employment_start_date') ?? '?'} to present`,
        title,
        employer,
      ),
    );
  if (rows.length)
    rows.forEach((r, i) =>
      note(
        W,
        `Period ${i + 1} (from, to, occupation, employer, city, country)`,
        r,
      ),
    );
  else
    missing.push(
      `${W}: Occupation, employer, city and country for each period, with no gaps`,
    );

  // ── Background information ───────────────────────────────────────────────
  const B = 'Background information';
  const declare = (
    label: string,
    answer: boolean | undefined,
    details: string | undefined,
  ) => {
    if (answer === undefined) {
      missing.push(`${B}: ${label}`);
      return;
    }
    if (!answer) {
      note(B, label, 'No');
      return;
    }
    note(B, label, details ? `Yes - ${details}` : 'Yes');
    if (!details) missing.push(`${B}: ${label.split(' ')[0]} details`);
  };
  declare(
    '1a. Within the past two years, have you or a family member ever had tuberculosis of the lungs or been in close contact with a person with tuberculosis?',
    // The form also asks whether you or a family member had TB: "No" needs
    // both answers to be an explicit no.
    yesNo(p, 'tuberculosis_contact') === true ||
      yesNo(p, 'tuberculosis') === true
      ? true
      : yesNo(p, 'tuberculosis_contact') === false &&
          yesNo(p, 'tuberculosis') === false
        ? false
        : undefined,
    fact(p, 'tuberculosis_contact_details'),
  );
  declare(
    '1b. Do you have any physical or mental disorder that would require social and/or health services, other than medication, during a stay in Canada?',
    yesNo(p, 'health_services_disorder'),
    fact(p, 'health_services_disorder_details'),
  );
  declare(
    '2a. Have you ever remained beyond the validity of your status, attended school without authorization or worked without authorization in Canada?',
    yesNo(p, 'immigration_violations'),
    fact(p, 'immigration_violations_details'),
  );
  declare(
    '2b. Have you ever been refused a visa or permit, denied entry or ordered to leave Canada or any other country or territory?',
    yesNo(p, 'refused_or_ordered_to_leave'),
    listText(raw(p, 'refusal_details')),
  );
  const applied =
    intakeAnswerIsYes(prevApplied) ??
    (looksLikeIrccNumber(prevApplied) ? true : undefined);
  declare(
    '2c. Have you previously applied to enter or remain in Canada?',
    applied,
    applied ? (uci ? `UCI or previous file ${uci}` : undefined) : undefined,
  );
  // Q3 also covers arrests, charges and convictions: any "yes" makes it yes.
  const crimeKeys = [
    'committed_crime',
    'ever_arrested',
    'ever_charged',
    'ever_convicted',
  ];
  // "No" only when every one of the four is an explicit no; the study
  // interview asks only committed_crime, so it is usually listed as missing.
  const crime = crimeKeys.some((k) => yesNo(p, k) === true)
    ? true
    : crimeKeys.every((k) => yesNo(p, k) === false)
      ? false
      : undefined;
  declare(
    '3. Have you ever committed, been arrested for, been charged with or convicted of any criminal offence in any country or territory?',
    crime,
    [
      fact(p, 'committed_crime_details'),
      fact(p, 'ever_arrested_details'),
      fact(p, 'ever_charged_details'),
      fact(p, 'ever_convicted_details'),
    ]
      .filter(Boolean)
      .join('; ') || undefined,
  );
  declare(
    '4. Did you serve in any military, militia, or civil defence unit or serve in a security organization or police force (including non obligatory national service, reserve or volunteer units)?',
    yesNo(p, 'military_service'),
    listText(raw(p, 'military_service_history')),
  );
  declare(
    '5. Are you, or have you ever been a member or associated with any political party, or other group or organization which has engaged in or advocated violence as a means to achieving a political or religious objective, or which has been associated with criminal activity at any time?',
    yesNo(p, 'violent_organization_member'),
    fact(p, 'violent_organization_member_details'),
  );
  declare(
    '6. Have you ever witnessed or participated in the ill treatment of prisoners or civilians, looting or desecration of religious buildings?',
    yesNo(p, 'ill_treatment'),
    fact(p, 'ill_treatment_details'),
  );

  // ── Signature — never filled ─────────────────────────────────────────────
  note(
    'Signature',
    'Signature and date',
    'Leave blank here - the applicant signs and dates the official form themselves',
  );

  return { lines, missing };
}

// ── PDF ───────────────────────────────────────────────────────────────────
const MARGIN = 50;
const PW = 612;
const PH = 792;

/** Latin-only Helvetica: drop what WinAnsi cannot encode instead of throwing. */
function safe(s: string): string {
  return normalizePunct(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

/** A token wider than the line (an email, a URL) split into pieces that fit. */
function splitLong(
  word: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  if (font.widthOfTextAtSize(word, size) <= width) return [word];
  const out: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && font.widthOfTextAtSize(piece + ch, size) > width) {
      out.push(piece);
      piece = ch;
    } else piece += ch;
  }
  if (piece) out.push(piece);
  return out;
}

function wrap(s: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  const words = safe(s)
    .split(/\s+/)
    .flatMap((w) => splitLong(w, font, size, width));
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

export async function renderImm1294Sheet(
  answers: Imm1294Answers,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([PW, PH]);
  let y = PH - MARGIN;
  const need = (h: number) => {
    if (y - h < MARGIN) {
      page = pdf.addPage([PW, PH]);
      y = PH - MARGIN;
    }
  };
  const para = (
    s: string,
    font: PDFFont,
    size: number,
    x = MARGIN,
    color = rgb(0, 0, 0),
  ) => {
    for (const l of wrap(s, font, size, PW - MARGIN - x)) {
      need(size + 4);
      page.drawText(l, { x, y, size, font, color });
      y -= size + 4;
    }
  };

  para(
    'IMM 1294 - Application for Study Permit Made Outside of Canada',
    bold,
    15,
  );
  para('Answers prepared by VisaAI from your application', regular, 11);
  y -= 4;
  para(
    'This sheet is not the official form. IMM 1294 is applied for in your IRCC secure account: download IMM 1294 from your account document checklist, open it in Adobe Reader, copy these answers onto it, click Validate, then upload it to your application.',
    regular,
    9,
    MARGIN,
    rgb(0.35, 0.35, 0.35),
  );
  y -= 10;

  let section = '';
  for (const line of answers.lines) {
    if (line.section !== section) {
      section = line.section;
      y -= 6;
      need(30);
      para(section, bold, 12);
      page.drawLine({
        start: { x: MARGIN, y: y + 2 },
        end: { x: PW - MARGIN, y: y + 2 },
        thickness: 0.5,
      });
      y -= 4;
    }
    need(28);
    para(line.label, bold, 9, MARGIN, rgb(0.3, 0.3, 0.3));
    para(line.value, regular, 11, MARGIN + 10);
    y -= 2;
  }

  if (answers.missing.length) {
    y -= 8;
    para(
      'Not in your VisaAI application - fill these in by hand',
      bold,
      12,
      MARGIN,
      rgb(0.71, 0.19, 0.19),
    );
    for (const m of answers.missing) para(`- ${m}`, regular, 10, MARGIN + 10);
  }
  return pdf.save();
}

/** Form renderer for the registry: the IMM 1294 answer sheet. */
export async function renderImm1294(
  payload: unknown,
  ctx?: { profile?: Profile },
): Promise<Uint8Array | null> {
  const answers = imm1294Answers(
    ctx?.profile ?? {},
    payload as PrefilledFormPayload | null,
  );
  return renderImm1294Sheet(answers);
}
