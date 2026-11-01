/**
 * Per-document-type extraction schemas.
 *
 * The OCR layer used to extract ONE fixed set of ten passport/bank keys from
 * every upload, so an admission letter, a birth certificate or a property deed
 * yielded nothing the applicant could be spared from re-typing. This module is
 * the single source of truth for "what is worth reading out of THIS kind of
 * document", and it is consumed in two places:
 *
 *   - `openai-ocr.provider` — builds its extraction prompt from the spec, so a
 *     provider that does structured extraction in one call gets the right keys.
 *   - `derive-fields` (graph node) — a vendor-agnostic second pass over the raw
 *     OCR text, so providers whose structured output is identity-only (Azure's
 *     `prebuilt-idDocument`) still fill the non-identity keys.
 *
 * Keys are snake_case because `prefill` maps them straight onto portal form
 * selectors. Values stay in the document's own language/script — these are
 * names, dates and numbers going into a government form, never user prose.
 */

export interface ExtractionField {
  key: string;
  /** Short instruction for the model. Kept terse — it goes into a prompt. */
  hint: string;
  type: 'string' | 'number' | 'date';
}

/**
 * Fields attempted on EVERY document — deliberately only the two that any
 * document about a person actually carries. They also feed duplicate detection
 * (`document_type|id|name|dob`).
 *
 * MEASURED 2026-08-16: this set used to include nationality, issue_date and
 * expiry_date. Asked for `nationality` on a synthetic bank statement, Azure
 * answered "CANADA" — inferred from the bank's name, printed nowhere on the
 * page as the holder's nationality. A fabricated nationality on a visa
 * application is precisely the failure this product cannot ship, and the cause
 * was asking a financial document a question it cannot answer.
 *
 * The rule that follows: a field belongs to a type only when that KIND of
 * document actually prints it. Anything else is an invitation to infer, and an
 * extractor asked to infer will oblige.
 */
const COMMON_FIELDS: ExtractionField[] = [
  {
    key: 'full_name',
    hint: 'full name of the person the document is about',
    type: 'string',
  },
  { key: 'date_of_birth', hint: 'date of birth', type: 'date' },
];

/** Identity fields, only for the documents that actually print them. */
const NATIONALITY: ExtractionField = {
  key: 'nationality',
  hint: 'nationality or citizenship',
  type: 'string',
};
const ISSUE_DATE: ExtractionField = {
  key: 'issue_date',
  hint: 'date the document was issued',
  type: 'date',
};
const EXPIRY_DATE: ExtractionField = {
  key: 'expiry_date',
  hint: 'date the document expires or is valid until',
  type: 'date',
};

/**
 * Type-specific fields, keyed by the canonical `documents.document_type`.
 * Prefix-matched (see `resolveExtractionType`) so discovery names like
 * `bank_statement_3mo` or `sponsor_employment_letter` resolve to their base.
 */
