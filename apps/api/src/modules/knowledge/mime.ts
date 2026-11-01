/**
 * What kind of file did the government actually serve?
 *
 * NEVER THE EXTENSION, AND NOT ALWAYS THE HEADER.
 *
 * Government file servers get Content-Type wrong constantly — a PDF served as
 * `application/octet-stream`, a DOCX as `application/zip`, an HTML error page
 * served as `application/pdf` with a 200. Two failure modes follow, and they
 * are opposite:
 *
 *   1. Trusting the header means the PDF extractor is handed an HTML "Service
 *      unavailable" page, produces garbage text, and that garbage is indexed
 *      as an official requirement.
 *   2. Distrusting everything means falling back to guessing from the URL
 *      path, which an attacker (or an ordinary CMS) controls.
 *
 * So: sniff the bytes, and use the declared type only to disambiguate formats
 * whose containers are identical (every OOXML file is a ZIP). Where the sniff
 * and the declaration disagree on the CONTAINER, that is a quarantine event,
 * not something to resolve silently.
 */

export type SniffedType =
  | 'application/pdf'
  | 'text/html'
  | 'application/xml'
  | 'application/json'
  | 'text/csv'
  | 'text/plain'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/zip'
  | 'application/msword'
  | 'application/vnd.ms-excel'
  | 'image/png'
  | 'image/jpeg'
  | 'image/tiff'
  | 'application/gzip'
  | 'application/octet-stream';

export interface SniffResult {
  type: SniffedType;
  /** How the decision was made, for the ingestion log. */
  basis: 'magic' | 'ooxml-part' | 'text-heuristic' | 'declared' | 'fallback';
  /**
   * True when the declared Content-Type names a different CONTAINER than the
   * bytes. Callers must quarantine rather than continue: it means either the
   * server is broken or the URL is not serving what the registry thinks.
   */
  mismatch: boolean;
  declared?: string;
}

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++)
    if (buf[offset + i] !== sig[i]) return false;
  return true;
}

/** Normalise `text/html; charset=utf-8` to `text/html`. */
export function baseType(declared: string | null | undefined): string | null {
  if (!declared) return null;
  return declared.split(';')[0].trim().toLowerCase() || null;
}

/**
 * Find the OOXML flavour inside a ZIP without unzipping it.
 *
 * Every OOXML file is a ZIP whose local file headers name the parts. `word/`
 * appears in a DOCX, `xl/` in an XLSX. Scanning the first 64 KB for those
 * literal part-name prefixes is enough to tell them apart and costs nothing
 * compared with a full inflate — which matters because the alternative is
 * inflating an untrusted archive purely to learn what it is.
 */
