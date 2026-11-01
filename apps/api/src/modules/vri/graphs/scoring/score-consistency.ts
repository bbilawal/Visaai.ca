import type { VriState } from '../vri.state';
import {
  applicantName,
  compareNames,
  docsOfType,
  documentEvidence,
  parseDate,
  stayFacts,
  str,
  strFact,
} from './evidence';

type Outcome = 'match' | 'mismatch' | 'warning' | 'skip';

/**
 * Consistency across documents and against the applicant's own answers.
 *
 * Before: `(total − 2 × mismatches) / total` over cross_verifications exactly
 * as stored. The stored comparison is a string compare, so "15.06.1961" vs
 * "1961-06-15", "AHMAD MUZAFFAR" vs "MUZAFFAR AHMAD", a misread "June 2025,"
 * date of birth, and a wife's ID card vs the applicant's passport were all
 * "mismatches" — a real case scored 0%.
 *
 * Now each stored comparison is re-checked from its extracted values:
 *   dates   parsed in ISO and DD.MM.YYYY; a value that is not a full date is
 *           extraction noise and is skipped (not a mismatch, not a match);
 *           a difference the cross-check stored as 'warning' counts half
 *   names   order-insensitive token compare: same → match; partly shared →
 *           warning (counts half); nothing shared → a different person's
 *           document or a misread — excluded and listed for review
 * Plus checks the old scorer never ran:
 *   - intake answers vs the readable passport (name, date of birth, number)
 *   - stated stay length vs the planned entry/departure dates
 * No comparisons at all → unassessed (FAKE-002).
 */
export async function scoreConsistency(
  state: VriState,
): Promise<Partial<VriState>> {
  const p = state.data.profile ?? {};
  const notes: string[] = [];
  let match = 0;
  let mismatch = 0;
  let warning = 0;
  let skippedNoise = 0;
  const differentPeople = new Set<string>();

  const tally = (o: Outcome) => {
    if (o === 'match') match++;
    else if (o === 'mismatch') mismatch++;
    else if (o === 'warning') warning++;
  };

  for (const c of state.data.crossVerifications ?? []) {
    const a = c.details_json?.value_a;
    const b = c.details_json?.value_b;
    if (a === undefined || b === undefined) {
      tally(
        c.result === 'match'
          ? 'match'
          : c.result === 'warning'
            ? 'warning'
            : 'mismatch',
      );
      continue;
    }
    if (/date/.test(c.field_compared)) {
      const da = parseDate(a);
      const db = parseDate(b);
      if (!da || !db) {
        skippedNoise++;
        continue;
      }
      if (da.getTime() === db.getTime()) tally('match');
      else if (c.result === 'warning') {
        // The cross-check already judged this pair uncertain — an upload not
        // known to be the applicant's own document (e.g. a relative's ID).
        tally('warning');
        notes.push(
          `${c.field_compared} differs on a document that may not be the applicant's: ${str(a)} vs ${str(b)} — check it is correctly labelled.`,
        );
      } else {
        tally('mismatch');
        notes.push(
          `${c.field_compared} differs across documents: ${str(a)} vs ${str(b)}.`,
        );
      }
    } else if (/name/.test(c.field_compared)) {
      const rel = compareNames(a, b);
      if (rel === 'same') tally('match');
      else if (rel === 'overlap') {
        tally('warning');
        notes.push(
          `Names partly differ: "${str(a)}" vs "${str(b)}" — check this document is the applicant's.`,
        );
      } else if (rel === 'different') {
        differentPeople.add(str(b));
      } else skippedNoise++;
    } else {
      tally(
        c.result === 'match'
          ? 'match'
          : c.result === 'warning'
            ? 'warning'
            : 'mismatch',
      );
    }
  }

  // Intake answers vs the readable passport.
  const passport = docsOfType(documentEvidence(state.data), /passport/).find(
    (d) => d.readable,
  );
  if (passport) {
    const name = applicantName(p);
    if (name && passport.fields.full_name) {
      const rel = compareNames(name, passport.fields.full_name);
      if (rel !== 'unknown')
        tally(
          rel === 'same' ? 'match' : rel === 'overlap' ? 'warning' : 'mismatch',
        );
      if (rel === 'different' || rel === 'overlap')
        notes.push(
          `Name in your answers ("${name}") differs from the passport ("${str(passport.fields.full_name)}").`,
        );
    }
    const dob = parseDate(strFact(p, [/^date_of_birth$/, /^dob$/]));
    const pdob = parseDate(passport.fields.date_of_birth);
    if (dob && pdob) {
      tally(dob.getTime() === pdob.getTime() ? 'match' : 'mismatch');
      if (dob.getTime() !== pdob.getTime())
        notes.push('Date of birth in your answers differs from the passport.');
    }
    const pn = strFact(p, [/^passport_number$/]);
    if (pn && typeof passport.fields.passport_number === 'string') {
      const same =
        pn.replace(/\s/g, '').toUpperCase() ===
        passport.fields.passport_number.replace(/\s/g, '').toUpperCase();
      tally(same ? 'match' : 'mismatch');
      if (!same)
        notes.push(
          'Passport number in your answers differs from the passport.',
        );
    }
  }

  // Stated stay vs dates.
  const { statedDays, datedDays } = stayFacts(p);
  if (statedDays && datedDays) {
    if (Math.abs(statedDays - datedDays) > 3) {
      tally('mismatch');
      notes.push(
        `Stated stay of ${statedDays} days does not match the planned dates (${datedDays} days) — officers check this.`,
      );
    } else tally('match');
  }

  if (differentPeople.size > 0)
    notes.push(
      `Excluded ${differentPeople.size} document name(s) that share nothing with the applicant's (${[...differentPeople].join('; ')}) — likely a relative's/sponsor's document or a misread; review that each is correctly labelled.`,
    );
  if (skippedNoise > 0)
    notes.push(
      `${skippedNoise} comparison(s) skipped: an extracted value was not a usable date/name (OCR noise).`,
    );

  const total = match + mismatch + warning;
  if (total === 0) {
    // FAKE-002: this used to return 100 — a perfect score for a check that
    // never ran. Nothing compared → nothing consistent OR inconsistent. The
    // stored 0 exists only because vri_scores.consistency_pct is `int not null`.
    return {
      scores: { consistency_pct: 0 } as VriState['scores'],
      unassessedFactors: ['consistency_pct'],
      factorEvidence: {
        consistency_pct: [
          'No usable cross-document or answer-vs-document comparison — not assessed.',
          ...notes,
        ],
      },
    };
  }

  notes.unshift(
    `${match} consistent, ${warning} partly consistent, ${mismatch} inconsistent comparison(s).`,
  );
  const pct = Math.max(
    0,
    Math.min(
      100,
      Math.round(((total - mismatch * 2 - warning * 0.5) / total) * 100),
    ),
  );
  return {
    scores: { consistency_pct: pct } as VriState['scores'],
    factorEvidence: { consistency_pct: notes },
  };
}
