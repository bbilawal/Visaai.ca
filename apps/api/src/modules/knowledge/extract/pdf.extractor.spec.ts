import {
  groupIntoLines,
  looksLikeListItem,
  medianFontSize,
  mergeProseLines,
} from './pdf.extractor';

/** pdfjs emits positioned fragments; transform[3] is the font size, [4]/[5] are x/y. */
const item = (str: string, x: number, y: number, size = 10) => ({
  str,
  transform: [size, 0, 0, size, x, y],
});

describe('groupIntoLines', () => {
  it('reassembles a sentence emitted as several fragments', () => {
    // Without this, every chunk reads like a ransom note and embeds accordingly.
    const lines = groupIntoLines([
      item('You must ', 50, 700),
      item('have a valid ', 100, 700),
      item('passport.', 160, 700),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('You must');
    expect(lines[0].text).toContain('passport');
  });

  it('separates fragments on different baselines', () => {
    const lines = groupIntoLines([
      item('First line', 50, 700),
      item('Second line', 50, 680),
    ]);
    expect(lines).toHaveLength(2);
  });

  it('tolerates a small baseline wobble within one line', () => {
    const lines = groupIntoLines([
      item('Same', 50, 700),
      item('line', 90, 700.5),
    ]);
    expect(lines).toHaveLength(1);
  });
});

describe('medianFontSize', () => {
  it('returns the body size, not the heading size', () => {
    const lines = [
      { text: 'Heading', y: 700, fontSize: 20 },
      { text: 'body', y: 680, fontSize: 10 },
      { text: 'body', y: 660, fontSize: 10 },
      { text: 'body', y: 640, fontSize: 10 },
    ];
    expect(medianFontSize(lines)).toBe(10);
  });

  it('returns 0 for no lines rather than NaN', () => {
    expect(medianFontSize([])).toBe(0);
  });
});

describe('looksLikeListItem', () => {
  it('recognises the bullet and numbering styles government PDFs use', () => {
    expect(looksLikeListItem('• passport')).toBe(true);
    expect(looksLikeListItem('(a) proof of funds')).toBe(true);
    expect(looksLikeListItem('1. photograph')).toBe(true);
    expect(looksLikeListItem('- itinerary')).toBe(true);
    expect(looksLikeListItem('You must provide a passport.')).toBe(false);
  });
});

describe('mergeProseLines', () => {
  const line = (
    text: string,
    page = 1,
    kind = 'prose',
    headingPath: string[] = [],
  ) => ({
    kind,
    headingPath,
    pageNumber: page,
    text,
  });

  it('joins wrapped lines into a paragraph', () => {
    const out = mergeProseLines([
      line('The applicant must show evidence of'),
      line('sufficient funds for the whole stay.'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe(
      'The applicant must show evidence of sufficient funds for the whole stay.',
    );
  });

  it('repairs a hyphenated line break', () => {
    const out = mergeProseLines([
      line('The requi-'),
      line('rements are listed below.'),
    ]);
    expect(out[0].text).toBe('The requirements are listed below.');
  });

  it('starts a new paragraph after a sentence boundary followed by a capital', () => {
    const out = mergeProseLines([
      line('You must apply online.'),
      line('The fee is not refundable.'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('never merges across a page boundary', () => {
    // A merged paragraph would carry one page number and cite the wrong page.
    const out = mergeProseLines([
      line('end of page one', 1),
      line('start of page two', 2),
    ]);
    expect(out).toHaveLength(2);
  });

  it('never merges list items', () => {
    const out = mergeProseLines([
      line('• passport', 1, 'list'),
      line('• photograph', 1, 'list'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not merge across a heading change', () => {
    const out = mergeProseLines([
      line('under A', 1, 'prose', ['A']),
      line('under B', 1, 'prose', ['B']),
    ]);
    expect(out).toHaveLength(2);
  });
});