function ooxmlFlavour(buf: Uint8Array): SniffedType | null {
  const window = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  const ascii = Buffer.from(window).toString('latin1');
  if (ascii.includes('word/document.xml') || ascii.includes('word/_rels')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (ascii.includes('xl/workbook.xml') || ascii.includes('xl/worksheets/')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return null;
}

/** Container family, used only to decide whether a declaration CONTRADICTS. */
function container(t: string): string {
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/gzip') return 'gzip';
  if (
    t === 'application/zip' ||
    t.startsWith('application/vnd.openxmlformats-officedocument')
  ) {
    return 'zip';
  }
  if (
    t === 'text/html' ||
    t === 'application/xml' ||
    t === 'text/xml' ||
    t === 'application/xhtml+xml' ||
    t === 'application/json' ||
    t === 'text/csv' ||
    t === 'text/plain' ||
    t === 'application/rss+xml' ||
    t === 'application/atom+xml'
  ) {
    return 'text';
  }
  return 'unknown';
}

/**
 * Sniff a downloaded body.
 *
 * @param declared the Content-Type header, used ONLY as a tiebreak and as the
 *                 thing a mismatch is measured against.
 */
export function sniffMime(
  bytes: Uint8Array,
  declared?: string | null,
): SniffResult {
  const dec = baseType(declared);
  const withMismatch = (
    type: SniffedType,
    basis: SniffResult['basis'],
  ): SniffResult => ({
    type,
    basis,
    declared: dec ?? undefined,
    mismatch:
      dec !== null &&
      container(dec) !== 'unknown' &&
      container(dec) !== container(type),
  });

  if (bytes.length === 0) {
    return {
      type: 'application/octet-stream',
      basis: 'fallback',
      mismatch: false,
      declared: dec ?? undefined,
    };
  }

  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return withMismatch('application/pdf', 'magic');
  }
  // PK\x03\x04 — every ZIP, therefore every OOXML file.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const flavour = ooxmlFlavour(bytes);
    if (flavour) return withMismatch(flavour, 'ooxml-part');
    return withMismatch('application/zip', 'magic');
  }
  // \xD0\xCF\x11\xE0 — OLE2 compound file: legacy .doc / .xls.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    const t =
      dec === 'application/vnd.ms-excel'
        ? 'application/vnd.ms-excel'
        : 'application/msword';
    return withMismatch(t, 'magic');
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]))
    return withMismatch('image/png', 'magic');
  if (startsWith(bytes, [0xff, 0xd8, 0xff]))
    return withMismatch('image/jpeg', 'magic');
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return withMismatch('image/tiff', 'magic');
  }
  if (startsWith(bytes, [0x1f, 0x8b]))
    return withMismatch('application/gzip', 'magic');

  // Textual formats have no magic number, so decide from the first non-space
  // characters. A BOM is skipped first, otherwise every UTF-8-BOM HTML page
  // from a Windows-hosted authority sniffs as plain text.
  let start = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) start = 3;
  const head = Buffer.from(
    bytes.subarray(start, Math.min(bytes.length, start + 4096)),
  )
    .toString('utf8')
    .replace(/^\s+/, '');
  const lower = head.toLowerCase();

  if (
    lower.startsWith('<!doctype html') ||
    lower.startsWith('<html') ||
    /^<(head|body|meta)\b/.test(lower)
  ) {
    return withMismatch('text/html', 'text-heuristic');
  }
  if (lower.startsWith('<?xml')) {
    // An XHTML document declares XML first but is HTML for extraction
    // purposes; feeds are XML and are handled by the feed reader.
    if (lower.includes('<html') || lower.includes('xhtml')) {
      return withMismatch('text/html', 'text-heuristic');
    }
    return withMismatch('application/xml', 'text-heuristic');
  }
  if (lower.startsWith('<rss') || lower.startsWith('<feed')) {
    return withMismatch('application/xml', 'text-heuristic');
  }
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      JSON.parse(Buffer.from(bytes).toString('utf8'));
      return withMismatch('application/json', 'text-heuristic');
    } catch {
      /* not JSON after all — fall through */
    }
  }
  // HTML without a doctype is extremely common on older government CMSes.
  if (/<\/?(p|div|table|ul|h[1-6])\b/i.test(head)) {
    return withMismatch('text/html', 'text-heuristic');
  }

  if (dec === 'text/csv') return withMismatch('text/csv', 'declared');
  if (looksLikeCsv(head)) return withMismatch('text/csv', 'text-heuristic');

  // Printable-ASCII-dominant content with no structure is plain text.
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  let printable = 0;
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128)
      printable++;
  }
  if (printable / sample.length > 0.9)
    return withMismatch('text/plain', 'text-heuristic');

  return {
    type: 'application/octet-stream',
    basis: 'fallback',
    mismatch: false,
    declared: dec ?? undefined,
  };
}

/**
 * A CSV heuristic that will not claim prose.
 *
 * Requires at least two lines with the SAME delimiter count > 0. One line with
 * commas is a sentence; three lines with exactly four commas each is a table.
 */
export function looksLikeCsv(head: string): boolean {
  const lines = head
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);
  if (lines.length < 2) return false;
  for (const delim of [',', ';', '\t']) {
    const counts = lines.map((l) => l.split(delim).length - 1);
    if (counts[0] > 0 && counts.every((c) => c === counts[0])) return true;
  }
  return false;
}

/** Formats this pipeline can extract text from without OCR. */
export const NATIVELY_EXTRACTABLE: ReadonlySet<SniffedType> = new Set([
  'application/pdf',
  'text/html',
  'application/xml',
  'application/json',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** Formats that require OCR to yield any text at all. */
export const REQUIRES_OCR: ReadonlySet<SniffedType> = new Set([
  'image/png',
  'image/jpeg',
  'image/tiff',
]);
