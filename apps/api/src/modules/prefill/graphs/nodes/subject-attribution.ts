/**
 * Who does an uploaded document describe?
 *
 * Applicants routinely upload OTHER people's documents: a host's invitation, a
 * sponsoring child's employment letter and bank statement, a spouse's ID. The
 * prefill used to merge every extraction into one bag, so a retired father's
 * "Previous job title" came back as the HR signatory on his son's employment
 * letter and his "Monthly income" as his other son's annual salary.
 *
 * Every document now gets a SUBJECT before any value reaches a form field:
 *
 *   applicant     — names the applicant (passport name is the anchor), or is a
 *                   non-financial document that names nobody.
 *   third_party   — names somebody else.
 *   host          — an invitation letter: describes the person inviting.
 *   unattributed  — a sponsor-capable document (employment, bank, tax, pay)
 *                   that names nobody we can check. It could be anyone's, so it
 *                   must never fill an applicant field.
 *
 * Only `applicant` documents may fill applicant fields.
 */
export type DocumentSubject = 'applicant' | 'third_party' | 'host' | 'unattributed';

/** Document types that are as often a sponsor's as the applicant's own. */
const SPONSOR_CAPABLE_TYPES = new Set([
  'employment_letter',
  'employment_verification',
  'bank_statement',
  'proof_of_funds',
  'financial_statement',
  'pay_stub',
  'payslip',
  'pay_slip',
  't4',
  'tax_return',
  'notice_of_assessment',
  'income_tax_return',
  'salary_certificate',
  'sponsor_letter',
  'affidavit_of_support',
  'business_registration',
]);

/** Document types that by definition describe the inviting/hosting person. */
const HOST_TYPES = new Set(['invitation_letter', 'letter_of_invitation']);

/** Extracted keys that mark a document as employment/financial evidence. */
const SPONSOR_CAPABLE_KEYS =
  /^(job_title|occupation|position|employer(_name)?|employment_start_date|employment_end_date|monthly_income|annual_income|salary|gross_income|net_income|account_balance|average_monthly_balance|closing_balance|account_number|account_holder_name)$/;

/** Holder-name keys, most specific first. */
const HOLDER_KEYS = [
  'account_holder_name',
  'employee_name',
  'holder_name',
  'payee_name',
  'taxpayer_name',
  'applicant_name',
  'full_name',
  'name',
];

export function holderNameOf(fields: Record<string, unknown>): string | null {
  for (const k of HOLDER_KEYS) {
    const v = fields[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  // OCR slips only forgiven on long tokens — "ali" vs "ari" are different people.
  return a.length >= 5 && b.length >= 5 && withinOneEdit(a, b);
}

/**
 * True when EVERY token of the applicant's name appears in the holder name.
 * Requiring all tokens is what separates "Muzaffar Ahmad" from his son
 * "Bilawal Muzaffar" — relatives share surnames, rarely full names.
 */
export function namesMatch(
  applicant: string | null | undefined,
  holder: string | null | undefined,
): boolean {
  const a = nameTokens(applicant);
  const h = nameTokens(holder);
  if (a.length === 0 || h.length === 0) return false;
  return a.every((t) => h.some((x) => tokenMatches(t, x)));
}

export function isSponsorCapable(
  documentType: string,
  fields: Record<string, unknown>,
): boolean {
  if (SPONSOR_CAPABLE_TYPES.has(documentType)) return true;
  return Object.keys(fields).some((k) => SPONSOR_CAPABLE_KEYS.test(k));
}

export function classifyDocumentSubject(
  documentType: string,
  fields: Record<string, unknown>,
  applicantName: string | null | undefined,
): DocumentSubject {
  if (HOST_TYPES.has(documentType)) return 'host';
  const holder = holderNameOf(fields);
  if (holder && nameTokens(applicantName).length > 0) {
    return namesMatch(applicantName, holder) ? 'applicant' : 'third_party';
  }
  return isSponsorCapable(documentType, fields) ? 'unattributed' : 'applicant';
}
