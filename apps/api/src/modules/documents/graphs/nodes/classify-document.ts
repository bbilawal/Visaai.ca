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
  datesInText,
  parseMarriageCertificate,
  type BirthRecord,
} from '../../ocr/civil-records';
import { findByName } from '../../../shared/profile/family-members';
import { isPhotoDocumentType } from '../../ocr/extraction-schema';

// ─── Classification ──────────────────────────────────────────────────────────

/** Markers only a panel physician's immigration medical exam record carries. */
const IME_RECORD =
  /\bpanel (?:physician|clinic)\b|\bUMI\b|\bIME (?:\/ ?UMI )?(?:number|no\.?)\b|\bupfront (?:immigration )?medical\b|\beMedical\b/i;

const CNIC_NUMBER = /\b\d{5}-\d{7}-\d\b/;
/**
 * Proof of Canadian status: a PR card, a confirmation of permanent residence
 * or a citizenship certificate. A sponsor's PR card was filed as a generic
 * "document" (live E2E 2026-10-20, spousal sponsorship). Only the document's
 * own title layout counts — the bilingual title pair, or a COPR with its IMM
 * form number — because refusal letters, IMM 1344/5532/5533 and checklists
 * quote "permanent resident card" too.
 */
const CANADIAN_STATUS_DOCUMENT =
  /\bpermanent resident card\b[\s\S]{0,80}\bcarte de r[ée]sident permanent\b|\bcarte de r[ée]sident permanent\b[\s\S]{0,80}\bpermanent resident card\b|\bcitizenship certificate\b[\s\S]{0,80}\bcertificat de citoyennet[ée]|\bcertificat de citoyennet[ée][\s\S]{0,80}\bcitizenship certificate\b/i;
const COPR =
  /\bconfirmation of permanent residence\b/i;
const COPR_FORM = /\bIMM ?(?:5292|5688)\b/i;

function looksLikeCanadianStatusDocument(t: string): boolean {
  return CANADIAN_STATUS_DOCUMENT.test(t) || (COPR.test(t) && COPR_FORM.test(t));
}

/** The certificate's own title, in the wordings police forces issue. */
const POLICE_CERTIFICATE =
  /\bpolice (?:character |clearance |conduct )?certificate\b|\bpolice clearance\b|\bcertificate of (?:good conduct|no criminal record)\b|\bcharacter certificate\b/i;
/**
 * A tax return or tax-authority record: a return of income (Pakistan FBR
 * 114(1)), an income tax return (US 1040, India ITR), a notice of assessment
 * (CRA), or an NTN certificate. Titles only: a bank statement, payslip,
 * letterhead or invoice that prints a "National Tax Number", or a footer
 * urging the reader to "file your return of income", is not one.
 */
const TAX_TITLE =
  /\bnotice of assessment\b|\b(?:national tax number|NTN) certificate\b/i;
// "Return of income" / "income tax return" as a title, not as an instruction
// ("file your return of income", "returns filed", "to file").
const RETURN_TITLE =
  /(?<!\bfile (?:your |the |an |a )?|\bfiled |\bfiling (?:your |of )?)\b(?:return of income|income tax return)\b/i;
// A Pakistani return of income names its section or tax year; prod's FBR
// 114(1) heading is "114(1) (Return of Income filed voluntarily …)".
const RETURN_OF_INCOME_CONTEXT =
  /\b114 ?\(1\)|\btax year\b|\bfederal board of revenue\b/i;

function looksLikeTaxRecord(t: string): boolean {
  if (TAX_TITLE.test(t)) return true;
  const m = RETURN_TITLE.exec(t);
  if (!m) return false;
  if (/income tax return/i.test(m[0])) return true;
  return RETURN_OF_INCOME_CONTEXT.test(t);
}

