import type { VriState } from '../vri.state';
import {
  currencyOfKey,
  docsOfType,
  documentEvidence,
  asNumber,
  numFacts,
  stayFacts,
  toUsd,
  boolFact,
} from './evidence';

/** Rough daily cost of a visit, USD. Used only to band funds vs stay length. */
const DAILY_NEED_USD = 100;

const FUND_DOC = [
  /bank_statement/,
  /proof_of_funds/,
  /fixed_deposit/,
  /savings/,
  /financial/,
];
const INCOME_DOC = [
  /employment_letter/,
  /pay_?stub/,
  /payslip/,
  /tax_return/,
  /^noa/,
  /pension/,
];
const FUND_KEYS = [/funds/, /savings/, /bank_balance/, /cash_available/];
const FUND_EXCLUDE = [/insurance|coverage|source|provider|support$|currency/];
const APPLICANT_INCOME = [
  /^(monthly|annual)_(salary|income|pension)/,
  /^salary/,
  /^pension_(amount|income)/,
  /^income/,
];
const SPONSOR_INCOME = [
  /(son|daughter|sponsor|host|spouse|family_member|child|parent|brother|sister|inviter).*_(income|salary)/,
];

/**
 * Financial sufficiency from declared AND documented money, weighed against
 * the stay length.
 *
 * Before: +40 for any bank_statement with ocr_status complete (file presence),
 * +30 for an account_balance on an 'identity' verification of ANY document,
 * +30 for `monthly_salary_usd`/`monthly_income`. A sponsor-funded retiree who
 * declared CAD 30k scored 0.
 *
 * Points (max 100):
 *   40  readable bank / proof-of-funds document with a balance
 *   15  funds declared at intake
 *   15  funds (documented preferred, else declared) cover the stay at ~USD 100/day
 *        (8 if they cover at least half)
 *   15  an income source declared (applicant or named sponsor)
 *   15  that income documented by a readable letter / pay stub / tax document
 * A fund document that OCR could not read earns nothing and is named.
 */
export async function scoreFinancial(
  state: VriState,
): Promise<Partial<VriState>> {
  const p = state.data.profile;
  const docs = documentEvidence(state.data);
  const notes: string[] = [];
  let score = 0;

  // Documentary funds
  const fundDocs = docsOfType(docs, ...FUND_DOC);
  const docBalances = fundDocs
    .filter((d) => d.readable)
    .map((d) => ({
      d,
      amount:
        asNumber(d.fields.account_balance) ??
        asNumber(d.fields.average_monthly_balance),
      currency:
        typeof d.fields.currency === 'string'
          ? d.fields.currency.toUpperCase()
          : undefined,
    }))
    .filter((x) => x.amount !== undefined && x.amount > 0);
  if (docBalances.length > 0) {
    score += 40;
    for (const b of docBalances)
      notes.push(
        `${b.d.type}: balance ${b.amount!.toLocaleString('en-US')} ${b.currency ?? '(currency not read)'} read from the document.`,
      );
  } else if (fundDocs.some((d) => d.readable)) {
    score += 15;
    notes.push(
      'A fund document was read but no balance could be extracted from it.',
    );
  }
  const unreadableFunds = fundDocs.filter((d) => d.failed);
  if (unreadableFunds.length > 0)
    notes.push(
      `${unreadableFunds.map((d) => d.type).join(', ')} uploaded but unreadable (OCR failed) — its content was NOT assessed.`,
    );

  // Declared funds
  const declared = numFacts(p, FUND_KEYS, FUND_EXCLUDE).sort(
    (a, b) => b.value - a.value,
  )[0];
  const declaredCurrency = declared
    ? currencyOfKey(declared.key, p)
    : undefined;
  if (declared) {
    score += 15;
    notes.push(
      `Declared funds: ${declared.value.toLocaleString('en-US')} ${declaredCurrency ?? '(currency unknown)'}.`,
    );
  }

  // Adequacy vs stay
  const { days } = stayFacts(p);
  const best =
    docBalances
      .map((b) => toUsd(b.amount!, b.currency))
      .filter((x): x is number => x !== undefined)
      .sort((a, b) => b - a)[0] ??
    (declared ? toUsd(declared.value, declaredCurrency) : undefined);
  if (best !== undefined && days) {
    const need = days * DAILY_NEED_USD;
    const ratio = best / need;
    if (ratio >= 1) score += 15;
    else if (ratio >= 0.5) score += 8;
    notes.push(
      `Funds ≈ USD ${Math.round(best).toLocaleString('en-US')} vs ≈ USD ${need.toLocaleString('en-US')} for a ${days}-day stay (${ratio >= 1 ? 'covers' : ratio >= 0.5 ? 'partly covers' : 'does not cover'} it).`,
    );
  } else if (declared || docBalances.length) {
    notes.push(
      'Stay length or currency unknown — funds could not be weighed against the trip.',
    );
  }

  // Income
  const applicantIncome = numFacts(p, APPLICANT_INCOME, [
    /son|daughter|sponsor|spouse|host/,
  ]);
  const sponsorIncome = numFacts(p, SPONSOR_INCOME);
  const sponsorDeclared =
    boolFact(p, [/supports_trip/, /sponsor/, /financial_support/]) ??
    sponsorIncome.length > 0;
  if (applicantIncome.length > 0 || sponsorIncome.length > 0) {
    score += 15;
    for (const i of [...applicantIncome, ...sponsorIncome])
      notes.push(
        `Declared income: ${i.key} = ${i.value.toLocaleString('en-US')}${currencyOfKey(i.key) ? ' ' + currencyOfKey(i.key) : ''}.`,
      );
  }
  const incomeDocs = docsOfType(docs, ...INCOME_DOC);
  const readableIncome = incomeDocs.filter(
    (d) =>
      d.readable &&
      (asNumber(d.fields.annual_income) ??
        asNumber(d.fields.monthly_income) ??
        asNumber(d.fields.net_income)),
  );
  if (readableIncome.length > 0) {
    score += 15;
    notes.push(
      `Income documented by: ${readableIncome.map((d) => d.type).join(', ')}.`,
    );
  } else if (incomeDocs.some((d) => d.failed)) {
    notes.push(
      `${incomeDocs
        .filter((d) => d.failed)
        .map((d) => d.type)
        .join(', ')} uploaded but unreadable — income NOT verified.`,
    );
  }
  if (
    sponsorDeclared &&
    sponsorIncome.length > 0 &&
    readableIncome.length === 0
  )
    notes.push(
      'Trip is sponsor-funded but the sponsor’s income/funds are not yet documented by a readable document.',
    );

  const anyEvidence =
    docBalances.length > 0 ||
    fundDocs.some((d) => d.readable) ||
    declared !== undefined ||
    applicantIncome.length > 0 ||
    sponsorIncome.length > 0 ||
    readableIncome.length > 0;
  if (!anyEvidence) {
    return {
      scores: { financial_pct: 0 } as VriState['scores'],
      unassessedFactors: ['financial_pct'],
      factorEvidence: {
        financial_pct: [
          'No readable financial document and no funds or income declared — financial sufficiency was not assessed.',
          ...notes,
        ],
      },
    };
  }

  return {
    scores: { financial_pct: Math.min(score, 100) } as VriState['scores'],
    factorEvidence: { financial_pct: notes },
  };
}