const TYPE_FIELDS: Record<string, ExtractionField[]> = {
  passport: [
    {
      key: 'passport_number',
      hint: 'passport / travel document number',
      type: 'string',
    },
    {
      key: 'given_name',
      hint: 'given (first) name exactly as printed',
      type: 'string',
    },
    {
      key: 'family_name',
      hint: 'family (last) name exactly as printed',
      type: 'string',
    },
    { key: 'sex', hint: 'sex or gender as printed (M/F/X)', type: 'string' },
    {
      key: 'place_of_birth',
      hint: 'place of birth as printed',
      type: 'string',
    },
    {
      key: 'issuing_authority',
      hint: 'issuing authority or country of issue',
      type: 'string',
    },
    NATIONALITY,
    ISSUE_DATE,
    EXPIRY_DATE,
  ],

  // National identity card (Pakistan CNIC / NICOP and the like). Its own
  // schema rather than an alias of `passport`: a card has an identity number,
  // not a passport number, and asking for `passport_number` filed the CNIC
  // under it (#34). No nationality — a CNIC prints "Country of Stay", which is
  // residence, not citizenship.
  national_id: [
    {
      key: 'national_id_number',
      hint: 'national identity number as printed (e.g. Pakistan CNIC 12345-1234567-1)',
      type: 'string',
    },
    {
      key: 'given_name',
      hint: 'given (first) name exactly as printed',
      type: 'string',
    },
    {
      key: 'family_name',
      hint: 'family (last) name exactly as printed',
      type: 'string',
    },
    { key: 'sex', hint: 'sex or gender as printed (M/F/X)', type: 'string' },
    ISSUE_DATE,
    EXPIRY_DATE,
  ],

  bank_statement: [
    { key: 'account_holder_name', hint: 'name on the account', type: 'string' },
    {
      key: 'bank_name',
      hint: 'name of the bank or financial institution',
      type: 'string',
    },
    {
      key: 'account_number',
      hint: 'account number as printed (may be masked)',
      type: 'string',
    },
    {
      key: 'account_balance',
      hint: 'closing / current balance as a number',
      type: 'number',
    },
    {
      key: 'currency',
      hint: 'ISO currency code of the balance',
      type: 'string',
    },
    {
      key: 'statement_period_start',
      hint: 'first day of the statement period',
      type: 'date',
    },
    {
      key: 'statement_period_end',
      hint: 'last day of the statement period',
      type: 'date',
    },
    {
      key: 'average_monthly_balance',
      hint: 'average balance over the period, if stated',
      type: 'number',
    },
  ],

  proof_of_funds: [
    { key: 'account_holder_name', hint: 'name on the account', type: 'string' },
    {
      key: 'bank_name',
      hint: 'name of the bank or financial institution',
      type: 'string',
    },
    {
      key: 'account_balance',
      hint: 'balance / amount held as a number',
      type: 'number',
    },
    {
      key: 'currency',
      hint: 'ISO currency code of the amount',
      type: 'string',
    },
  ],

  admission_letter: [
    {
      key: 'institution_name',
      hint: 'name of the school / college / university',
      type: 'string',
    },
    {
      key: 'institution_address',
      hint: 'full address of the institution',
      type: 'string',
    },
    {
      key: 'institution_id',
      hint: 'designated learning institution or registration number',
      type: 'string',
    },
    {
      key: 'program_name',
      hint: 'name of the program / course of study',
      type: 'string',
    },
    {
      key: 'program_level',
      hint: 'level of study (e.g. bachelor, master, diploma)',
      type: 'string',
    },
    { key: 'program_start_date', hint: 'program start date', type: 'date' },
    {
      key: 'program_end_date',
      hint: 'program end / expected completion date',
      type: 'date',
    },
    {
      key: 'tuition_amount',
      hint: 'tuition fee for the program as a number',
      type: 'number',
    },
    {
      key: 'tuition_currency',
      hint: 'ISO currency code of the tuition fee',
      type: 'string',
    },
    {
      key: 'student_id',
      hint: 'student number assigned by the institution',
      type: 'string',
    },
    {
      key: 'scholarship_amount',
      hint: 'scholarship / funding awarded as a number',
      type: 'number',
    },
  ],

  // Birth certificate: usually a CHILD's, uploaded for the family section.
  // `full_name` / `date_of_birth` (common) are the child's. Parents' names are
  // asked for because they are how sync_profile decides whose child it is.
  // Country of birth is NOT asked for: most certificates print only a city or
  // district, and asking invites inference — civil-records.ts infers it
  // deterministically from the issuing registry instead.
  birth_certificate: [
    {
      key: 'place_of_birth',
      hint: 'city, town or district of birth exactly as printed',
      type: 'string',
    },
    { key: 'father_name', hint: "father's full name", type: 'string' },
    { key: 'mother_name', hint: "mother's full name", type: 'string' },
    {
      key: 'registration_number',
      hint: 'civil registration / certificate number',
      type: 'string',
    },
    {
      key: 'registration_date',
      hint: 'date the birth was registered',
      type: 'date',
    },
    {
      key: 'sex',
      hint: 'sex or gender of the child as printed',
      type: 'string',
    },
    NATIONALITY,
  ],

  // Marriage certificate / nikah nama. The date hint names the line to read:
  // a nikah nama carries handwritten Urdu dates beside the typed English form,
  // and prod 2026-10-15 stored the wrong one.
  marriage_certificate: [
    {
      key: 'marriage_date',
      hint: 'date the marriage was solemnized / celebrated, from the printed line labelled e.g. "The date when the marriage was solemnized" or "Date of marriage" — not an issue, stamp or handwritten margin date',
      type: 'date',
    },
    {
      key: 'bridegroom_name',
      hint: "husband's / bridegroom's own name, without his father's name",
      type: 'string',
    },
    {
      key: 'bride_name',
      hint: "wife's / bride's own name, without her father's name",
      type: 'string',
    },
    { key: 'spouse_name', hint: "spouse's full name", type: 'string' },
    {
      key: 'place_of_marriage',
      hint: 'place (city and country) of marriage',
      type: 'string',
    },
    {
      key: 'registration_number',
      hint: 'marriage registration / certificate number',
      type: 'string',
    },
  ],

  property_document: [
    {
      key: 'property_address',
      hint: 'full address of the property',
      type: 'string',
    },
    {
      key: 'property_type',
      hint: 'kind of property (e.g. house, apartment, land)',
      type: 'string',
    },
    {
      key: 'property_owner_name',
      hint: 'registered owner name',
      type: 'string',
    },
    {
      key: 'property_value',
      hint: 'assessed or declared value as a number',
      type: 'number',
    },
    {
      key: 'property_currency',
      hint: 'ISO currency code of the value',
      type: 'string',
    },
    {
      key: 'title_number',
      hint: 'title / deed / registration number',
      type: 'string',
    },
    {
      key: 'ownership_type',
      hint: 'ownership form (e.g. sole, joint, leasehold)',
      type: 'string',
    },
  ],

  employment_letter: [
    { key: 'employer', hint: 'employer / company name', type: 'string' },
    {
      key: 'employer_address',
      hint: 'full address of the employer',
      type: 'string',
    },
    { key: 'job_title', hint: 'job title or position held', type: 'string' },
    {
      key: 'employment_start_date',
      hint: 'date employment started',
      type: 'date',
    },
    { key: 'annual_income', hint: 'annual salary as a number', type: 'number' },
    {
      key: 'monthly_income',
      hint: 'monthly salary as a number',
      type: 'number',
    },
    {
      key: 'currency',
      hint: 'ISO currency code of the salary',
      type: 'string',
    },
    {
      key: 'employment_type',
      hint: 'employment type (e.g. permanent, contract)',
      type: 'string',
    },
    {
      key: 'leave_approved_from',
      hint: 'start of approved leave, if stated',
      type: 'date',
    },
    {
      key: 'leave_approved_to',
      hint: 'end of approved leave, if stated',
      type: 'date',
    },
  ],

  // A job offer, offer of employment or LMIA for work IN THE DESTINATION
  // country. Its own keys: the employment letter's are the CURRENT job, and
  // `job_offer_letter` used to resolve to the admission letter through
  // `offer_letter` — a work permit's job offer became institution_name /
  // program_start_date / tuition_amount (the wage) on the profile (live E2E
  // 2026-10-30).
  job_offer: [
    {
      key: 'offered_employer_name',
      hint: 'name of the employer making the job offer',
      type: 'string',
    },
    {
      key: 'offered_employer_address',
      hint: 'full address of that employer',
      type: 'string',
    },
    {
      key: 'offered_job_title',
      hint: 'job title or position offered',
      type: 'string',
    },
    {
      key: 'offered_noc_code',
      hint: 'NOC / occupation code of the offered job, if printed',
      type: 'string',
    },
    {
      key: 'offered_wage',
      hint: 'wage or salary offered as a number',
      type: 'number',
    },
    {
      key: 'offered_wage_period',
      hint: 'period of that wage (hour, week, month, year)',
      type: 'string',
    },
    {
      key: 'offered_currency',
      hint: 'ISO currency code of the wage',
      type: 'string',
    },
    {
      key: 'offered_start_date',
      hint: 'start date of the offered employment',
      type: 'date',
    },
    {
      key: 'offered_end_date',
      hint: 'end date of the offered employment, if stated',
      type: 'date',
    },
    {
      key: 'lmia_number',
      hint: 'Labour Market Impact Assessment (LMIA) number, if printed',
      type: 'string',
    },
    {
      key: 'offer_of_employment_number',
      hint: 'offer of employment number (the letter A and 7 digits), if printed',
      type: 'string',
    },
  ],

  pay_stubs: [
    { key: 'employer', hint: 'employer / company name', type: 'string' },
    {
      key: 'monthly_income',
      hint: 'gross pay for the period as a number',
      type: 'number',
    },
    {
      key: 'net_income',
      hint: 'net (take-home) pay as a number',
      type: 'number',
    },
    { key: 'currency', hint: 'ISO currency code of the pay', type: 'string' },
    {
      key: 'pay_period_start',
      hint: 'first day of the pay period',
      type: 'date',
    },
    { key: 'pay_period_end', hint: 'last day of the pay period', type: 'date' },
  ],

  tax_return: [
    { key: 'tax_year', hint: 'tax year the return covers', type: 'string' },
    {
      key: 'annual_income',
      hint: 'total / assessed income as a number',
      type: 'number',
    },
    {
      key: 'tax_paid',
      hint: 'total tax assessed or paid as a number',
      type: 'number',
    },
    {
      key: 'currency',
      hint: 'ISO currency code of the amounts',
      type: 'string',
    },
    {
      key: 'taxpayer_id',
      hint: 'taxpayer identification number',
      type: 'string',
    },
  ],

  noa: [
    { key: 'tax_year', hint: 'tax year the notice covers', type: 'string' },
    {
      key: 'annual_income',
      hint: 'total / assessed income as a number',
      type: 'number',
    },
    {
      key: 'currency',
      hint: 'ISO currency code of the amounts',
      type: 'string',
    },
    {
      key: 'taxpayer_id',
      hint: 'taxpayer identification number',
      type: 'string',
    },
  ],

  invitation_letter: [
    {
      key: 'host_name',
      hint: 'full name of the host inviting the applicant',
      type: 'string',
    },
    { key: 'host_address', hint: 'full address of the host', type: 'string' },
    {
      key: 'host_status',
      hint: "host's immigration status in the destination",
      type: 'string',
    },
    {
      key: 'host_relationship',
      hint: 'relationship between host and applicant',
      type: 'string',
    },
    {
      key: 'visit_start_date',
      hint: 'intended start of the visit',
      type: 'date',
    },
    { key: 'visit_end_date', hint: 'intended end of the visit', type: 'date' },
    // A business visitor's letter comes from a company, not a person: these
    // are null on a family letter.
    {
      key: 'organization_name',
      hint: 'name of the company or organization inviting the applicant, if the letter is from one',
      type: 'string',
    },
    {
      key: 'contact_name',
      hint: 'full name of the contact person who signs for that company or organization',
      type: 'string',
    },
    {
      key: 'contact_phone',
      hint: "contact person's telephone number",
      type: 'string',
    },
    {
      key: 'contact_email',
      hint: "contact person's email address",
      type: 'string',
    },
    {
      key: 'organization_address',
      hint: 'full address of the company or organization, with postal code',
      type: 'string',
    },
    {
      key: 'event_code',
      hint: 'IRCC event code for a conference, convention or trade fair, if stated',
      type: 'string',
    },
  ],

  travel_itinerary: [
    { key: 'departure_date', hint: 'outbound departure date', type: 'date' },
    { key: 'return_date', hint: 'return / final arrival date', type: 'date' },
    {
      key: 'departure_city',
      hint: 'city or airport of departure',
      type: 'string',
    },
    {
      key: 'destination_city',
      hint: 'main destination city or airport',
      type: 'string',
    },
    {
      key: 'booking_reference',
      hint: 'booking / reservation reference',
      type: 'string',
    },
    { key: 'carrier', hint: 'airline or carrier name', type: 'string' },
  ],

  hotel_booking: [
    {
      key: 'accommodation_name',
      hint: 'name of the hotel or accommodation',
      type: 'string',
    },
    {
      key: 'accommodation_address',
      hint: 'full address of the accommodation',
      type: 'string',
    },
    { key: 'check_in_date', hint: 'check-in date', type: 'date' },
    { key: 'check_out_date', hint: 'check-out date', type: 'date' },
    {
      key: 'booking_reference',
      hint: 'booking / reservation reference',
      type: 'string',
    },
  ],

  police_clearance: [
    {
      key: 'issuing_authority',
      hint: 'police force or authority that issued it',
      type: 'string',
    },
    {
      key: 'certificate_number',
      hint: 'certificate / reference number',
      type: 'string',
    },
    {
      key: 'clearance_result',
      hint: 'stated result (e.g. no record found)',
      type: 'string',
    },
    ISSUE_DATE,
    EXPIRY_DATE,
  ],

  medical_exam: [
    {
      key: 'examining_physician',
      hint: 'name of the panel physician or clinic',
      type: 'string',
    },
    { key: 'exam_date', hint: 'date of the medical examination', type: 'date' },
    {
      key: 'medical_reference',
      hint: 'medical / IME reference number',
      type: 'string',
    },
    EXPIRY_DATE,
  ],

  medical_insurance: [
    {
      key: 'insurer_name',
      hint: 'name of the insurance provider',
      type: 'string',
    },
    { key: 'policy_number', hint: 'policy number', type: 'string' },
    {
      key: 'coverage_amount',
      hint: 'coverage / sum insured as a number',
      type: 'number',
    },
    {
      key: 'currency',
      hint: 'ISO currency code of the coverage',
      type: 'string',
    },
    { key: 'coverage_start_date', hint: 'first day of cover', type: 'date' },
    { key: 'coverage_end_date', hint: 'last day of cover', type: 'date' },
    EXPIRY_DATE,
  ],
};

