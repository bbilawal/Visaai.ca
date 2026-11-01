/**
 * Content-based classification and identity-field hygiene for uploads.
 *
 * Pure (no I/O) so every rule is unit-tested; the graph node that applies it
 * lives in classify-document.node.ts.
 *
 * Dry run 2026-10-14 (Canada TRV, prod) — three uploads in the generic
 * "Additional document" slot produced false identity mismatches:
 *   - an IRCC refusal letter (IMM 5621): its letter date was read as a DOB,
 *     because the common extraction set asks every document for one;
 *   - the applicant's own CNIC: the extractor took the FATHER's name;
 *   - "Medical Insurance_compressed.pdf" was filed as a medical exam.
 */
import { birthDateCandidates, identityRole } from './identity-compare';
import {
  civilRecordKind,
  looksLikeBirthCertificate,
  looksLikeMarriageCertificate,
  parseBirthCertificates,
  parseCivilDate,
  parseMarriageCertificate,
  type BirthRecord,
} from '../../ocr/civil-records';
import { findByName } from '../../../shared/profile/family-members';

// ─── Classification ──────────────────────────────────────────────────────────

const CNIC_NUMBER = /\b\d{5}-\d{7}-\d\b/;
const RELATIVE_LABEL =
  /\b(?:father|husband|guardian)(?:'?s)?\s*name\b|\b[sdw]\s*\/\s*o\b/i;

/**
 * Best-guess `document_type` for an upload from its OCR text, or null when the
 * text is not recognisable. Only cheap, high-precision signals: a wrong type is
 * worse than none, because it changes which documents are cross-checked.
 * Ordered most-specific first.
 */
export function classifyDocumentText(
  text: string | null | undefined,
): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  // IRCC correspondence (refusal letters, procedural-fairness letters,
  // passport requests). Never an identity document, whatever it quotes.
  if (
    /immigration,? refugees and citizenship canada|\bIRCC\b|\bIMM ?5621\b/i.test(
      t,
    )
  ) {
    return /\brefus|\bnot satisfied\b|\bdoes not meet\b/i.test(t)
      ? 'refusal_letter'
      : 'ircc_correspondence';
  }

  // Passport machine-readable zone (ICAO 9303, TD3 line 1).
  if (/\bP[<A-Z][A-Z<]{3}[A-Z]+<</.test((text ?? '').replace(/ /g, ''))) {
    return 'passport';
  }

  // Civil records BEFORE the national ID: a NADRA birth certificate and a
  // nikah nama both print CNIC numbers beside "Father's Name" / "S/O", which
  // is exactly the identity card's own signature (dry run 2026-10-15).
  if (looksLikeMarriageCertificate(t)) return 'marriage_certificate';
  if (looksLikeBirthCertificate(t)) return 'birth_certificate';

  // National identity card. The CNIC number alone is not enough — Pakistani
  // bank statements print the holder's CNIC too — so it must come with the
  // card's own relative-name layout.
  if (
    /\bnational identity card\b|\bidentity card\b|\bidentity number\b|\bNICOP\b/i.test(
      t,
    ) ||
    (CNIC_NUMBER.test(t) && RELATIVE_LABEL.test(t))
  ) {
    return 'national_id';
  }

  // Insurance BEFORE the medical exam: an insurance policy or certificate
  // talks about "medical" cover and can even mention a "medical examination"
  // for pre-existing conditions, but it is never the exam report (#33, prod
  // 2026-10-14: "Medical Insurance_compressed.pdf" filed as medical_exam).
  if (
    /\binsurance\b/i.test(t) &&
    /\b(?:policy|insured|coverage|cover|premium|certificate)\b/i.test(t)
  ) {
    return 'medical_insurance';
  }

  // Immigration medical exam report (IRCC panel physician / IME / UMI).
  if (
    /\bpanel physician\b|\bimmigration medical exam(?:ination)?\b|\bIME\b|\bUMI\b|\bupfront medical\b|\beMedical\b/i.test(
      t,
    )
  ) {
    return 'medical_exam';
  }

  if (
    /\bstatement\b/i.test(t) &&
    /\b(?:balance|account (?:number|no|title))\b/i.test(t)
  ) {
    return 'bank_statement';
  }

  if (
    /\b(?:is|was|has been) (?:employed|working)\b|\bemployment (?:letter|certificate|verification)\b/i.test(
      t,
    )
  ) {
    return 'employment_letter';
  }

  return null;
}

