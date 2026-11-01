import {
  isStudyPermitRoute,
  isSuperVisaRoute,
  plannedStay,
  studyFundsNeed,
  SUPER_VISA_MIN_INSURANCE_CAD,
  superVisaIncomeCheck,
  superVisaInsuranceCheck,
} from '@visaai/types';
import {
  choosePolicy,
  readPolicy,
} from '../../../shared/profile/insurance-policy';
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
  // A Guaranteed Investment Certificate: a study permit's usual proof.
  /(^|_)gic(_|$)/,
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

const cad = (n: number) => `CAD ${n.toLocaleString('en-US')}`;

/** The host's income evidence on a super visa (slot codes and NOA/T4 types). */
const HOST_INCOME_DOC = [
  /income_proof/,
  /notice_of_assessment/,
  /^noa/,
  /(^|_)t4(_|$)/,
  /tax_return/,
  /employment_letter/,
  /pay_?stub/,
  /payslip/,
];

/**
 * A super visa is decided on two financial tests, in place of the visitor's
 * declared funds and "funds cover ~USD 100 a day". The factor is scored on
 * them alone (max 100):
 *   40  the host's income (plus a spouse co-signer's) meets the minimum
 *       necessary income for the host's family size
 *   20  that income is documented: a readable host income document (NOA, T4,
 *       employment letter — the checklist's income_proof slots)
 *   30  private medical insurance meets the published minimum (≥ CAD 100,000,
 *       ≥ 1 year from entry, paid)
 *   10  ...documented by an uploaded policy that covers the stay
 * Of several uploaded policies, the one covering the stay is weighed (prod
 * 2026-10-16: an expired policy uploaded first sank a covered applicant). The
 * applicant's own savings are noted, not scored: IRCC weighs the host's.
 */
