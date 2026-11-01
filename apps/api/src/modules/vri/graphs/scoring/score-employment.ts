import type { VriState } from '../vri.state';
import {
  asNumber,
  boolFact,
  docsOfType,
  documentEvidence,
  isAboutApplicant,
  numFacts,
  str,
  strFact,
} from './evidence';

/**
 * The APPLICANT's employment / economic activity.
 *
 * Before: +40 `employed`, +35 `self_employed`, +35 any employment_letter with
 * OCR complete, +25 any pay_stubs — file presence, whoever the letter was
 * about. A sponsor son's employment letter raised the PARENT's employment
 * score, and a retiree scored 0% for not having a job.
 *
 * Now:
 *   employed       45 declared, +35 own readable employment letter,
 *                  +20 own readable pay stub / tax document
 *   self-employed  40 declared, +30 business document, +30 tax document
 *   retired        60 pension declared, 90 pension documented;
 *                  no pension info → UNASSESSED (employment does not apply)
 *   not working    10
 * A document whose holder name does not match the applicant is not counted
 * (it is someone else's — e.g. a sponsor's — and is noted as such).
 */
export async function scoreEmployment(
  state: VriState,
): Promise<Partial<VriState>> {
  const p = state.data.profile;
  const docs = documentEvidence(state.data);
  const notes: string[] = [];

  const employed = boolFact(p, [
    /^employed$/,
    /^is_employed$/,
    /^currently_employed$/,
  ]);
  const selfEmployed = boolFact(p, [
    /^self_employed$/,
    /^is_self_employed$/,
    /business_owner/,
  ]);
  const status = strFact(p, [/^employment_status$/, /^occupation$/]) ?? '';
  const retired =
    boolFact(p, [/^retired$/, /^is_retired$/]) ??
    (/retired/i.test(status) ? true : undefined);
  const pensionDeclared =
    boolFact(p, [/pension/, /retirement_income/], [/amount|income_/]) ===
      true || numFacts(p, [/pension/, /retirement_income/]).length > 0;

  const own = (types: RegExp[]) => {
    const ds = docsOfType(docs, ...types);
    for (const d of ds) {
      if (d.failed)
        notes.push(`${d.type} uploaded but unreadable — not assessed.`);
      else if (d.readable && isAboutApplicant(d, p) === false)
        notes.push(
          `${d.type} is about someone else (${str(d.fields.full_name ?? d.fields.employee_name) || 'another person'}) — counted as sponsor evidence, not the applicant's employment.`,
        );
    }
    return ds.filter((d) => d.readable && isAboutApplicant(d, p) !== false);
  };

  let score: number | undefined;

  if (employed === true) {
    score = 45;
    notes.unshift('Employed (declared).');
    const letters = own([/employment_letter/]);
    if (letters.length) {
      score += 35;
      const l = letters[0].fields;
      notes.push(
        `Employment letter read: ${[str(l.employer), str(l.job_title)].filter(Boolean).join(', ') || 'employer details present'}${asNumber(l.annual_income) ? `, income ${str(l.annual_income)}` : ''}.`,
      );
    }
    if (own([/pay_?stub/, /payslip/, /tax_return/, /^noa/]).length) {
      score += 20;
      notes.push('Pay stub / tax document read.');
    }
  } else if (selfEmployed === true) {
    score = 40;
    notes.unshift('Self-employed (declared).');
    if (own([/business/, /registration/, /incorporation/]).length) {
      score += 30;
      notes.push('Business registration document read.');
    }
    if (own([/tax_return/, /^noa/]).length) {
      score += 30;
      notes.push('Tax document read.');
    }
  } else if (retired === true) {
    if (pensionDeclared) {
      const pensionDocs = own([/pension/, /retirement/]);
      score = pensionDocs.length ? 90 : 60;
      notes.unshift(
        `Retired with pension / retirement income ${pensionDocs.length ? 'documented' : 'declared (not documented)'}.`,
      );
    } else {
      own([/employment_letter/, /pay_?stub/]); // note sponsor letters
      return {
        scores: { employment_pct: 0 } as VriState['scores'],
        unassessedFactors: ['employment_pct'],
        factorEvidence: {
          employment_pct: [
            'Applicant is retired — employment does not apply, and no pension or retirement income was declared, so this factor was not assessed.',
            ...notes,
          ],
        },
      };
    }
  } else if (employed === false) {
    score = 10;
    notes.unshift('Not currently employed (declared).');
    own([/employment_letter/, /pay_?stub/]);
  }

  if (score === undefined) {
    return {
      scores: { employment_pct: 0 } as VriState['scores'],
      unassessedFactors: ['employment_pct'],
      factorEvidence: {
        employment_pct: [
          'Employment status was not provided — not assessed.',
          ...notes,
        ],
      },
    };
  }

  return {
    scores: { employment_pct: Math.min(score, 100) } as VriState['scores'],
    factorEvidence: { employment_pct: notes },
  };
}