// ─── Date of birth ───────────────────────────────────────────────────────────

const BIRTH_LABEL =
  /date\s*of\s*birth|birth\s*date|\bd\.?\s?o\.?\s?b\b|\bborn\b/gi;
const DATE_TOKEN = new RegExp(
  [
    String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}`,
    String.raw`\d{1,2}[-/.\s]\d{1,2}[-/.\s]\d{4}`,
    String.raw`\d{1,2}[-\s.]*[A-Za-z]{3,}\.?[-,\s.]*\d{4}`,
    String.raw`[A-Za-z]{3,}\.?[-\s]+\d{1,2}\s*,?[-\s]*\d{4}`,
  ].join('|'),
);

/**
 * Whether `dob` is printed as the FIRST date after a birth label ("Date of
 * Birth", "DOB", "Born", "Birth date") in the OCR text. The first date only:
 * an ID card's "Date of Issue" sits a line below its "Date of Birth".
 */
export function birthDateIsLabelled(
  text: string | null | undefined,
  dob: string,
): boolean {
  const wanted = birthDateCandidates(dob);
  if (!text || wanted.length === 0) return false;
  for (const label of text.matchAll(BIRTH_LABEL)) {
    const start = (label.index ?? 0) + label[0].length;
    const window = text.slice(start, start + 40);
    const date = DATE_TOKEN.exec(window);
    if (!date) continue;
    if (birthDateCandidates(date[0]).some((d) => wanted.includes(d))) {
      return true;
    }
  }
  return false;
}

// ─── Holder name on an ID card ───────────────────────────────────────────────

const NAME_VALUE = /^[\p{L}][\p{L} .'-]*[\p{L}.]$/u;
const LABEL_WORD =
  /\b(?:name|father|husband|gender|sex|country|identity|number|date|birth|issue|expiry|signature|holder|nationality)\b/i;

function cleanName(raw: string): string | null {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (v.length < 2 || !NAME_VALUE.test(v) || LABEL_WORD.test(v)) return null;
  return v;
}

/**
 * The card HOLDER's name on an ID card that also prints a relative (Pakistani
 * CNIC: "Father Name" / "Husband Name"; "S/O", "D/O", "W/O").
 *
 *  - `{ name }`            the value under the holder's own "Name" label;
 *  - `{ ambiguous: true }` a relative is named but the holder's label is not
 *                          readable — the extracted name cannot be trusted;
 *  - `{}`                  no relative labels: nothing to correct.
 */
export function nameFromIdCardText(text: string | null | undefined): {
  name?: string;
  ambiguous?: true;
} {
  if (!text || !RELATIVE_LABEL.test(text)) return {};
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "Muzaffar Ahmad S/O Mian Abdul Rasheed"
    const so = /^(?:name\s*[:-]?\s*)?(.+?)\s+[SDW]\s*\/\s*O\b/i.exec(line);
    if (so) {
      const n = cleanName(so[1]);
      if (n) return { name: n };
    }

    // "Name" / "Name: X" — the holder's own label, never "Father Name".
    const label = /^name\s*[:-]?\s*(.*)$/i.exec(line);
    if (label) {
      const sameLine = label[1] ? cleanName(label[1]) : null;
      if (sameLine) return { name: sameLine };
      const next = lines[i + 1] ? cleanName(lines[i + 1]) : null;
      if (!label[1] && next) return { name: next };
    }
  }
  return { ambiguous: true };
}

/**
 * The relative an ID card names beside its holder: "Husband Name" on a
 * married woman's CNIC, "Father Name" otherwise. A spouse's card is
 * recognised by its "Husband Name" naming the applicant.
 */
export function relativeFromIdCardText(text: string | null | undefined): {
  relation?: 'father' | 'husband' | 'wife' | 'guardian';
  name?: string;
} {
  if (!text) return {};
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const m =
      /^(father|husband|wife|guardian)(?:'?s)?\s*name\s*[:-]?\s*(.*)$/i.exec(
        lines[i],
      );
    if (!m) continue;
    const relation = m[1].toLowerCase() as
      | 'father'
      | 'husband'
      | 'wife'
      | 'guardian';
    const name =
      (m[2] ? cleanName(m[2]) : null) ??
      (lines[i + 1] ? cleanName(lines[i + 1]) : null);
    return name ? { relation, name } : { relation };
  }
  return {};
}

// ─── Field refinement ────────────────────────────────────────────────────────

function isIdCardType(documentType: string): boolean {
  const t = documentType.toLowerCase();
  return [
    'national_id',
    'id_card',
    'cnic',
    'nic',
    'nicop',
    'identity_card',
  ].some((p) => t === p || t.startsWith(`${p}_`));
}

function isPassportType(documentType: string): boolean {
  const t = documentType.toLowerCase();
  return t === 'passport' || t.startsWith('passport_');
}

// ─── Sex and national ID number from the printed text (#34) ─────────────────

/** ICAO 9303 TD3 (passport) MRZ line 2: number, check, nationality, DOB, check, SEX, expiry. */
const TD3_LINE2 = /^[A-Z0-9<]{9}[0-9<][A-Z<]{3}\d{6}[0-9<]([MFX<])\d{6}[0-9<]/;
const TD3_LINE1 = /^P[A-Z<][A-Z<]{3}[A-Z<]+$/;
const CNIC_ANY = /(?<![\d-])(\d{5})[-\s]?(\d{7})[-\s]?(\d)(?![\d-])/;
const SEX_LABEL = /\b(?:sex|gender)\b/gi;
const SEX_VALUE = /^(?:[:\-/\s]|country|of|stay)*\b(male|female|m|f|x)\b/i;

function mrzLines(text: string): { line1?: string; line2: string } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, '').toUpperCase())
    .filter((l) => l.length >= 30);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length >= 44 && TD3_LINE2.test(lines[i])) {
      const prev = i > 0 ? lines[i - 1] : undefined;
      return {
        line1: prev && TD3_LINE1.test(prev) ? prev : undefined,
        line2: lines[i],
      };
    }
  }
  return null;
}

function sexFromLabel(text: string): string | undefined {
  for (const label of text.matchAll(SEX_LABEL)) {
    const start = (label.index ?? 0) + label[0].length;
    const m = SEX_VALUE.exec(
      text.slice(start, start + 40).replace(/\s+/g, ' '),
    );
    if (m) return m[1].charAt(0).toUpperCase();
  }
  return undefined;
}

/**
 * Identity fields printed on the document itself, read deterministically so
 * they do not depend on which OCR provider (or model) ran:
 *
 *  - passport: `sex` from the MRZ (TD3 line 2, position 21) and the two MRZ
 *    lines as `mrz` (prefill derives the passport type from them);
 *  - national ID card: `national_id_number` (Pakistan CNIC xxxxx-xxxxxxx-x)
 *    and `sex` from the card's "Gender"/"Sex" label.
 *
 * Only identity document types are read — a Pakistani bank statement prints
 * the holder's CNIC too, and that is not this document's number.
 */
export function identityFieldsFromText(
  documentType: string | null | undefined,
  text: string | null | undefined,
): { sex?: string; mrz?: string; national_id_number?: string } {
  const type = documentType ?? '';
  const t = text ?? '';
  if (!t.trim()) return {};

  if (isPassportType(type)) {
    const mrz = mrzLines(t);
    if (!mrz) return {};
    const out: { sex?: string; mrz?: string } = {};
    const sex = TD3_LINE2.exec(mrz.line2)?.[1];
    if (sex && sex !== '<') out.sex = sex;
    if (mrz.line1) out.mrz = `${mrz.line1}\n${mrz.line2}`;
    return out;
  }

  if (isIdCardType(type)) {
    const out: { sex?: string; national_id_number?: string } = {};
    const cnic = CNIC_ANY.exec(t);
    if (cnic) out.national_id_number = `${cnic[1]}-${cnic[2]}-${cnic[3]}`;
    const sex = sexFromLabel(t);
    if (sex) out.sex = sex;
    return out;
  }

  return {};
}

// ─── Per-slot content check (#15) ────────────────────────────────────────────

export interface SlotMismatch {
  /** The checklist slot's document_type. */
  expected: string;
  /** What the document's text says it is. */
  detected: string;
  /** Shown to the applicant. */
  message: string;
}

/** Content type -> the family a slot must belong to for it to fit. */
const CONTENT_FAMILY: Record<string, string> = {
  passport: 'passport',
  national_id: 'national_id',
  refusal_letter: 'refusal',
  ircc_correspondence: 'refusal',
  medical_insurance: 'medical_insurance',
  medical_exam: 'medical_exam',
  bank_statement: 'financial',
  employment_letter: 'employment',
};

/**
 * Narrow slot families, matched on the slot's document_type. Ordered: photo
 * before passport (`passport_photo`), insurance before medical
 * (`medical_insurance`). A slot that matches none — "previous travel",
 * "proof of ties", "supporting documents" — is broad, and only an identity
 * document is flagged in it.
 */
const SLOT_FAMILIES: Array<[RegExp, string]> = [
  [/photo|picture/, 'photo'],
  [/passport|travel_document/, 'passport'],
  [/national_id|id_card|identity_card|cnic|nicop|^nic(?:_|$)/, 'national_id'],
  [/insurance/, 'medical_insurance'],
  [/medical|panel_physician|health_exam/, 'medical_exam'],
  [/refus|ircc|correspondence/, 'refusal'],
  [/bank|statement|fund|financ|saving|deposit/, 'financial'],
  [/employ|job_letter|salary|pay_?stub|payslip/, 'employment'],
];

/**
 * Broad slots that legitimately hold someone's identity document: a sponsor's
 * or relative's passport/CNIC is how a relationship or sponsorship is shown.
 */
const IDENTITY_FRIENDLY_SLOT =
  /identity|(?:^|_)id(?:_|$)|sponsor|host|relationship|family|parent|spouse|guarantor|invit|dependa?ent|child|civil_status/;

/**
 * Pages beyond the bio page: a visa foil (MRZ starting `V`) or entry/exit
 * stamps. A full passport scan is valid evidence of previous travel; the bio
 * page alone is not.
 */
function hasVisaOrStampPages(text: string): boolean {
  const compact = text.replace(/ /g, '');
  if (/(?:^|\n)V[<A-Z][A-Z<]{3}[A-Z]+<</.test(compact)) return true;
  return (
    /\bvisa\b/i.test(text) &&
    /\b(?:entry|exit|arrival|arrived|departure|departed|admitted)\b/i.test(text)
  );
}

const CONTENT_LABEL: Record<string, string> = {
  passport: 'a passport bio page',
  national_id: 'a national identity card',
  refusal_letter: 'a visa refusal letter',
  ircc_correspondence: 'a letter from IRCC',
  medical_insurance: 'a medical insurance policy',
  medical_exam: 'a medical exam report',
  bank_statement: 'a bank statement',
  employment_letter: 'an employment letter',
};

function humanize(type: string): string {
  return type.replace(/[_-]+/g, ' ').trim();
}

/**
 * Whether the uploaded content plainly does not belong in the checklist slot
 * it was dropped into. Returns the mismatch, or null when it fits, when the
 * content is unrecognisable, or when the slot is generic.
 *
 * Deliberately one-sided: the content classifier only names types it is sure
 * of, and a broad slot only rejects identity documents, so a false flag needs
 * a confident classification that contradicts a narrow slot.
 *
 * Dry run 2026-10-14 (#15): a passport bio page was accepted as "evidence of
 * previous travel" because nothing compared the two.
 */
export function slotContentMismatch(
  slotType: string | null | undefined,
  text: string | null | undefined,
): SlotMismatch | null {
  const slot = (slotType ?? '').toLowerCase().trim();
  if (identityRole(slot) === 'generic') return null;
  const detected = classifyDocumentText(text);
  if (!detected) return null;
  const contentFamily = CONTENT_FAMILY[detected];
  if (!contentFamily) return null;

  const slotFamily = SLOT_FAMILIES.find(([re]) => re.test(slot))?.[1];
  if (slotFamily === contentFamily) return null;

  const isIdentity =
    contentFamily === 'passport' || contentFamily === 'national_id';
  if (!slotFamily) {
    if (!isIdentity) return null;
    if (IDENTITY_FRIENDLY_SLOT.test(slot)) return null;
    if (contentFamily === 'passport' && hasVisaOrStampPages(text ?? '')) {
      return null;
    }
  }

  const what = CONTENT_LABEL[detected] ?? humanize(detected);
  const slotName = humanize(slot);
  const hint =
    contentFamily === 'passport' && /travel|visa|stamp/.test(slot)
      ? ' A passport bio page does not show previous travel — upload the pages with your previous visas or entry/exit stamps.'
      : '';
  return {
    expected: slot,
    detected,
    message:
      `This looks like ${what}, but this slot is for ${slotName}.${hint} ` +
      'Remove it and upload the right document here.',
  };
}

/**
 * Make the identity fields of one document trustworthy before they are stored
 * and cross-checked. Returns the refined fields and, per touched field, why.
 *
 *  - A non-identity document (supporting or still unclassified) keeps a
 *    date_of_birth only when its text prints that date beside a birth label —
 *    otherwise it is a letter/issue date the extractor was asked to call a DOB.
 *  - An ID card (or unclassified upload) that names a relative keeps the
 *    holder's name; when the holder's name is unreadable the name is dropped
 *    rather than compared.
 */
export function refineIdentityFields<T extends Record<string, unknown>>(
  documentType: string | null | undefined,
  text: string | null | undefined,
  fields: T,
): { fields: T; adjustments: Record<string, string> } {
  const out: Record<string, unknown> = { ...fields };
  const adjustments: Record<string, string> = {};
  const type = documentType ?? '';
  const role = identityRole(type);

  const civil = civilRecordKind(type, text);

  const dob = out.date_of_birth;
  if (
    role !== 'identity' &&
    civil !== 'birth_certificate' &&
    typeof dob === 'string' &&
    dob.trim() &&
    !birthDateIsLabelled(text, dob)
  ) {
    delete out.date_of_birth;
    adjustments.date_of_birth =
      'dropped: not an identity document and no birth label beside the date';
  }

  // An ID card carries a national identity number, not a passport number.
  // Providers that only know a "DocumentNumber" (Azure idDocument, the
  // passport-shaped prompt) used to file the CNIC as passport_number, which
  // then "mismatched" the real passport in the cross-check (#34).
  if (isIdCardType(type) && typeof out.passport_number === 'string') {
    if (out.national_id_number === undefined) {
      out.national_id_number = out.passport_number;
    }
    delete out.passport_number;
    adjustments.passport_number =
      'moved to national_id_number: an identity card has no passport number';
  }

  // Gap-fill sex and the national ID number from the printed text — the MRZ
  // on a passport, the "Gender" / "Identity Number" labels on an ID card. A
  // provider value always wins.
  for (const [key, value] of Object.entries(
    identityFieldsFromText(type, text),
  )) {
    if (out[key] !== undefined && out[key] !== '') continue;
    out[key] = value;
    adjustments[key] = 'filled from the document text';
  }

  if (isIdCardType(type) || role === 'generic') {
    const holder = nameFromIdCardText(text);
    if (holder.name && holder.name !== out.full_name) {
      out.full_name = holder.name;
      adjustments.full_name =
        'replaced with the holder name under the card\'s "Name" label';
    } else if (holder.ambiguous && out.full_name !== undefined) {
      delete out.full_name;
      adjustments.full_name =
        'dropped: ambiguous — the card names a relative and the holder name is unreadable';
    }
  }

  if (civil === 'birth_certificate') {
    fillFromBirthCertificate(out, adjustments, text);
  } else if (civil === 'marriage_certificate') {
    fillFromMarriageCertificate(out, adjustments, text);
  }

  return { fields: out as T, adjustments };
}

// ─── Civil records (dry run 2026-10-15) ─────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fields a birth certificate contributes to its own extraction record. */
const BIRTH_FIELDS: Array<keyof BirthRecord> = [
  'full_name',
  'given_name',
  'family_name',
  'date_of_birth',
  'sex',
  'place_of_birth',
  'country_of_birth',
  'father_name',
  'mother_name',
];

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && !v.trim());
}

/**
 * Gap-fill a birth certificate's fields from its printed labels and put its
 * date of birth in YYYY-MM-DD. A provider value stays unless it is an
 * unconverted print of the same date ("14-October-1989").
 *
 * Parents' CNICs are NOT stored on the document: prefill takes any CNIC on an
 * applicant document as the holder's national ID. sync_profile reads them
 * from the text when it matches parents to the applicant.
 */
function fillFromBirthCertificate(
  out: Record<string, unknown>,
  adjustments: Record<string, string>,
  text: string | null | undefined,
) {
  const records = parseBirthCertificates(text);
  if (records.length === 0) return;
  const named =
    typeof out.full_name === 'string'
      ? findByName(
          records.map((r) => ({ ...r, name: r.full_name })),
          out.full_name,
        )
      : null;
  const rec: BirthRecord = named ?? records[0];
  if (records.length > 1) out.birth_records_count = records.length;

  for (const key of BIRTH_FIELDS) {
    const want = rec[key];
    if (!want) continue;
    const have = out[key];
    if (isBlank(have)) {
      out[key] = want;
      adjustments[key] = 'filled from the certificate text';
      continue;
    }
    if (
      key === 'date_of_birth' &&
      typeof have === 'string' &&
      !ISO_DATE.test(have.trim())
    ) {
      out[key] = parseCivilDate(have, { dayFirst: true }) ?? want;
      adjustments[key] = `normalised "${have}" to YYYY-MM-DD`;
    }
  }
}

/**
 * The marriage date from the labelled English line wins over a model's read:
 * prod 2026-10-15 stored "16-9-1999" for a nikah nama whose typed Form No. 4
 * says "The date when the marriage was celebrated 16 - 9 - 1988". The
 * replacement is recorded, never silent.
 */
function fillFromMarriageCertificate(
  out: Record<string, unknown>,
  adjustments: Record<string, string>,
  text: string | null | undefined,
) {
  const rec = parseMarriageCertificate(text);
  const have = out.marriage_date;

  if (rec.marriage_date) {
    if (have !== rec.marriage_date) {
      out.marriage_date = rec.marriage_date;
      adjustments.marriage_date = isBlank(have)
        ? `filled from the certificate's "${rec.marriage_date_label}" line`
        : `replaced "${String(have)}" with the date on the certificate's labelled "${rec.marriage_date_label}" line`;
    }
    if (rec.marriage_date_conflict) {
      out.marriage_date_conflict = rec.marriage_date_conflict.join(', ');
    }
  } else if (typeof have === 'string' && !ISO_DATE.test(have.trim())) {
    // No labelled line to check against: convert only an unambiguous print.
    const iso = parseCivilDate(have);
    if (iso) {
      out.marriage_date = iso;
      adjustments.marriage_date = `normalised "${have}" to YYYY-MM-DD`;
    }
  }

  for (const key of ['bridegroom_name', 'bride_name'] as const) {
    if (rec[key] && isBlank(out[key])) {
      out[key] = rec[key];
      adjustments[key] = 'filled from the certificate text';
    }
  }
}
