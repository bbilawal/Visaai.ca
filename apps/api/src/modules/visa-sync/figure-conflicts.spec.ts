import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  findFigureConflicts,
  destinationOf,
  conflictKey,
  type ExtractionFile,
} from './figure-conflicts';

/**
 * The Swedish maintenance amounts are published twice by the same authority,
 * under two different years. Each extraction is individually correct and each
 * excerpt verifies, so no per-file check can see it - the contradiction exists
 * only between files.
 *
 * These tests pin both the detector's rules and the real conflict it found, so
 * the conflict cannot quietly disappear from the data without someone deciding
 * it should.
 */

const DIR = join(__dirname, '../../../../../data/requirements');

function realFiles(): ExtractionFile[] {
  return (
    readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const doc = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
        return {
          file: f,
          visaai_id: doc.visaai_id,
          requirements: doc.requirements ?? [],
        };
      })
      // Anything without a visaai_id is not an extraction. The allowlist file
      // originally lived in this directory and every *.json loader swallowed it.
      .filter((d) => typeof d.visaai_id === 'string')
  );
}

const file = (
  name: string,
  visaai_id: string,
  parameters: Record<string, unknown>,
): ExtractionFile => ({
  file: name,
  visaai_id,
  requirements: [{ requirement_code: 'r', parameters }],
});

describe('destinationOf', () => {
  it('takes the segment before the first dash', () => {
    expect(destinationOf('se-eu-blue-card')).toBe('se');
    expect(destinationOf('nl-partner-residence-permit')).toBe('nl');
  });

  it('handles an id with no dash rather than returning empty', () => {
    expect(destinationOf('se')).toBe('se');
  });
});

describe('findFigureConflicts', () => {
  it('flags the same figure stored under two different years', () => {
    const conflicts = findFigureConflicts([
      file('a.json', 'se-one', {
        per_month_sek: 6243,
        currency: 'SEK',
        stated_for_year: 2025,
      }),
      file('b.json', 'se-two', {
        per_month_sek: 6243,
        currency: 'SEK',
        stated_for_year: 2026,
      }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].value).toBe(6243);
    expect(conflicts[0].sides.map((s) => s.qualifierValue).sort()).toEqual([
      '2025',
      '2026',
    ]);
  });

  it('stays silent when both sides agree on the year', () => {
    // The healthy case: one figure restated consistently across two routes.
    expect(
      findFigureConflicts([
        file('a.json', 'se-one', {
          per_month_sek: 6243,
          currency: 'SEK',
          stated_for_year: 2026,
        }),
        file('b.json', 'se-two', {
          per_month_sek: 6243,
          currency: 'SEK',
          stated_for_year: 2026,
        }),
      ]),
    ).toEqual([]);
  });

  it('does not flag two countries that happen to share a number', () => {
    // Coincidence across destinations would bury the real signal in noise.
    expect(
      findFigureConflicts([
        file('a.json', 'se-one', {
          amount: 2000,
          currency: 'SEK',
          stated_for_year: 2025,
        }),
        file('b.json', 'no-one', {
          amount: 2000,
          currency: 'NOK',
          stated_for_year: 2026,
        }),
      ]),
    ).toEqual([]);
  });

  it('does not treat a missing qualifier as disagreement', () => {
    // Most figures carry no year. Demanding one everywhere makes this a style
    // checker instead of a contradiction detector.
    expect(
      findFigureConflicts([
        file('a.json', 'se-one', {
          per_month_sek: 6243,
          currency: 'SEK',
          stated_for_year: 2025,
        }),
        file('b.json', 'se-two', { per_month_sek: 6243, currency: 'SEK' }),
      ]),
    ).toEqual([]);
  });

  it('does not compare the qualifier against itself', () => {
    // stated_for_year is a date, not an amount; treating it as a figure would
    // make every pair of differently-dated files conflict with itself.
    const conflicts = findFigureConflicts([
      file('a.json', 'se-one', { stated_for_year: 2025 }),
      file('b.json', 'se-two', { stated_for_year: 2026 }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it('recognises a disagreement between different qualifier kinds', () => {
    const conflicts = findFigureConflicts([
      file('a.json', 'se-one', { per_month_sek: 100, stated_for_year: 2025 }),
      file('b.json', 'se-two', {
        per_month_sek: 100,
        in_force_since: '2026-07-15',
      }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sides.map((s) => s.qualifier).sort()).toEqual([
      'in_force_since',
      'stated_for_year',
    ]);
  });

  it('gives a conflict a stable key for allowlisting', () => {
    const [c] = findFigureConflicts([
      file('a.json', 'se-one', { per_month_sek: 6243, stated_for_year: 2025 }),
      file('b.json', 'se-two', { per_month_sek: 6243, stated_for_year: 2026 }),
    ]);
    expect(conflictKey(c)).toBe('se:per_month_sek:6243');
  });
});

describe('findFigureConflicts over the real extraction files', () => {
  it('finds extraction files to check', () => {
    // Guards the guard: a wrong path makes the assertions below vacuous.
    expect(realFiles().length).toBeGreaterThan(30);
  });

  it('still reports the Swedish maintenance-amount conflict', () => {
    // Migrationsverket dates these six amounts to 2025 on the EU Blue Card page
    // and to 2026 on its maintenance page. This asserts our data still carries
    // the disagreement, so it cannot vanish without a deliberate re-extraction.
    const swedish = findFigureConflicts(realFiles()).filter(
      (c) => c.destination === 'se',
    );
    expect(swedish.length).toBeGreaterThanOrEqual(6);

    const single = swedish.find(
      (c) => c.parameterKey === 'per_month_single_adult_sek',
    );
    expect(single).toBeDefined();
    expect(single!.value).toBe(6243);
    expect(
      [...new Set(single!.sides.map((s) => s.qualifierValue))].sort(),
    ).toEqual(['2025', '2026']);
  });

  it('reports no conflict outside Sweden', () => {
    // If this ever fails, a NEW cross-source contradiction has appeared and the
    // failure is the point - investigate it before allowlisting it.
    const others = findFigureConflicts(realFiles()).filter(
      (c) => c.destination !== 'se',
    );
    expect(others).toEqual([]);
  });
});
