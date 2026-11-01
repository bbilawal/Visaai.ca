import type { VriState } from '../vri.state';
import { boolFact, refusalFacts } from './evidence';

const RECENT_MS = 2 * 365 * 86_400_000;

/**
 * Travel history AND immigration history.
 *
 * Before: `min(30 + 14 × countries, 100)` from `travel_history_countries`
 * alone — a missing key and an empty list both scored 30, and a visa refusal
 * (the single strongest adverse fact an officer sees) was never read.
 *
 * Now:
 *   base     30 + 14 per country visited (cap 100) when travel history is known
 *   refusal  × 0.5 if refused within 2 years, × 0.75 if older
 *   other refusals × 0.8;  immigration violation / removal order → cap 10
 * Travel unknown but a refusal on file → scored from the refusal alone.
 * Neither known → unassessed.
 */
export async function scoreTravelHistory(
  state: VriState,
): Promise<Partial<VriState>> {
  const p = state.data.profile;
  const notes: string[] = [];

  const raw =
    p.travel_history_countries ??
    p.countries_visited ??
    p.previous_travel_countries;
  let count: number | undefined;
  if (Array.isArray(raw))
    count = raw.filter((x) => x && String(x).trim()).length;
  else if (typeof raw === 'string')
    count = raw.trim() ? raw.split(/[,;]/).filter((s) => s.trim()).length : 0;
  else {
    const hasTravel = boolFact(p, [
      /^has_prior_travel$/,
      /travel(l)?ed_abroad/,
      /has_travel_history/,
    ]);
    if (hasTravel === false) count = 0;
  }

  const r = refusalFacts(p);

  if (count === undefined && r.priorRefusal !== true && !r.violations) {
    return {
      scores: { travel_history_pct: 0 } as VriState['scores'],
      unassessedFactors: ['travel_history_pct'],
      factorEvidence: {
        travel_history_pct: [
          'Travel history and refusal history were not provided — not assessed.',
        ],
      },
    };
  }

  const recent = r.date ? Date.now() - r.date.getTime() < RECENT_MS : true;
  let score: number;
  if (count !== undefined) {
    score = Math.min(30 + count * 14, 100);
    notes.push(
      count === 0
        ? 'No prior international travel declared — no compliance record with other visas.'
        : `${count} countr${count === 1 ? 'y' : 'ies'} previously visited.`,
    );
  } else {
    score = 50;
    notes.push('Travel history not provided.');
  }

  if (r.priorRefusal === true) {
    score *= recent ? 0.5 : 0.75;
    notes.push(
      `Prior visa refusal${r.date ? ` on ${r.date.toISOString().slice(0, 10)}` : ''}${recent ? ' (within the last 2 years)' : ''}` +
        (r.reason ? `: ${r.reason}` : '') +
        '.',
    );
  } else if (r.priorRefusal === false) {
    notes.push('No prior visa refusal declared.');
  }
  if (r.otherRefusal === true) {
    score *= 0.8;
    notes.push('Other visa or entry refusals declared.');
  }
  if (r.violations) {
    score = Math.min(score, 10);
    notes.push('Immigration violation / removal order / overstay declared.');
  }

  return {
    scores: { travel_history_pct: Math.round(score) } as VriState['scores'],
    factorEvidence: { travel_history_pct: notes },
  };
}