/**
 * Type names that mean the same document under a different label. The intake
 * checklist, the portal upload map and the filename fallback do not share one
 * vocabulary (`property_deed` vs `property_document`, `police_certificate` vs
 * `police_clearance`), and a document whose alias is unmapped silently loses
 * its whole schema.
 */
const TYPE_ALIASES: Record<string, string> = {
  property_deed: 'property_document',
  land_ownership: 'property_document',
  title_deed: 'property_document',
  police_certificate: 'police_clearance',
  police_certificates: 'police_clearance',
  medical: 'medical_exam',
  i20: 'admission_letter',
  loa: 'admission_letter',
  offer_letter: 'admission_letter',
  // Work, not study (exact aliases win over the `offer_letter` suffix match).
  job_offer_letter: 'job_offer',
  lmia: 'job_offer',
  lmia_and_employment_contract: 'job_offer',
  employment_contract_lmia_exempt: 'job_offer',
  lmia_or_offer_of_employment_number: 'job_offer',
  proof_of_funds_bank: 'bank_statement',
  passport_biographic_page: 'passport',
  id_card: 'national_id',
  birth_registration_certificate: 'birth_certificate',
  nikah_nama: 'marriage_certificate',
  nikahnama: 'marriage_certificate',
  identity_card: 'national_id',
  national_identity_card: 'national_id',
  cnic: 'national_id',
  nicop: 'national_id',
  // Insurance under any name is the policy, never the exam (#33): `medical`
  // alone means the exam, so every insurance spelling is pinned here.
  insurance: 'medical_insurance',
  health_insurance: 'medical_insurance',
  travel_insurance: 'medical_insurance',
  travel_health_insurance: 'medical_insurance',
  travel_medical_insurance: 'medical_insurance',
};

