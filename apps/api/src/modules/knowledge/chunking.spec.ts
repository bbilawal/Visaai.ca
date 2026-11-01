import {
  chunkSections,
  DEFAULT_CHUNK_OPTIONS,
  estimateTokens,
  headingPrefix,
  splitSentences,
} from './chunking';
import type { ExtractedSection } from './extract/types';

function section(
  partial: Partial<ExtractedSection> & { text: string },
): ExtractedSection {
  return {
    ordinal: 0,
    kind: 'prose',
    headingPath: [],
    charStart: 0,
    charEnd: partial.text.length,
    ...partial,
  };
}

describe('splitSentences', () => {
  it('splits on sentence boundaries', () => {
    expect(
      splitSentences('You must apply online. The fee is 100 CAD.'),
    ).toEqual(['You must apply online.', 'The fee is 100 CAD.']);
  });

  it('does not split on a legal abbreviation', () => {
    // "see Art. 5" split in two puts an article number in a chunk alone.
    expect(
      splitSentences(
        'See Art. 5 of the regulation. It applies to all applicants.',
      ),
    ).toEqual([
      'See Art. 5 of the regulation.',
      'It applies to all applicants.',
    ]);
  });

  it('does not split on a numbered list marker', () => {
    expect(
      splitSentences('Provide the following: 1. a passport 2. a photograph'),
    ).toHaveLength(1);
  });

  it('does not split on an initial', () => {
    expect(
      splitSentences('Signed by J. Smith. The decision is final.'),
    ).toEqual(['Signed by J. Smith.', 'The decision is final.']);
  });
});

describe('headingPrefix', () => {
  it('renders the path as a breadcrumb', () => {
    expect(headingPrefix(['Standard Visitor', 'Fees'])).toBe(
      'Standard Visitor > Fees\n',
    );
  });

  it('is empty for a document with no headings', () => {
    expect(headingPrefix([])).toBe('');
    expect(headingPrefix(['', '  '])).toBe('');
  });
});

describe('chunkSections', () => {
  it('never merges content across a heading boundary', () => {
    // The bug this prevents: "Documents you must provide" and "Documents you
    // do NOT need" ending up in the same chunk, so a retrieval hit says both.
    const sections: ExtractedSection[] = [
      section({
        ordinal: 0,
        kind: 'heading',
        text: 'Documents you must provide',
        headingLevel: 2,
      }),
      section({
        ordinal: 1,
        kind: 'checklist',
        headingPath: ['Documents you must provide'],
        text: '• Passport\n• Bank statements',
      }),
      section({
        ordinal: 2,
        kind: 'heading',
        text: 'Documents you do not need',
        headingLevel: 2,
      }),
      section({
        ordinal: 3,
        kind: 'checklist',
        headingPath: ['Documents you do not need'],
        text: '• Tax returns',
      }),
    ];

    const chunks = chunkSections(sections);
    const combined = chunks.find(
      (c) =>
        c.text.includes('Bank statements') && c.text.includes('Tax returns'),
    );
    expect(combined).toBeUndefined();
    expect(chunks.every((c) => c.headingPath.length <= 1)).toBe(true);
  });

  it('prefixes every chunk with its heading path', () => {
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'prose',
        headingPath: ['Visitor visa', 'Fees'],
        text: 'The fee is 100 CAD.',
      }),
    ]);
    expect(chunks[0].text).toBe('Visitor visa > Fees\nThe fee is 100 CAD.');
  });

  it('does not emit headings as chunks of their own', () => {
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'heading',
        text: 'Eligibility',
        headingLevel: 2,
      }),
    ]);
    expect(chunks).toHaveLength(0);
  });

  it('splits a long list by whole items, never mid-item', () => {
    const items = Array.from(
      { length: 60 },
      (_, i) => `• Requirement number ${i} with some explanatory text`,
    );
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'list',
        headingPath: ['Documents'],
        text: items.join('\n'),
      }),
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const bullets = c.text.split('\n').filter((l) => l.startsWith('•'));
      for (const b of bullets)
        expect(b).toMatch(
          /^• Requirement number \d+ with some explanatory text$/,
        );
    }
  });

  it('repeats a table header on every piece of a split table', () => {
    // Long enough that the table exceeds targetChars and must split; a table
    // that fits keeps its header too, which the next test covers.
    const rows = Array.from(
      { length: 120 },
      (_, i) => `Visa: subclass type ${i} | Fee: ${100 + i} GBP`,
    );
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'table',
        headingPath: ['Fees'],
        tableHeader: ['Visa', 'Fee'],
        text: rows.join('\n'),
      }),
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    // Without this, a fee lands in a chunk with no indication of which visa.
    for (const c of chunks) expect(c.text).toContain('Visa | Fee');
  });

  it('carries the table header on a table small enough not to split', () => {
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'table',
        headingPath: ['Fees'],
        tableHeader: ['Visa', 'Fee'],
        text: 'Visa: Standard Visitor | Fee: 115 GBP',
      }),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('Visa | Fee');
  });

  it('merges consecutive small sections under the same heading', () => {
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'prose',
        headingPath: ['Eligibility'],
        text: 'You must be 18 or over.',
      }),
      section({
        ordinal: 1,
        kind: 'prose',
        headingPath: ['Eligibility'],
        text: 'You must hold a valid passport.',
      }),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('18 or over');
    expect(chunks[0].text).toContain('valid passport');
  });

  it('never merges a table into prose — the header would be lost', () => {
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'prose',
        headingPath: ['Fees'],
        text: 'Fees are listed below.',
      }),
      section({
        ordinal: 1,
        kind: 'table',
        headingPath: ['Fees'],
        tableHeader: ['Visa', 'Fee'],
        text: 'Visa: A | Fee: 10',
      }),
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].tableHeader).toEqual(['Visa', 'Fee']);
  });

  it('splits oversized prose on sentence boundaries with sentence overlap', () => {
    const sentence =
      'The applicant must submit evidence of sufficient funds for the whole stay. ';
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'prose',
        headingPath: ['Funds'],
        text: sentence.repeat(40),
      }),
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(
        DEFAULT_CHUNK_OPTIONS.maxChars + 200,
      );
      // No chunk ends mid-sentence.
      expect(c.text.trimEnd().endsWith('.')).toBe(true);
    }
  });

  it('carries the page number onto every chunk', () => {
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'prose',
        headingPath: ['Fees'],
        pageNumber: 42,
        text: 'Fee is 100.',
      }),
    ]);
    expect(chunks[0].pageNumber).toBe(42);
  });

  it('does not merge sections from different pages', () => {
    const chunks = chunkSections([
      section({
        ordinal: 0,
        kind: 'prose',
        headingPath: ['A'],
        pageNumber: 1,
        text: 'One.',
      }),
      section({
        ordinal: 1,
        kind: 'prose',
        headingPath: ['A'],
        pageNumber: 2,
        text: 'Two.',
      }),
    ]);
    expect(chunks).toHaveLength(2);
  });

  it('is deterministic', () => {
    const sections = [
      section({
        ordinal: 0,
        kind: 'prose',
        headingPath: ['X'],
        text: 'a '.repeat(900),
      }),
    ];
    expect(chunkSections(sections)).toEqual(chunkSections(sections));
  });
});

describe('estimateTokens', () => {
  it('is roughly a quarter of the character count', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });
});
