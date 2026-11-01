import { assertFixtureIsSafe } from '../eval-harness';
import { DOCUMENT_CLASSIFICATION_CASES } from './document-classification';
import { FIELD_EXTRACTION_CASES } from './field-extraction';

/**
 * Guards the fixture sets themselves.
 *
 * A fixture set is the only thing standing between "we measured this task" and
 * "we assumed it was fine", so the sets have their own invariants — and the
 * safety check is not optional, because these tasks run over identity documents
 * and a fixture file ends up in CI logs.
 */
const SETS = [
  ['document_classification', DOCUMENT_CLASSIFICATION_CASES],
  ['field_extraction', FIELD_EXTRACTION_CASES],
] as const;

describe('eval fixtures', () => {
  it.each(SETS)('%s contains no real personal data', (label, cases) => {
    expect(() => assertFixtureIsSafe(cases as never, label)).not.toThrow();
  });

  it.each(SETS)('%s has unique case ids', (_label, cases) => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SETS)('%s states why every case exists', (_label, cases) => {
    // A case with no rationale is a case nobody can judge the removal of.
    for (const c of cases) {
      expect(c.rationale.length).toBeGreaterThan(20);
    }
  });

  it.each(SETS)(
    '%s is large enough for its threshold to mean something',
    (_label, cases) => {
      // document_classification needs 0.95. With fewer than 10 cases a single
      // failure drops the rate below any threshold, so the eval would measure
      // noise rather than quality.
      expect(cases.length).toBeGreaterThanOrEqual(10);
    },
  );

  it('document_classification includes the confusion pairs, not just clean cases', () => {
    // A set of only easy cases makes every tier pass and the recommendation
    // meaningless. These are the pairs that actually separate tiers.
    const ids = DOCUMENT_CLASSIFICATION_CASES.map((c) => c.id);
    expect(ids).toContain('payslip-not-employment-letter');
    expect(ids).toContain('bank-letter-not-statement');
    expect(ids).toContain('national-id-not-passport');
  });

  it('document_classification includes cases where the answer is "unknown"', () => {
    // A classifier that forces every input into the nearest label marks a
    // checklist item satisfied by a parking ticket.
    const unknowns = DOCUMENT_CLASSIFICATION_CASES.filter(
      (c) => c.expected === 'unknown',
    );
    expect(unknowns.length).toBeGreaterThanOrEqual(2);
  });

  it('field_extraction includes a case where a field is genuinely absent', () => {
    // Extracting a value that is not on the document is the failure that
    // matters: it puts an invented date into an applicant's profile.
    // `expected` now carries the document type alongside the field map, so the
    // nulls live one level down — under the key set PRODUCTION actually asks
    // for, rather than a shape invented for the eval.
    const withNulls = FIELD_EXTRACTION_CASES.filter((c) =>
      Object.values(
        (c.expected as unknown as { expected: Record<string, unknown> })
          .expected,
      ).some((v) => v === null),
    );
    expect(withNulls.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a fixture set that smuggles in real data', () => {
    // Proves the guard works, rather than trusting that it does.
    expect(() =>
      assertFixtureIsSafe(
        [
          {
            id: 'leak',
            input: 'contact alex@gmail.com about account 4539148803436467',
            expected: 'x',
            rationale: 'deliberately unsafe, to prove the guard fires',
          },
        ],
        'unsafe',
      ),
    ).toThrow();
  });
});
