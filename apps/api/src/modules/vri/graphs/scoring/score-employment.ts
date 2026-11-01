import { isSuperVisaRoute } from '@visaai/types';
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
 *
 * Super visa: the applicant is a parent or grandparent whom the host promises
 * to support; IRCC weighs the host's income, not the applicant's job. A
 * parent who does not work (homemaker, retired without a pension) is
 * therefore UNASSESSED here rather than scored 10 — prod 2026-10-16 (app
 * 61f16bb5) a homemaker mother's readiness was dragged down as if this were
 * a work-tie visitor case. A job or pension still counts, as a tie home.
 */
/** The slot an employment letter lands in: Express Entry calls it proof of work experience. */
const EMPLOYMENT_LETTER = [/employment_letter/, /work_experience/];

/** What a free-text employment answer says, or undefined when unclear. */
function statusKind(
  status: string,
): 'employed' | 'self_employed' | 'not_working' | undefined {
  const s = status.toLowerCase();
  if (!s) return undefined;
  if (/self[\s-]*employ|business owner|proprietor|own (?:a |my )?business/.test(s))
    return 'self_employed';
  if (/\bunemploy|not (?:currently )?(?:employed|working)|homemaker|housewife/.test(s))
    return 'not_working';
  if (/^(?:employed|full[\s-]*time|part[\s-]*time|salaried)\b/.test(s))
    return 'employed';
  return undefined;
}

export async function scoreEmployment(
  state: VriState,
): Promise<Partial<VriState>> {
  const p = state.data.profile;
  const docs = documentEvidence(state.data);
  const notes: string[] = [];

  // Intake's `employed` question ("employed, self-employed, retired or a
  // student?") is often stored as text under one of its aliases —
  // `occupation: "self-employed"` on the Express Entry E2E (prod
  // 2026-10-19) — which no boolean read, so a declared self-employed
  // applicant scored "Not assessed".
  const status =
    strFact(p, [/^employment_status$/, /^occupation$/, /^employed$/]) ?? '';
  const fromStatus = statusKind(status);
  const employed =
    boolFact(p, [/^employed$/, /^is_employed$/, /^currently_employed$/]) ??
    (fromStatus === 'employed'
      ? true
      : fromStatus === 'not_working'
        ? false
        : undefined);
  const selfEmployed =
    boolFact(p, [/^self_employed$/, /^is_self_employed$/, /business_owner/]) ??
    (fromStatus === 'self_employed' ? true : undefined);
  const retired =
    boolFact(p, [/^retired$/, /^is_retired$/]) ??
    (/retired/i.test(status) ? true : undefined);
  const pensionDeclared =
    boolFact(p, [/pension/, /retirement_income/], [/amount|income_/]) ===
      true || numFacts(p, [/pension/, /retirement_income/]).length > 0;

  if (
    isSuperVisaRoute(state.data.visaaiId) &&
    employed !== true &&
    selfEmployed !== true &&
    !(retired === true && pensionDeclared)
  ) {
    return {
      scores: { employment_pct: 0 } as VriState['scores'],
      unassessedFactors: ['employment_pct'],
      factorEvidence: {
        employment_pct: [
          "Super visa: the host's promise of support and income (scored under Financial) stand in for the applicant's own employment, so a parent who does not work is not scored on employment. A job or pension, if any, would count as a tie home.",
        ],
      },
    };
  }

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
    const letters = own(EMPLOYMENT_LETTER);
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
    } else if (own(EMPLOYMENT_LETTER).length) {
      // A reference letter on the business's letterhead is how Express
      // Entry asks a self-employed applicant to prove the work.
      score += 20;
      notes.push('Work experience letter read.');
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