function superVisaFinancial(
  state: VriState,
  docs: ReturnType<typeof documentEvidence>,
  notes: string[],
): number {
  const p = state.data.profile;
  let points = 0;

  const income = superVisaIncomeCheck(p);
  if (income.meets === true) {
    points += 40;
    notes.push(
      `Host income ${cad(income.total!)}${income.taxYear ? ` (${income.taxYear} tax year)` : ''} meets the minimum necessary income of ${cad(income.required!)} for a family of ${income.familySize}.`,
    );
  } else if (income.meets === false) {
    notes.push(
      `Host income ${cad(income.total!)} does not meet the minimum necessary income of ${cad(income.required!)} for a family of ${income.familySize}.`,
    );
  } else {
    notes.push(
      `Minimum necessary income not checked: ${income.familySize === null ? "the host's family size" : "the host's income"} is not known yet.`,
    );
  }
  if (income.coSignerIneligible)
    notes.push(
      "The named co-signer is not the host's spouse or common-law partner — IRCC does not count their income.",
    );

  const incomeDocs = docsOfType(docs, ...HOST_INCOME_DOC);
  const readIncome = incomeDocs.filter((d) => d.readable);
  if (readIncome.length > 0) {
    if (income.meets !== false) points += 20;
    notes.push(
      `Host income documented by: ${[...new Set(readIncome.map((d) => d.type))].join(', ')}.`,
    );
  } else if (incomeDocs.some((d) => d.failed)) {
    notes.push(
      `${[...new Set(incomeDocs.filter((d) => d.failed).map((d) => d.type))].join(', ')} uploaded but unreadable — the host's income is NOT documented.`,
    );
  } else {
    notes.push(
      "The host's income is not yet documented (CRA Notice of Assessment or T4 for the tax year).",
    );
  }

  const ins = superVisaInsuranceCheck(p);
  const stay = plannedStay(p);
  const insuranceDocs = docsOfType(docs, /insurance/);
  const policy = choosePolicy(
    insuranceDocs
      .filter((d) => d.readable && Object.keys(d.fields).length > 0)
      .map((d) => readPolicy(d.fields, stay)),
  );
  const insuranceDocIds = new Set(insuranceDocs.map((d) => d.id));
  const expiryResults = (state.data.verifications ?? []).filter(
    (v) =>
      v.document_id !== undefined &&
      insuranceDocIds.has(v.document_id) &&
      v.verification_type === 'expiry',
  );
  const allExpired =
    expiryResults.length > 0 && expiryResults.every((v) => v.result === 'fail');
  const describe = (x: NonNullable<typeof policy>) =>
    [x.insurer, x.policyNumber ? `policy ${x.policyNumber}` : null]
      .filter(Boolean)
      .join(', ') || 'the uploaded policy';

  if (policy && policy.coversStay === true) {
    const short =
      policy.coverageAmount !== null &&
      policy.coverageAmount < SUPER_VISA_MIN_INSURANCE_CAD;
    if (short) {
      notes.push(
        `The uploaded policy (${describe(policy)}) covers the stay but its CAD ${policy.coverageAmount!.toLocaleString('en-US')} cover is below the CAD 100,000 minimum.`,
      );
    } else {
      points += 40;
      notes.push(
        `Medical insurance documented: ${describe(policy)}, ${policy.start ?? '?'} to ${policy.end ?? '?'}, covers the planned stay.`,
      );
    }
    return points;
  }
  if (policy && policy.coversStay === false) {
    notes.push(
      `The uploaded medical insurance (${describe(policy)}, ending ${policy.end ?? 'unknown'}) does not cover the planned stay — a policy valid at least 1 year from entry is required.`,
    );
    for (const problem of ins.problems) notes.push(problem);
    return points;
  }
  if (allExpired) {
    notes.push(
      'The uploaded medical insurance policy has expired or does not cover the trip — a policy valid at least 1 year from entry is required.',
    );
  } else if (ins.meets === true) {
    points += 30;
    notes.push(
      policy
        ? 'Super visa medical insurance meets the published minimum (declared; the uploaded policy dates could not be checked against the stay).'
        : 'Super visa medical insurance meets the published minimum (declared; no policy uploaded yet).',
    );
  }
  for (const problem of ins.problems) notes.push(problem);
  if (ins.meets === null && !allExpired)
    notes.push('Super visa medical insurance not answered yet.');

  return points;
}

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

  if (isSuperVisaRoute(state.data.visaaiId)) {
    const declared = numFacts(p, FUND_KEYS, FUND_EXCLUDE).sort(
      (a, b) => b.value - a.value,
    )[0];
    const points = superVisaFinancial(state, docs, notes);
    if (declared)
      notes.push(
        `Applicant's own funds: ${declared.value.toLocaleString('en-US')} ${currencyOfKey(declared.key, p) ?? '(currency unknown)'} (noted; a super visa is weighed on the host's income).`,
      );
    return {
      scores: { financial_pct: Math.min(points, 100) } as VriState['scores'],
      factorEvidence: { financial_pct: notes },
    };
  }

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

  // Declared funds. A study permit's own answer (CAD) wins over a generic
  // amount whose largest raw number may be in another currency.
  const fundFacts = numFacts(p, FUND_KEYS, FUND_EXCLUDE).sort(
    (a, b) => b.value - a.value,
  );
  const declared =
    (isStudyPermitRoute(state.data.visaaiId)
      ? fundFacts.find((f) => /^(study_funds_available_cad|funds_for_study_cad)$/.test(f.key))
      : undefined) ?? fundFacts[0];
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
  if (isStudyPermitRoute(state.data.visaaiId)) {
    // A study permit has no trip to cost: IRCC's own minimum is one year of
    // living costs for everyone coming plus the first year's tuition still
    // unpaid (2026-10-20 it was weighed as a USD 100-a-day visit).
    score += studyAdequacy(p, best, notes);
  } else if (best !== undefined && days) {
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

/**
 * Points (15, or 8 for at least half) for funds that cover IRCC's study
 * permit minimum. Quebec's amounts (MIFI) and an unknown tuition are noted,
 * not guessed.
 */
function studyAdequacy(
  p: VriState['data']['profile'],
  bestUsd: number | undefined,
  notes: string[],
): number {
  const need = studyFundsNeed(p ?? {});
  const who = `${need.familyMembers} ${need.familyMembers === 1 ? 'person' : 'people'}`;
  if (need.quebec) {
    notes.push(
      'Studies in Quebec: the minimum funds are set by Quebec (MIFI), so funds were not weighed against them.',
    );
    return 0;
  }
  if (need.totalCad === null) {
    notes.push(
      `First-year tuition not known yet — funds could not be weighed against IRCC's minimum (${cad(need.livingCad!)} living costs for ${who}, plus tuition).`,
    );
    return 0;
  }
  const needUsd = toUsd(need.totalCad, 'CAD');
  if (bestUsd === undefined || needUsd === undefined) {
    notes.push(
      `IRCC's minimum: ${cad(need.totalCad)} (${cad(need.livingCad!)} living costs for ${who} + ${cad(need.tuitionDueCad!)} tuition still to pay); funds amount or currency unknown.`,
    );
    return 0;
  }
  const ratio = bestUsd / needUsd;
  notes.push(
    `Funds ≈ USD ${Math.round(bestUsd).toLocaleString('en-US')} vs IRCC's minimum of ${cad(need.totalCad)} (${cad(need.livingCad!)} living costs for ${who} + ${cad(need.tuitionDueCad!)} first-year tuition still to pay) — ${ratio >= 1 ? 'covers' : ratio >= 0.5 ? 'partly covers' : 'does not cover'} it.`,
  );
  return ratio >= 1 ? 15 : ratio >= 0.5 ? 8 : 0;
}