const RELATIVE_LABEL =
  /\b(?:father|husband|guardian)(?:'?s)?\s*name\b|\b[sdw]\s*\/\s*o\b/i;

// ─── Agreements that quote their parties' CNICs (prod 2026-10-19) ───────────
//
// A Pakistani rent deed on stamp paper names the landlord and the tenant as
// "<name> S/O <father>, holder of CNIC No. xxxxx-xxxxxxx-x" — the CNIC
// number beside a relative label is exactly the identity card's own
// signature. Two shop lease deeds on a business-visitor application were
// filed as `national_id`, and the LANDLORD's CNIC became the applicant's
// pending national ID number.

/** The agreement's own title: English, romanised Urdu, Urdu script. */
const LEASE_TITLE = new RegExp(
  [
    String.raw`\b(?:rent(?:al)?|lease|tenancy|leave and licen[cs]e)\s+(?:agreement|deed|contract)\b`,
    String.raw`\b(?:agreement|deed|contract)\s+(?:of|for)\s+(?:rent|lease|tenancy)\b`,
    String.raw`\bkiraya\s*nama\b`,
    String.raw`\bkirayanama\b`,
    String.raw`کرای[ہه]\s*نام[ہه]`,
    String.raw`معاہد[ہه]\s*کرای[ہه]`,
  ].join('|'),
  'i',
);
/** Both sides of a tenancy (or any contract), each in its usual names. */
const LEASE_GRANTOR =
  /\b(?:landlord|lessor|licensor|(?:shop )?owner)\b|مؤجر|موجر|مالک\s*(?:مکان|دکان)/i;
const LEASE_HOLDER = /\b(?:tenant|lessee|licensee)\b|کرای[ہه]\s*دار|مستاجر/i;
/** What a tenancy is about: the rent, the deposit, the premises. */
const LEASE_TERMS =
  /\bmonthly rent\b|\brent of rs\b|\b(?:security|advance) (?:deposit|money|rent)\b|\b(?:demised )?premises\b|\bshop (?:no|number)\b|\bperiod of (?:the )?(?:lease|tenancy)\b/i;
/** The clauses any contract or deed carries and an identity card never does. */
const CONTRACT_CLAUSES = [
  /\bwitness(?:es)?\b|گواہ/i,
  /\bfirst party\b|\bparty of the first part\b|فریق\s*اول/i,
  /\bsecond party\b|\bparty of the second part\b|فریق\s*دوم/i,
  /\bhereinafter\b/i,
  /\bstamp paper\b|\bnon[- ]judicial\b/i,
  /\bin witness whereof\b|\bexecuted (?:on|at|this)\b/i,
];
/** A contract's own title, for agreements other than a tenancy. */
const CONTRACT_TITLE =
  /\b(?:agreement|deed|contract|iqrar\s*nama)\b|اقرار\s*نام[ہه]|معاہد[ہه]/i;
/** The layout of an identity card itself. */
const ID_CARD_LAYOUT = [
  /\bidentity\s*number\b/i,
  /\bdate\s*of\s*issue\b/i,
  /\bdate\s*of\s*expiry\b/i,
  /\bholder'?s?\s*signature\b/i,
];

function contractClauseCount(t: string): number {
  return CONTRACT_CLAUSES.filter((re) => re.test(t)).length;
}

/**
 * Whether the text is a contract between parties that merely QUOTES their
 * identity — a rent / lease / tenancy agreement (`lease_agreement`), or
 * another deed or agreement between a first and second party
 * (`agreement`) — rather than an identity document. Null otherwise.
 *
 *  - A tenancy titled as one (rent agreement, lease deed, kirayanama,
 *    کرایہ نامہ) that names both parties (landlord + tenant, lessor +
 *    lessee, first + second party) or carries two contract clauses is a
 *    tenancy even with the parties' CNIC copies attached: the attachments
 *    are the parties' cards, not the applicant's. The title alone is not
 *    enough — a bank statement's "RENT AGREEMENT FEE" line or an
 *    invitation letter's "a lease agreement for premises" mention it too.
 *  - Untitled, it needs both parties (landlord + tenant, lessor + lessee),
 *    tenancy terms or contract clauses, and none of a card's layout.
 *  - Any other contract needs its title, both parties and a witness or
 *    "hereinafter" clause, and at most one card label.
 *
 * `againstIdCard`: the text already looks like an identity card (a CNIC
 * beside "S/O", "Identity Card No."), so the only question left is deed or
 * card. A tenancy's title with its terms or one contract clause settles it —
 * "RENT AGREEMENT … S/O … CNIC No … monthly rent … Witness" names its
 * parties by name, not as landlord and tenant.
 */
export function agreementKind(
  text: string | null | undefined,
  options: { againstIdCard?: boolean } = {},
): 'lease_agreement' | 'agreement' | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const parties = LEASE_GRANTOR.test(t) && LEASE_HOLDER.test(t);
  const bothSides = CONTRACT_CLAUSES[1].test(t) && CONTRACT_CLAUSES[2].test(t);
  const terms = LEASE_TERMS.test(t);
  const clauses = contractClauseCount(t);
  const cardLabels = ID_CARD_LAYOUT.filter((re) => re.test(t)).length;

  if (LEASE_TITLE.test(t) && (parties || bothSides || clauses >= 2)) {
    return 'lease_agreement';
  }
  if (options.againstIdCard && LEASE_TITLE.test(t) && (terms || clauses >= 1)) {
    return 'lease_agreement';
  }
  if (parties && (terms ? 1 : 0) + clauses >= 2 && cardLabels === 0) {
    return 'lease_agreement';
  }

  if (
    CONTRACT_TITLE.test(t) &&
    bothSides &&
    (CONTRACT_CLAUSES[0].test(t) || CONTRACT_CLAUSES[3].test(t)) &&
    cardLabels <= 1
  ) {
    return 'agreement';
  }
  return null;
}