/**
 * A photograph slot — `photo`, `passport_photo(s)`, `digital_photo`,
 * `applicant_photo`. Prod 2026-10-24: a study-permit `passport_photos` upload
 * prefix-matched `passport`, so the photo was graded as a passport with no
 * fields (identity fail) and no readable expiry (expiry warn), and its slot
 * never reached verified.
 *
 * Whole tokens only, and never a type that also names an identity document
 * or a copy: `passport_photo_page` is the bio page, `photo_id` / `photo_card` /
 * `cnic_photo` an ID, `photo_of_passport` a scan of one, `passport_photocopy`
 * and `passport_photo_copy` a copy. Those keep their passport / ID handling.
 * `photos_of_you_together` is still a photo.
 */
const PHOTO_TOKENS = new Set([
  'photo',
  'photos',
  'photograph',
  'photographs',
  'picture',
  'pictures',
]);
const IDENTITY_TOKENS = new Set([
  'page',
  'id',
  'ids',
  'cnic',
  'nic',
  'nicop',
  'licence',
  'license',
  'card',
  'identity',
  'identification',
  'copy',
  'copies',
  'stat',
]);

export function isPhotoDocumentType(
  documentType: string | undefined | null,
): boolean {
  const tokens = (documentType ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!tokens.some((t) => PHOTO_TOKENS.has(t))) return false;
  if (tokens.some((t) => IDENTITY_TOKENS.has(t))) return false;
  // `photo_of_passport`: a picture OF an identity document is that document.
  return !tokens.some(
    (t, i) =>
      PHOTO_TOKENS.has(t) &&
      tokens[i + 1] === 'of' &&
      (tokens[i + 2] === 'passport' || IDENTITY_TOKENS.has(tokens[i + 2])),
  );
}

