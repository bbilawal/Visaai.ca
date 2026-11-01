import type { EvalCase } from '../eval-harness';

/**
 * Eval fixtures for `document_classification`.
 *
 * ALL SYNTHETIC. Not one line came from a real upload. These tasks run over
 * passports, bank statements and family records, and a fixture file gets copied
 * onto laptops and printed into CI logs — `assertFixtureIsSafe` refuses a set
 * carrying an MRZ, a card-length digit run, an IBAN, an SSN or a real email
 * domain, and this set is written to pass it.
 *
 * WHY THESE CASES
 *
 * A fixture set that only contains easy cases measures nothing: every tier
 * passes and the eval says "route it at nano" without evidence. Each case below
 * is here for a failure it can catch, and the `rationale` field says which.
 * The confusion pairs matter most — a classifier that scores 95% on clean
 * documents and confuses a payslip with an employment letter produces a
 * checklist that says the wrong document is satisfied.
 *
 * Threshold for this task is 0.95, the highest in the registry, because a
 * misclassification silently marks a checklist item complete.
 */
export const DOCUMENT_CLASSIFICATION_CASES: EvalCase<string, string>[] = [
  // ── Clean cases: the floor. A tier failing these fails outright. ─────────
  {
    id: 'passport-bio-page',
    input:
      'REPUBLIC OF EXAMPLIA — PASSPORT. Type P. Code EXM. Passport No EX0000000. ' +
      'Surname: SAMPLE. Given names: ALEX JORDAN. Nationality: EXAMPLIAN. ' +
      'Date of birth: 01 JAN 1990. Sex: X. Place of birth: CAPITAL CITY. ' +
      'Date of issue: 01 JAN 2020. Date of expiry: 01 JAN 2030. Authority: PASSPORT OFFICE.',
    expected: 'passport',
    rationale: 'The most common upload. If this fails, nothing else matters.',
  },
  {
    id: 'bank-statement-multi-month',
    input:
      'EXAMPLE BANK — Statement of Account. Account holder: ALEX SAMPLE. ' +
      'Sort code 00-00-00. Account ending 0000. Period: 01 Mar 2026 to 31 May 2026. ' +
      'Opening balance 4,210.00. 03 Mar SALARY CREDIT 2,600.00. 05 Mar RENT -1,100.00. ' +
      '12 Apr SALARY CREDIT 2,600.00. Closing balance 8,930.00.',
    expected: 'bank_statement',
    rationale: 'Financial evidence; drives the proof-of-funds requirement.',
  },
  {
    id: 'employment-letter',
    input:
      'EXAMPLE CORP LIMITED. To whom it may concern. This letter confirms that ' +
      'ALEX SAMPLE has been employed by Example Corp Limited as a Senior Analyst ' +
      'since 14 February 2021 on a permanent full-time contract. Annual salary is ' +
      '62,000. Approved leave 10 June to 24 June 2026. Signed, HR Director.',
    expected: 'employment_letter',
    rationale:
      'Employment evidence, and the clean half of the payslip confusion pair ' +
      'below — the two must be distinguishable from each other.',
  },

  // ── Confusion pairs: where a cheap tier actually breaks. ────────────────
  {
    id: 'payslip-not-employment-letter',
    input:
      'EXAMPLE CORP LIMITED — PAYSLIP. Employee: ALEX SAMPLE. Pay period: May 2026. ' +
      'Payment date: 28 May 2026. Gross pay 5,166.67. Income tax -1,033.00. ' +
      'Pension -258.00. Net pay 3,875.67. Year to date gross 10,333.34.',
    expected: 'pay_stub',
    rationale:
      'Confusion partner for employment-letter: same employer, same person, ' +
      'both are "employment evidence". Mislabelling marks the wrong checklist ' +
      'item satisfied.',
  },
  {
    id: 'bank-letter-not-statement',
    input:
      'EXAMPLE BANK. To whom it may concern. We confirm that ALEX SAMPLE has held ' +
      'an account with us since March 2018 and that the balance as at 01 June 2026 ' +
      'is 8,930.00. This letter is issued at the customer’s request. Branch Manager.',
    expected: 'bank_letter',
    rationale:
      'Confusion partner for bank-statement: same institution, same balance, ' +
      'but a letter is not a transaction history and does not satisfy a ' +
      'six-month statement requirement.',
  },
  {
    id: 'national-id-not-passport',
    input:
      'REPUBLIC OF EXAMPLIA — NATIONAL IDENTITY CARD. Card No 000000000. ' +
      'Surname SAMPLE. Given names ALEX JORDAN. Date of birth 01 JAN 1990. ' +
      'Nationality EXAMPLIAN. Valid until 01 JAN 2032.',
    expected: 'national_id',
    rationale:
      'Confusion partner for passport: same fields, same layout language. ' +
      'A national ID never satisfies a travel-document requirement.',
  },

  // ── Degraded input: what real uploads look like. ────────────────────────
  {
    id: 'passport-poor-ocr',
    input:
      'REPUBL1C 0F EXAMPLIA PASSP0RT Typ3 P C0de EXM Passp0rt N0 EX000OOOO ' +
      'Surnam3 SAMPLE Giv3n nam3s ALEX J0RDAN Nati0nality EXAMPLIAN ' +
      'Dat3 0f expiry 01 JAN 2030',
    expected: 'passport',
    rationale:
      'Phone-camera OCR with character substitution. A tier that only works on ' +
      'clean text is not usable on real uploads.',
  },
  {
    id: 'statement-truncated',
    input: 'EXAMPLE BANK Statement of Acc',
    expected: 'bank_statement',
    rationale:
      'A partial first page. Tests whether a short input still classifies.',
  },

  // ── Must-not-guess: the case where refusing is correct. ─────────────────
  {
    id: 'unrelated-document',
    input:
      'EXAMPLE CITY COUNCIL. Notice of parking contravention. Vehicle registration ' +
      'AB00 XYZ. Location: High Street. Date: 02 June 2026. Amount due 60.00.',
    expected: 'unknown',
    rationale:
      'Not any known type. A classifier that forces this into the nearest ' +
      'label is worse than one that says unknown — a wrong label marks a ' +
      'checklist item satisfied by a parking ticket.',
  },
  {
    id: 'blank-scan',
    input: '   ',
    expected: 'unknown',
    rationale: 'A failed scan. Must not be confidently labelled anything.',
  },
];