/** The types agreementKind files a contract under. */
export function isAgreementType(documentType: string | null | undefined) {
  const t = (documentType ?? '').toLowerCase().trim();
  return t === 'lease_agreement' || t === 'agreement';
}

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
    if (/\brefus|\bnot satisfied\b|\bdoes not meet\b/i.test(t)) {
      return 'refusal_letter';
    }
    // A COPR and a citizenship certificate name IRCC; they are the status,
    // not a letter. After the refusal check: a refusal quoting a PR card is
    // still the refusal.
    if (looksLikeCanadianStatusDocument(t)) return 'canadian_status_document';
    // A panel physician's upfront-exam confirmation names IRCC too; it is the
    // exam record, not a letter from IRCC (super visa, prod app 61f16bb5).
    if (IME_RECORD.test(t)) return 'medical_exam';
    return 'ircc_correspondence';
  }

  if (looksLikeCanadianStatusDocument(t)) return 'canadian_status_document';

  // Passport machine-readable zone (ICAO 9303, TD3 line 1).
  if (/\bP[<A-Z][A-Z<]{3}[A-Z]+<</.test((text ?? '').replace(/ /g, ''))) {
    return 'passport';
  }

  // Civil records BEFORE the national ID: a NADRA birth certificate and a
  // nikah nama both print CNIC numbers beside "Father's Name" / "S/O", which
  // is exactly the identity card's own signature (dry run 2026-10-15).
  if (looksLikeMarriageCertificate(t)) return 'marriage_certificate';
  if (looksLikeBirthCertificate(t)) return 'birth_certificate';
  // So does a Pakistani police character certificate, and the Express Entry
  // vault rejected one as "a national identity card" (prod 2026-10-19).
  if (POLICE_CERTIFICATE.test(t)) return 'police_clearance';

  // Tax returns and tax-authority records BEFORE insurance and the bank
  // statement: an FBR return of income has an "Insurance Premium" deduction
  // line and a wealth statement with a "Cash and Bank Balance", and was
  // rejected as a medical insurance policy (prod 2026-10-29, TRV).
  if (looksLikeTaxRecord(t)) return 'tax_return';

  // National identity card. The CNIC number alone is not enough — Pakistani
  // bank statements print the holder's CNIC too — so it must come with the
  // card's own relative-name layout.
  if (
    /\bnational identity card\b|\bidentity card\b|\bidentity number\b|\bNICOP\b/i.test(
      t,
    ) ||
    (CNIC_NUMBER.test(t) && RELATIVE_LABEL.test(t))
  ) {
    // So does a rent deed, naming landlord and tenant "S/O" with their CNICs
    // (prod 2026-10-19), and any other deed between a first and a second
    // party quoting their "Identity Card No.". It is still the deed.
    const agreement = agreementKind(t, { againstIdCard: true });
    if (agreement) return agreement;
    return 'national_id';
  }

  // Insurance BEFORE the medical exam: an insurance policy or certificate
  // talks about "medical" cover and can even mention a "medical examination"
  // for pre-existing conditions, but it is never the exam report (#33, prod
  // 2026-10-14: "Medical Insurance_compressed.pdf" filed as medical_exam).
  // An "insurance premium" line item (a payslip deduction, a bank debit, a
  // tax schedule) is not a policy, so it is no evidence either way.
  const withoutPremiumLines = t.replace(/\binsurance premiums?\b/gi, ' ');
  if (
    /\binsurance\b/i.test(withoutPremiumLines) &&
    /\b(?:policy|insured|coverage|cover|premium|certificate)\b/i.test(
      withoutPremiumLines,
    )
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

  // A lease that quotes no identity card. Last: a statement or letter that
  // merely mentions a lease is that statement or letter.
  if (agreementKind(t) === 'lease_agreement') return 'lease_agreement';

  return null;
}

