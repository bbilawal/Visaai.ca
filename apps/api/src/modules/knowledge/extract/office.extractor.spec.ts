import {
  DataExtractor,
  cellToText,
  detectDelimiter,
  extractFeedEntries,
  flattenJson,
  parseCsv,
} from './office.extractor';
import { ExtractionError } from './types';

describe('parseCsv', () => {
  it('respects quoted fields containing the delimiter', () => {
    // The bug a naive split(',') has: every column after a quoted comma shifts.
    const rows = parseCsv(
      'code,title\n2544,"Nurse, registered"\n2531,"Doctor"',
    );
    expect(rows).toEqual([
      ['code', 'title'],
      ['2544', 'Nurse, registered'],
      ['2531', 'Doctor'],
    ]);
  });

  it('handles doubled quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"say ""hi""",2\r\n');
    expect(rows[1]).toEqual(['say "hi"', '2']);
  });

  it('drops a trailing blank row', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toHaveLength(2);
  });
});

describe('detectDelimiter', () => {
  it('picks the consistent delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });
});

describe('flattenJson', () => {
  it('flattens to searchable path: value lines', () => {
    expect(flattenJson({ fee: { amount: 100, currency: 'CAD' } })).toEqual([
      'fee.amount: 100',
      'fee.currency: CAD',
    ]);
  });

  it('indexes array members', () => {
    expect(flattenJson({ docs: ['passport', 'photo'] })).toEqual([
      'docs[0]: passport',
      'docs[1]: photo',
    ]);
  });

  it('bounds recursion rather than blowing the stack on a hostile document', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(() => flattenJson(deep)).not.toThrow();
  });
});

describe('extractFeedEntries', () => {
  it('reads RSS items', () => {
    const xml = `<rss><channel>
      <item><title>New fees from April</title><description>Fees rise to 120.</description><link>https://gov.example/a</link></item>
      <item><title>Form withdrawn</title><description>IMM 5257 replaced.</description></item>
    </channel></rss>`;
    const entries = extractFeedEntries(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe('New fees from April');
    expect(entries[0].link).toBe('https://gov.example/a');
  });

  it('reads Atom entries and unwraps CDATA', () => {
    const xml = `<feed><entry><title><![CDATA[Policy update]]></title><summary>Text</summary>
      <link href="https://gov.example/b"/></entry></feed>`;
    const entries = extractFeedEntries(xml);
    expect(entries[0].title).toBe('Policy update');
    expect(entries[0].link).toBe('https://gov.example/b');
  });
});

describe('DataExtractor', () => {
  const extractor = new DataExtractor();
  const run = (text: string, contentType: string) =>
    extractor.extract({
      bytes: new Uint8Array(Buffer.from(text, 'utf8')),
      contentType,
      url: 'https://gov.example/data',
    });

  it('turns a CSV into one table section with the header on each row', async () => {
    const doc = await run('visa,fee\nvisitor,100\nstudent,150', 'text/csv');
    const table = doc.sections.find((s) => s.kind === 'table');
    expect(table!.text).toContain('visa: visitor | fee: 100');
    expect(table!.tableHeader).toEqual(['visa', 'fee']);
  });

  it('rejects malformed JSON rather than indexing garbage', async () => {
    await expect(run('{not json', 'application/json')).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });

  it('makes a feed entry its own retrievable section', async () => {
    const xml =
      '<rss><channel><item><title>Fee change</title><description>From April.</description></item></channel></rss>';
    const doc = await run(xml, 'application/xml');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].headingPath).toEqual(['Fee change']);
  });

  it('splits plain text into paragraphs', async () => {
    const doc = await run(
      'First paragraph.\n\nSecond paragraph.',
      'text/plain',
    );
    expect(doc.sections).toHaveLength(2);
  });
});

describe('cellToText', () => {
  it('renders a formula cell as its cached result, which is what is published', () => {
    expect(cellToText({ value: { formula: 'A1*2', result: 240 } })).toBe('240');
  });

  it('renders a date ISO, not through the host locale', () => {
    expect(cellToText({ value: new Date('2026-04-01T00:00:00Z') })).toBe(
      '2026-04-01',
    );
  });

  it('flattens rich text', () => {
    expect(
      cellToText({
        value: { richText: [{ text: 'Sub' }, { text: 'class 600' }] },
      }),
    ).toBe('Subclass 600');
  });

  it('renders an empty cell as an empty string, not "undefined"', () => {
    expect(cellToText({ value: null })).toBe('');
    expect(cellToText({})).toBe('');
  });
});
