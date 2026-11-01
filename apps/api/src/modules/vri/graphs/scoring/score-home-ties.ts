import type { VriState } from '../vri.state';
import {
  boolFact,
  docsOfType,
  documentEvidence,
  isAboutApplicant,
  numFacts,
  refusalFacts,
  strFact,
  type DocEvidence,
} from './evidence';

/** A tie the applicant only declared counts for this share of its points; a
 *  tie backed by a readable document counts in full. */
const DECLARED_ONLY = 0.7;

/**
 * Ties to the home country — the ground most visitor refusals cite
 * (Canada IRPR 179(b), UK V 4.2, US 214(b)).
 *
 * Before: read `has_property`, `employed`, `has_family_in_home_country`,
 * `married`, `has_dependents` only. Real intake profiles use keys like
 * `family_home_owned` / `spouse_in_home_country`, so an applicant with two
 * properties, a wife and a son at home scored 0%.
 *
 * Points (max 100), each × 0.7 unless a readable document backs it:
 *   25 property owned (+5 additional property)   doc: property deed/title
 *   25 spouse remains in the home country        doc: marriage certificate
 *       (10 if only "married" is known)
 *   15 children / dependants remain at home      doc: birth cert / family register
 *   20 employment, business or pension at home   doc: applicant's own employment letter / pension
 *   10 other family ties outside the destination
 *  −10 immediate family living in the destination (a counter-pull officers weigh)
 * No tie answered at all → unassessed.
 */
export async function scoreHomeTies(
  state: VriState,
): Promise<Partial<VriState>> {
  const p = state.data.profile;
  const docs = documentEvidence(state.data);
  const notes: string[] = [];
  let score = 0;
  let answered = 0;

  const backing = (tie: string, types: RegExp[], aboutApplicant = false) => {
    const ds = docsOfType(docs, ...types);
    const ok = ds.some(
      (d: DocEvidence) =>
        d.readable && (!aboutApplicant || isAboutApplicant(d, p) !== false),
    );
    const failed = ds.filter((d) => d.failed).map((d) => d.type);
    if (ok) notes.push(`${tie}: documented.`);
    else if (failed.length)
      notes.push(
        `${tie}: declared; supporting ${failed.join(', ')} unreadable — not documented.`,
      );
    else notes.push(`${tie}: declared only — not documented.`);
    return ok ? 1 : DECLARED_ONLY;
  };

  const property = boolFact(
    p,
    [
      /^has_property$/,
      /(home|house|property|land|flat|apartment)_owned$/,
      /^owns?_(home|house|property|land)/,
      /property_ownership/,
    ],
    [/additional|second/],
  );
  const extraProperty = boolFact(p, [
    /additional_property_owned/,
    /second_property/,
    /other_property_owned/,
  ]);
  if (property !== undefined) answered++;
  if (property === true) {
    const m = backing('Property owned', [
      /property/,
      /deed/,
      /title/,
      /land_record/,
    ]);
    score += 25 * m;
    if (extraProperty === true) score += 5 * m;
  }

  const spouseHome = boolFact(p, [
    /spouse_in_home_country/,
    /(spouse|wife|husband)_(remains|staying|lives)_?(in_)?home/,
    /(wife|husband)_in_home_country/,
  ]);
  const married =
    boolFact(p, [/^married$/, /^is_married$/]) ??
    (/married/i.test(strFact(p, [/marital_status/]) ?? '') ? true : undefined);
  if (spouseHome !== undefined || married !== undefined) answered++;
  if (spouseHome === true) {
    score +=
      25 * backing('Spouse remains in the home country', [/marriage/, /nikah/]);
  } else if (married === true && spouseHome === undefined) {
    score +=
      10 *
      backing('Married (whether the spouse stays home is unknown)', [
        /marriage/,
        /nikah/,
      ]);
  }

  const childrenHome = boolFact(p, [
    /(son|daughter|child|children|dependents?|dependants?)_in_home_country/,
    /^has_dependents$/,
    /^has_dependants$/,
  ]);
  if (childrenHome !== undefined) answered++;
  if (childrenHome === true)
    score +=
      15 *
      backing('Children / dependants remain at home', [
        /birth_cert/,
        /family_reg/,
        /frc/,
      ]);

  const employed = boolFact(p, [
    /^employed$/,
    /^is_employed$/,
    /^currently_employed$/,
  ]);
  const selfEmployed = boolFact(p, [/^self_employed$/, /business_owner/]);
  const pension =
    boolFact(p, [/pension/, /retirement_income/], [/amount|income_/]) ??
    (numFacts(p, [/pension/, /retirement_income/]).length > 0
      ? true
      : undefined);
  if (
    employed !== undefined ||
    selfEmployed !== undefined ||
    pension !== undefined
  )
    answered++;
  if (employed === true || selfEmployed === true || pension === true) {
    score +=
      20 *
      backing(
        pension === true && !employed && !selfEmployed
          ? 'Pension at home'
          : 'Employment / business at home',
        [/employment_letter/, /pay_?stub/, /business/, /pension/, /tax_return/],
        true,
      );
  } else if (boolFact(p, [/^retired$/]) === true) {
    notes.push(
      'Retired with no pension or retirement income declared — no economic tie counted.',
    );
  }

  const otherFamily = boolFact(p, [
    /family_ties_outside/,
    /has_family_in_home_country/,
    /parents_in_home_country/,
    /siblings_in_home_country/,
  ]);
  if (otherFamily !== undefined) answered++;
  if (otherFamily === true)
    score += 10 * backing('Other family ties outside the destination', []);

  // A previous refusal that already found these ties insufficient (e.g. IRPR
  // 179(b)) is not answered by repeating the same declarations: until at
  // least one tie is backed by a readable document, the declared ties are
  // discounted by a further 25%.
  const refusal = refusalFacts(p);
  const anyDocumented = notes.some((n) => n.endsWith(': documented.'));
  if (
    refusal.priorRefusal === true &&
    refusal.grounds.includes('home_ties') &&
    score > 0
  ) {
    if (!anyDocumented) {
      score *= 0.75;
      notes.push(
        'A previous refusal already found home ties insufficient, and none of the ties is documented yet — declared ties discounted.',
      );
    } else {
      notes.push(
        'A previous refusal cited home ties — documented ties now answer part of that ground.',
      );
    }
  }

  const familyInDest = boolFact(p, [
    /^family_in_destination$/,
    /immediate_family_in_destination/,
    /children_in_destination/,
  ]);
  if (familyInDest === true) {
    score -= 10;
    notes.push(
      'Immediate family lives in the destination — a counter-pull the officer will weigh against the home ties.',
    );
  }

  if (answered === 0) {
    return {
      scores: { home_ties_pct: 0 } as VriState['scores'],
      unassessedFactors: ['home_ties_pct'],
      factorEvidence: {
        home_ties_pct: [
          'No property, family, employment or pension ties were answered — not assessed.',
        ],
      },
    };
  }

  return {
    scores: {
      home_ties_pct: Math.max(0, Math.min(100, Math.round(score))),
    } as VriState['scores'],
    factorEvidence: { home_ties_pct: notes },
  };
}