/**
 * The applicant's own photograph — the one a visa form asks for — as opposed
 * to `wedding_photos`, `photos_together` or `sponsor_photo`. Only these fit
 * one another across names; any other photo slot takes only its own type.
 */
const APPLICANT_PHOTO =
  /^(?:(?:passport|digital|applicant)_)?photo(?:s|graphs?)?$/;

export function isApplicantPhotoType(
  documentType: string | undefined | null,
): boolean {
  return APPLICANT_PHOTO.test(
    (documentType ?? '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_'),
  );
}

/**
 * Longest-prefix resolution so discovery-generated types keep their schema:
 * `bank_statement_3mo` → `bank_statement`, `sponsor_employment_letter` →
 * `employment_letter`, `passport_biographic_page` → `passport`.
 *
 * Returns null for an unknown type, which means "common fields only" — never a
 * wrong schema, because prompting for admission-letter keys on a police
 * certificate is exactly how a model is invited to invent values.
 */
export function resolveExtractionType(
  documentType: string | undefined | null,
): string | null {
  if (!documentType) return null;
  const normalized = documentType.toLowerCase().trim();
  if (!normalized) return null;
  // A photo carries no fields; `passport_photo` is not a passport.
  if (isPhotoDocumentType(normalized)) return null;
  if (TYPE_FIELDS[normalized]) return normalized;
  if (TYPE_ALIASES[normalized]) return TYPE_ALIASES[normalized];

  let best: string | null = null;
  for (const candidate of [
    ...Object.keys(TYPE_FIELDS),
    ...Object.keys(TYPE_ALIASES),
  ]) {
    // Match `<candidate>_suffix` (bank_statement_3mo) or `prefix_<candidate>`
    // (sponsor_employment_letter) — never a bare substring, so `noa` does not
    // swallow an unrelated type that merely contains those letters.
    const matches =
      normalized.startsWith(`${candidate}_`) ||
      normalized.endsWith(`_${candidate}`) ||
      normalized.includes(`_${candidate}_`);
    if (matches && (!best || candidate.length > best.length)) best = candidate;
  }
  return best ? (TYPE_ALIASES[best] ?? best) : null;
}

