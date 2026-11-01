import { diffVersions, similarity } from './version-diff';

describe('similarity', () => {
  it('is high for a reworded sentence and low for an unrelated one', () => {
    const a = 'You must have a valid passport for the whole of your stay';
    expect(
      similarity(
        a,
        'You must hold a valid passport for the whole of your stay',
      ),
    ).toBeGreaterThan(0.6);
    expect(similarity(a, 'The application fee is not refundable')).toBeLessThan(
      0.2,
    );
  });
});

describe('diffVersions', () => {
  it('reports a whitespace-only change as identical', () => {
    const before = 'You must have a passport.\nThe fee is 100 CAD.';
    const after = '  You must have a passport.  \n\n\nThe fee is 100 CAD.  ';
    const d = diffVersions(before, after);
    expect(d.identical).toBe(true);
    expect(d.suggestedClassification).toBe('cosmetic');
  });

  it('classifies a fee change as material and names both figures', () => {
    const d = diffVersions(
      'The application fee is 100 CAD.',
      'The application fee is 110 CAD.',
    );
    expect(d.suggestedClassification).toBe('material');
    expect(d.amountChanges).toContainEqual(
      expect.objectContaining({ before: '100 CAD', after: '110 CAD' }),
    );
  });

  it('classifies a processing-time change as material', () => {
    const d = diffVersions(
      'Processing takes 14 days.',
      'Processing takes 28 days.',
    );
    expect(d.suggestedClassification).toBe('material');
    expect(d.durationChanges).toContainEqual(
      expect.objectContaining({ before: '14 days', after: '28 days' }),
    );
  });

  it('flags a withdrawn form code', () => {
    const d = diffVersions(
      'Complete IMM 5257 and IMM 5645.',
      'Complete IMM 5257.',
    );
    expect(d.formCodesRemoved).toContain('IMM 5645');
    expect(d.suggestedClassification).toBe('material');
  });

  it('flags a removed requirement line', () => {
    const before =
      'You must provide bank statements.\nYou must provide a photograph.';
    const after = 'You must provide a photograph.';
    const d = diffVersions(before, after);
    expect(d.requirementsRemoved).toContain(
      'You must provide bank statements.',
    );
    expect(d.suggestedClassification).toBe('material');
  });

  it('treats a reword with no figure change as editorial', () => {
    const d = diffVersions(
      'You must have a valid passport for the whole of your stay in the country.',
      'You must hold a valid passport for the whole of your stay in the country.',
    );
    expect(d.suggestedClassification).toBe('editorial');
    expect(d.changedLines).toHaveLength(1);
  });

  it('calls a wholesale rewrite structural', () => {
    const before = Array.from(
      { length: 20 },
      (_, i) => `Original line ${i} of guidance text.`,
    ).join('\n');
    const after = Array.from(
      { length: 20 },
      (_, i) => `Completely different content ${i} here.`,
    ).join('\n');
    const d = diffVersions(before, after);
    expect(d.suggestedClassification).toBe('structural');
    expect(d.reasons[0]).toMatch(/restructured|replaced/);
  });

  it('does not report a fee that only moved rows', () => {
    const before = 'Visitor: 100 CAD\nStudent: 150 CAD';
    const after = 'Student: 150 CAD\nVisitor: 100 CAD';
    const d = diffVersions(before, after);
    expect(d.amountChanges).toHaveLength(0);
  });

  it('normalises formatting so £1,000.00 and £1000 are one figure', () => {
    const d = diffVersions('The fee is £1,000.00.', 'The fee is £1000.');
    expect(d.amountChanges).toHaveLength(0);
  });

  it('gives an operator reasons, not just a verdict', () => {
    const d = diffVersions('Fee 100 GBP. You must provide X.', 'Fee 120 GBP.');
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.reasons.join(' ')).toMatch(/monetary|requirement/);
  });
});