/**
 * Broad slots that prove a family relationship. A civil record dropped into
 * one is that civil record: the slot says why it was uploaded, the text says
 * what it is.
 */
const RELATIONSHIP_SLOT =
  /relationship|family|relative|kinship|civil_status|dependa?nt|child|spouse|parent|genealog/;

/**
 * The civil-record type (birth_certificate / marriage_certificate) a document
 * in a relationship slot really is, or null. Never for a narrow slot: a birth
 * certificate in the bank-statement slot stays under the slot rules (#101),
 * and an identity card in a relationship slot is not a civil record at all.
 */
export function civilRecordInRelationshipSlot(
  slotType: string | null | undefined,
  text: string | null | undefined,
): 'birth_certificate' | 'marriage_certificate' | null {
  const slot = (slotType ?? '').toLowerCase().trim();
  if (!RELATIONSHIP_SLOT.test(slot)) return null;
  // Already a civil-record slot: nothing to re-type.
  if (/birth_cert|birth_registration|marriage|nikah/.test(slot)) return null;
  return civilRecordKind(slot, text);
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

export function isIdCardType(documentType: string): boolean {
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

/** `passport_copy`, `passport_bio_page` — never `passport_photo(s)`. */
export function isPassportType(documentType: string): boolean {
  const t = documentType.toLowerCase();
  if (isPhotoDocumentType(t)) return false;
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

/**
 * A CNIC prints "Date of Issue" and "Date of Expiry" as DD.MM.YYYY. IRCC's
 * /national-id-doc asks for the issue date, and the model extractor left both
 * out on the dry run's card (2026-10-16), so they are read from the labels.
 *
 * OCR gives two layouts: each label followed by its date, or a row of labels
 * ("Date of Birth  Date of Issue  Date of Expiry") with the dates underneath
 * in the same order. A label's own date is the one before the next label;
 * labels without one take the dates after the last label, in order. Date of
 * birth is a label too, only so its date is not handed to the next label.
 */
type CardDateKey = 'date_of_birth' | 'issue_date' | 'expiry_date';
const CARD_DATE_LABELS: Array<[RegExp, CardDateKey]> = [
  [/date\s*of\s*birth/gi, 'date_of_birth'],
  [/date\s*of\s*issue|issue\s*date/gi, 'issue_date'],
  [/date\s*of\s*expiry|expiry\s*date/gi, 'expiry_date'],
];
const CARD_DATE = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g;

function isoFromCardDate(m: RegExpExecArray): string | undefined {
  const [day, month, year] = [Number(m[1]), Number(m[2]), m[3]];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function cardDatesFromLabels(text: string): {
  issue_date?: string;
  expiry_date?: string;
} {
  const labels: Array<{ key: CardDateKey; start: number; end: number }> = [];
  for (const [re, key] of CARD_DATE_LABELS) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      labels.push({ key, start, end: start + m[0].length });
    }
  }
  if (!labels.some((l) => l.key !== 'date_of_birth')) return {};
  labels.sort((a, b) => a.start - b.start);

  const dates: Array<{ at: number; iso: string }> = [];
  for (const m of text.matchAll(CARD_DATE)) {
    const iso = isoFromCardDate(m);
    if (iso) dates.push({ at: m.index ?? 0, iso });
  }

  const found: Partial<Record<CardDateKey, string>> = {};
  const used = new Set<number>();
  const pending: CardDateKey[] = [];
  labels.forEach((l, i) => {
    const isLast = i === labels.length - 1;
    // In a row of labels the dates after the last label belong to the whole
    // row, not to the last label alone.
    if (isLast && pending.length) {
      pending.push(l.key);
      return;
    }
    const limit = labels[i + 1]?.start ?? l.end + 40;
    const own = dates.findIndex(
      (d, j) => !used.has(j) && d.at >= l.end && d.at < limit,
    );
    if (own >= 0) {
      used.add(own);
      found[l.key] ??= dates[own].iso;
    } else {
      pending.push(l.key);
    }
  });
  const last = labels[labels.length - 1].end;
  const after = dates
    .map((d, j) => ({ ...d, j }))
    .filter((d) => d.at >= last && !used.has(d.j));
  pending.forEach((key, i) => {
    if (after[i]) found[key] ??= after[i].iso;
  });

  const out: { issue_date?: string; expiry_date?: string } = {};
  if (found.issue_date) out.issue_date = found.issue_date;
  if (found.expiry_date) out.expiry_date = found.expiry_date;
  // A card that expires before it was issued was misread.
  if (out.issue_date && out.expiry_date && out.expiry_date <= out.issue_date)
    return {};
  return out;
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
 *  - national ID card: `national_id_number` (Pakistan CNIC xxxxx-xxxxxxx-x),
 *    `sex` from the card's "Gender"/"Sex" label, and `issue_date` /
 *    `expiry_date` from "Date of Issue" / "Date of Expiry".
 *
 * Only identity document types are read — a Pakistani bank statement prints
 * the holder's CNIC too, and that is not this document's number.
 */
export function identityFieldsFromText(
  documentType: string | null | undefined,
  text: string | null | undefined,
): {
  sex?: string;
  mrz?: string;
  national_id_number?: string;
  issue_date?: string;
  expiry_date?: string;
} {
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
    const out: {
      sex?: string;
      national_id_number?: string;
      issue_date?: string;
      expiry_date?: string;
    } = {};
    const cnic = CNIC_ANY.exec(t);
    if (cnic) out.national_id_number = `${cnic[1]}-${cnic[2]}-${cnic[3]}`;
    const sex = sexFromLabel(t);
    if (sex) out.sex = sex;
    Object.assign(out, cardDatesFromLabels(t));
    return out;
  }

  return {};
}

// ─── Medical exam dates ──────────────────────────────────────────────────────

const EXAM_DATE_LABEL =
  /(?:exam(?:ination)?\s*date|date\s*of\s*(?:the\s*)?(?:medical\s*)?exam(?:ination)?)\s*[:-]?\s*/gi;

/**
 * When `expiryDate` is really the exam date of a medical exam record, return
 * it (as printed in the field); otherwise null.
 */
function examDateFromText(
  documentType: string,
  text: string | null | undefined,
  expiryDate: unknown,
): string | null {
  if (typeof expiryDate !== 'string' || !expiryDate.trim() || !text) {
    return null;
  }
  if (
    !/medical|panel_physician|health_exam|\bime\b/.test(
      documentType.toLowerCase(),
    )
  ) {
    return null;
  }
  if (/insurance/.test(documentType.toLowerCase())) return null;
  const wanted = birthDateCandidates(expiryDate);
  if (wanted.length === 0) return null;
  for (const label of text.matchAll(EXAM_DATE_LABEL)) {
    const start = (label.index ?? 0) + label[0].length;
    const date = DATE_TOKEN.exec(text.slice(start, start + 40));
    if (date && birthDateCandidates(date[0]).some((d) => wanted.includes(d))) {
      return expiryDate;
    }
  }
  return null;
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
  tax_return: 'tax',
  bank_statement: 'financial',
  employment_letter: 'employment',
  police_clearance: 'police',
  canadian_status_document: 'status',
  lease_agreement: 'agreement',
  agreement: 'agreement',
};

/**
 * Narrow slot families, matched on the slot's document_type. Ordered: photo
 * before passport (`passport_photo`), insurance before medical
 * (`medical_insurance`). A slot that matches none — "previous travel",
 * "proof of ties", "supporting documents" — is broad, and only an identity
 * document is flagged in it.
 */
// The photo matcher is the shared one, so a `passport_photocopy` slot stays a
// passport slot and a `photo_id` slot is not a photograph slot.
const SLOT_FAMILIES: Array<[Pick<RegExp, 'test'>, string]> = [
  [{ test: isPhotoDocumentType }, 'photo'],
  [/passport|travel_document/, 'passport'],
  [/national_id|id_card|identity_card|cnic|nicop|^nic(?:_|$)/, 'national_id'],
  [/insurance/, 'medical_insurance'],
  [/medical|panel_physician|health_exam/, 'medical_exam'],
  [/refus|ircc|correspondence/, 'refusal'],
  [/bank|statement|fund|financ|saving|deposit/, 'financial'],
  [/employ|job_letter|salary|pay_?stub|payslip/, 'employment'],
  [/police|clearance|(?:^|_)pcc(?:_|$)|good_conduct/, 'police'],
];

/**
 * Broad slots that legitimately hold someone's identity document: a sponsor's
 * or relative's passport/CNIC is how a relationship or sponsorship is shown.
 */
// `status`: a sponsor's proof of Canadian status may be their Canadian
// passport (spousal sponsorship's proof_of_status slot, review of #250).
const IDENTITY_FRIENDLY_SLOT =
  /identity|(?:^|_)id(?:_|$)|sponsor|host|relationship|family|parent|spouse|guarantor|invit|dependa?ent|child|civil_status|(?:^|_)status(?:_|$)/;

/** Slots for someone other than the applicant: a spouse, sponsor, relative. */
const OTHER_PERSON_SLOT =
  /spouse|partner|sponsor|host|parent|child|relative|family|guarantor|invit|dependa?nt/;

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
  tax_return: 'a tax return or tax record',
  bank_statement: 'a bank statement',
  employment_letter: 'an employment letter',
  police_clearance: 'a police certificate',
  canadian_status_document: 'a Canadian PR card or citizenship certificate',
  lease_agreement: 'a rent or lease agreement',
  agreement: 'an agreement between two parties',
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
  // A lease or other contract is legitimate evidence in most slots (business
  // premises, property, ties, even rental income as funds). It is only
  // plainly wrong where an identity document belongs (prod 2026-10-19).
  if (
    contentFamily === 'agreement' &&
    slotFamily !== 'passport' &&
    slotFamily !== 'national_id'
  ) {
    return null;
  }
  // A tax return is income and funds evidence: it belongs in income,
  // employment and financial slots, and in any broad slot.
  if (
    contentFamily === 'tax' &&
    (!slotFamily || slotFamily === 'employment' || slotFamily === 'financial')
  ) {
    return null;
  }
  // IRCC's own medical instructions are what an applicant without an upfront
  // exam holds for this slot until the exam is done.
  if (slotFamily === 'medical_exam' && detected === 'ircc_correspondence') {
    return null;
  }

  const isIdentity =
    contentFamily === 'passport' || contentFamily === 'national_id';
  // Another person's identity slot ("National ID card or passport — <spouse>")
  // takes either identity document — or their Canadian status card (a
  // sponsor's PR card). The applicant's own slots stay strict.
  if (
    (isIdentity || contentFamily === 'status') &&
    (slotFamily === 'passport' || slotFamily === 'national_id') &&
    OTHER_PERSON_SLOT.test(slot)
  ) {
    return null;
  }
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

/** Identity a contract only quotes from its parties (or their card copies). */
const AGREEMENT_DROPPED_KEYS = [
  'full_name',
  'given_name',
  'family_name',
  'date_of_birth',
  'sex',
  'nationality',
  'place_of_birth',
  'national_id_number',
  'passport_number',
  'mrz',
  'father_name',
  'mother_name',
  'issue_date',
  'expiry_date',
  'holder_unknown',
];

/**
 * The mismatch for an upload typed as an identity document whose text is an
 * agreement (agreementKind), when `slotType` is a passport / national ID
 * slot; null for any other slot. Built from the agreement already detected,
 * never re-detected from the text: a deed that quotes no CNIC next to "S/O"
 * would not be re-detected, and would then pass as a verified supporting
 * document in the ID slot.
 */
export function agreementInIdentitySlot(
  slotType: string | null | undefined,
  kind: 'lease_agreement' | 'agreement',
): SlotMismatch | null {
  const slot = (slotType ?? '').toLowerCase().trim();
  const family = SLOT_FAMILIES.find(([re]) => re.test(slot))?.[1];
  if (family !== 'passport' && family !== 'national_id') return null;
  return {
    expected: slot,
    detected: kind,
    message:
      `This looks like ${CONTENT_LABEL[kind]}, but this slot is for ${humanize(slot)}. ` +
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

  // A lease or other contract names its parties — landlord and tenant, each
  // "S/O" somebody with a CNIC — and none of them is "the person the
  // document is about". Nothing it quotes is an identity read: the
  // landlord's CNIC was the applicant's pending national ID number (prod
  // 2026-10-19). Also guards an ID-typed or untyped upload whose text is
  // plainly a contract, should it reach here without being re-typed.
  if (
    isAgreementType(type) ||
    ((isIdCardType(type) || role === 'generic') &&
      agreementKind(text, { againstIdCard: isIdCardType(type) }))
  ) {
    for (const key of AGREEMENT_DROPPED_KEYS) {
      if (out[key] === undefined) continue;
      delete out[key];
      adjustments[key] =
        'dropped: an agreement quotes its parties; it is not an identity document';
    }
    return { fields: out as T, adjustments };
  }

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

  // An immigration medical exam record states the EXAM date; extractors asked
  // for an expiry_date return it there, and the exam then "expired" the day
  // it was taken (prod app 61f16bb5). A date printed beside an exam-date label
  // is the exam date. The expiry check derives validity from it.
  const exam = examDateFromText(type, text, out.expiry_date);
  if (exam) {
    if (out.exam_date === undefined || out.exam_date === '') {
      out.exam_date = exam;
    }
    delete out.expiry_date;
    adjustments.expiry_date =
      'moved to exam_date: the date is printed as the exam date';
  }

  // A currency is a code (CAD, PKR), never prose — DUMMY_insurance.pdf
  // yielded currency "paid in full".
  if (
    typeof out.currency === 'string' &&
    !/^[A-Za-z]{3}$/.test(out.currency.trim())
  ) {
    delete out.currency;
    adjustments.currency = 'dropped: not a currency code';
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
      // Whose card it is is unknown. Live E2E 2026-10-18: a tenancy
      // agreement with the parties' CNICs attached was read as an ID card,
      // and the landlord's card date and number became the applicant's
      // ("DOB 2025-11-06"). The date of birth goes; the number stays, because
      // matching it against the CNIC the applicant typed is how their own
      // card with an unreadable name is still recognised — but the card is
      // marked so nothing treats it as the applicant's without that match.
      if (out.date_of_birth !== undefined) {
        delete out.date_of_birth;
        adjustments.date_of_birth =
          'dropped: the holder of this card is unknown';
      }
      out.holder_unknown = true;
      adjustments.holder_unknown =
        "set: only a match on the national ID number makes it the applicant's";
    }
  }

  // An ID card with no holder name at all is just as unknown: a tenancy
  // agreement's attached CNIC copies came back nameless on a re-read.
  if (
    isIdCardType(type) &&
    !['full_name', 'given_name', 'family_name'].some(
      (k) => typeof out[k] === 'string' && (out[k] as string).trim(),
    ) &&
    out.holder_unknown !== true
  ) {
    if (out.date_of_birth !== undefined) {
      delete out.date_of_birth;
      adjustments.date_of_birth = 'dropped: the holder of this card is unknown';
    }
    out.holder_unknown = true;
    adjustments.holder_unknown =
      "set: no holder name; only a match on the national ID number makes it the applicant's";
  }

  // A bank statement names its holder as the account holder; the extractor's
  // `full_name` there has been an address line ("Loroy Chowk Gujrat Fateh
  // Pur", live E2E 2026-10-18) that the consistency check then compared with
  // the passport.
  const accountHolder = out.account_holder_name;
  if (
    typeof accountHolder === 'string' &&
    accountHolder.trim() &&
    typeof out.full_name === 'string' &&
    out.full_name.trim() !== accountHolder.trim()
  ) {
    out.full_name = accountHolder.trim();
    adjustments.full_name = 'replaced with the account holder name';
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
  } else if (typeof have === 'string' && !isBlank(have)) {
    // No readable date on the certificate to check against. A model's date
    // that appears nowhere in the text was invented (prod 2026-10-16:
    // "1999-09-16" for a certificate that only ever prints 1988): drop it
    // rather than let it reach the profile and the IRCC form.
    const asIso = ISO_DATE.test(have.trim())
      ? have.trim()
      : parseCivilDate(have, { dayFirst: true });
    const printed = new Set([
      ...datesInText(text, { dayFirst: true }),
      ...datesInText(text),
    ]);
    if (!asIso || !printed.has(asIso)) {
      delete out.marriage_date;
      adjustments.marriage_date = `dropped "${have}": not on the certificate`;
    } else if (asIso !== have) {
      out.marriage_date = asIso;
      adjustments.marriage_date = `normalised "${have}" to YYYY-MM-DD`;
    }
  }

  // The parties read from the certificate's own text win over a model's read,
  // as the date does: prod 2026-10-16 the model returned "uzaffar Ahmad S/O M",
  // and sync-family, unable to match the applicant, ignored the certificate.
  for (const key of ['bridegroom_name', 'bride_name'] as const) {
    const read = rec[key];
    if (!read) continue;
    const have = out[key];
    if (isBlank(have)) {
      out[key] = read;
      adjustments[key] = 'filled from the certificate text';
    } else if (typeof have === 'string' && have.trim() !== read) {
      out[key] = read;
      adjustments[key] =
        `replaced "${have}" with the name read from the certificate text`;
    }
  }
}