/** Every field worth extracting from this document type (common + specific). */
export function extractionFieldsFor(
  documentType: string | undefined | null,
): ExtractionField[] {
  const resolved = resolveExtractionType(documentType);
  const specific = resolved ? TYPE_FIELDS[resolved] : [];
  const seen = new Set<string>();
  const out: ExtractionField[] = [];
  for (const field of [...COMMON_FIELDS, ...specific]) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
  }
  return out;
}

/**
 * Prompt fragment listing the keys for this document type. Shared verbatim by
 * the OpenAI provider and the derive-fields node so both ask for exactly the
 * same schema — a mismatch there would produce two competing key vocabularies
 * for the same document.
 */
export function extractionPromptFor(
  documentType: string | undefined | null,
): string {
  const fields = extractionFieldsFor(documentType);
  const resolved = resolveExtractionType(documentType);
  const lines = fields.map((f) => {
    const shape =
      f.type === 'date'
        ? ' (YYYY-MM-DD)'
        : f.type === 'number'
          ? ' (plain number, no symbols or separators)'
          : '';
    return `   - ${f.key}: ${f.hint}${shape}`;
  });
  const header = resolved
    ? `This document is a "${resolved}". Extract these keys when — and only when — the value is clearly present:`
    : 'Document type is unknown. Extract these keys when — and only when — the value is clearly present:';
  return `${header}\n${lines.join('\n')}`;
}

