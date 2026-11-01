import {
  baseType,
  looksLikeCsv,
  NATIVELY_EXTRACTABLE,
  REQUIRES_OCR,
  sniffMime,
} from './mime';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

/** A minimal ZIP local file header naming a part, which is what OOXML sniffing reads. */
function zipWithPart(part: string): Uint8Array {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  return new Uint8Array(
    Buffer.concat([header, Buffer.from(part, 'latin1'), Buffer.alloc(64)]),
  );
}

describe('sniffMime', () => {
  it('identifies a PDF by magic bytes regardless of the declared type', () => {
    const r = sniffMime(bytes('%PDF-1.7\n...'), 'application/octet-stream');
    expect(r.type).toBe('application/pdf');
    expect(r.basis).toBe('magic');
  });

  it('flags a mismatch when the header claims a different container', () => {
    // The real failure: an HTML error page served with Content-Type: application/pdf.
    const r = sniffMime(
      bytes('<!DOCTYPE html><html><body>Service unavailable</body></html>'),
      'application/pdf',
    );
    expect(r.type).toBe('text/html');
    expect(r.mismatch).toBe(true);
  });

  it('does not flag a mismatch between compatible text types', () => {
    const r = sniffMime(
      bytes('<!DOCTYPE html><html></html>'),
      'text/plain; charset=utf-8',
    );
    expect(r.type).toBe('text/html');
    expect(r.mismatch).toBe(false);
  });

  it('distinguishes DOCX from XLSX inside the ZIP container', () => {
    expect(sniffMime(zipWithPart('word/document.xml')).type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(sniffMime(zipWithPart('xl/workbook.xml')).type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('falls back to plain zip when no known OOXML part is present', () => {
    expect(sniffMime(zipWithPart('some/other/file.txt')).type).toBe(
      'application/zip',
    );
  });

  it('skips a UTF-8 BOM before deciding', () => {
    const withBom = new Uint8Array(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('<!DOCTYPE html><html></html>'),
      ]),
    );
    expect(sniffMime(withBom).type).toBe('text/html');
  });

  it('treats XHTML as HTML for extraction', () => {
    const xhtml =
      '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>x</body></html>';
    expect(sniffMime(bytes(xhtml)).type).toBe('text/html');
  });

  it('recognises a feed as XML', () => {
    expect(
      sniffMime(
        bytes('<?xml version="1.0"?><rss version="2.0"><channel/></rss>'),
      ).type,
    ).toBe('application/xml');
  });

  it('only accepts JSON that actually parses', () => {
    expect(sniffMime(bytes('{"fee": 100}')).type).toBe('application/json');
    // Starts with { but is not JSON — must not be mislabelled.
    expect(
      sniffMime(bytes('{this is not json at all, just prose')).type,
    ).not.toBe('application/json');
  });

  it('detects images, which route to OCR', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    expect(sniffMime(png).type).toBe('image/png');
    expect(REQUIRES_OCR.has(sniffMime(png).type)).toBe(true);
    expect(NATIVELY_EXTRACTABLE.has(sniffMime(png).type)).toBe(false);
  });

  it('returns octet-stream for an empty body rather than guessing', () => {
    expect(sniffMime(new Uint8Array(0)).type).toBe('application/octet-stream');
  });

  it('detects HTML without a doctype', () => {
    expect(
      sniffMime(bytes('<div class="content"><p>Visa requirements</p></div>'))
        .type,
    ).toBe('text/html');
  });
});

describe('looksLikeCsv', () => {
  it('requires a consistent delimiter across several lines', () => {
    expect(looksLikeCsv('a,b,c\n1,2,3\n4,5,6')).toBe(true);
    expect(looksLikeCsv('occupation;code\nNurse;2544\nDoctor;2531')).toBe(true);
  });

  it('does not claim prose that happens to contain commas', () => {
    expect(
      looksLikeCsv(
        'You must provide a passport, a photograph, and proof of funds.',
      ),
    ).toBe(false);
  });

  it('needs more than one line', () => {
    expect(looksLikeCsv('a,b,c')).toBe(false);
  });
});

describe('baseType', () => {
  it('strips parameters and lowercases', () => {
    expect(baseType('Text/HTML; charset=UTF-8')).toBe('text/html');
    expect(baseType(null)).toBeNull();
    expect(baseType('')).toBeNull();
  });
});