/** Exported for tests and for callers that need the full key vocabulary. */
export const KNOWN_EXTRACTION_TYPES = Object.keys(TYPE_FIELDS);

// ─── Azure Document Intelligence query fields ────────────────────────────────
//
// Azure's `queryFields` add-on (api-version 2024-11-30, on `prebuilt-layout`)
// extracts named fields IN REGION. That is what lets a bank statement, an
// admission letter or a deed be read without shipping the document text to a
// non-regional model — the same schema, a different execution site.
//
// Azure documents a hard cap of 20 query fields per request and recommends
// Pascal-case names for multi-word fields.

/** Azure's documented maximum number of query fields per analyze request. */
export const AZURE_QUERY_FIELD_LIMIT = 20;

/** `program_start_date` -> `ProgramStartDate`. */
export function toAzureFieldName(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * The Azure query-field request for a document type, plus the mapping needed to
 * put the answers back under our own snake_case keys.
 *
 * Type-specific fields come FIRST so that if a type ever exceeds Azure's cap it
 * is the generic identity fields that get dropped, not the ones that make this
 * document worth reading. The returned `byName` is built from the same list, so
 * a response can never be mapped onto a key we did not ask for.
 */
export function azureQueryFieldsFor(documentType: string | undefined | null): {
  names: string[];
  byName: Record<string, ExtractionField>;
} {
  const resolved = resolveExtractionType(documentType);
  const specific = resolved ? TYPE_FIELDS[resolved] : [];

  const ordered: ExtractionField[] = [];
  const seen = new Set<string>();
  for (const field of [...specific, ...COMMON_FIELDS]) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    ordered.push(field);
  }

  const capped = ordered.slice(0, AZURE_QUERY_FIELD_LIMIT);
  const byName: Record<string, ExtractionField> = {};
  for (const field of capped) byName[toAzureFieldName(field.key)] = field;

  return { names: capped.map((f) => toAzureFieldName(f.key)), byName };
}

/**
 * Document types Azure's purpose-built `prebuilt-idDocument` model reads better
 * — and more cheaply — than layout + query fields. Everything else routes to
 * query fields, because idDocument returns nothing at all for a bank statement
 * or an admission letter.
 */
const IDENTITY_TYPES = new Set(['passport', 'national_id']);

export function isIdentityDocumentType(
  documentType: string | undefined | null,
): boolean {
  const resolved = resolveExtractionType(documentType);
  return resolved !== null && IDENTITY_TYPES.has(resolved);
}
