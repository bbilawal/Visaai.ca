/**
 * DOCX and spreadsheet extraction.
 *
 * Governments publish two things in these formats that matter, and they need
 * opposite handling:
 *
 *   DOCX  policy notes, guidance drafts, application form instructions. These
 *         are prose with headings, so mammoth's HTML output is reused through
 *         the HTML extractor rather than reimplementing heading detection.
 *
 *   XLSX  fee schedules, quota tables, processing-time tables, occupation
 *         lists. These are DATA, and the failure mode is a number extracted
 *         without its row and column labels. A fee of "185" is useless; a fee
 *         of "Subclass 600 / Applied outside Australia: 185 AUD" is an answer.
 *         So every cell is serialised with its header, exactly as HTML tables
 *         are.
 */
import {
  assemble,
  emptyDocument,
  ExtractionError,
  type ExtractedDocument,
  type ExtractedSection,
  type ExtractInput,
  type Extractor,
} from './types';
import { HtmlExtractor } from './html.extractor';
import { asText } from '../row-values';

const VERSION = 'v1';

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Both vendors are loaded lazily and typed to the slice actually used.
 *
 * `mammoth` and `exceljs` both ship types, but both are namespace-vs-default
 * awkward under this project's CommonJS interop, which is what tempts a cast
 * to `any` — and an `any` at a parser boundary means a vendor shape change
 * compiles fine and fails on a government spreadsheet at run time.
 */
interface MammothResult {
  value: string;
  messages: Array<{ type: string; message: string }>;
}
interface MammothModule {
  convertToHtml(input: { buffer: Buffer }): Promise<MammothResult>;
}
let mammothPromise: Promise<MammothModule> | null = null;
async function loadMammoth(): Promise<MammothModule> {
  if (!mammothPromise) {
    mammothPromise = import('mammoth').then((m) => {
      // CommonJS interop: the module may arrive as the namespace or wrapped
      // in `default`, depending on how it is transpiled at the call site.
      const mod = m as unknown as { default?: MammothModule };
      return mod.default ?? m;
    });
  }
  return mammothPromise;
}

/** The exceljs surface this extractor touches. */
interface ExcelCell {
  value: unknown;
}
interface ExcelRow {
  eachCell(
    opts: { includeEmpty: boolean },
    cb: (cell: ExcelCell) => void,
  ): void;
}
interface ExcelSheet {
  name?: string;
  eachRow(opts: { includeEmpty: boolean }, cb: (row: ExcelRow) => void): void;
}
interface ExcelWorkbook {
  xlsx: { load(buffer: Buffer): Promise<unknown> };
  eachSheet(cb: (sheet: ExcelSheet) => void): void;
}
interface ExcelJsModule {
  Workbook: new () => ExcelWorkbook;
}
let exceljsPromise: Promise<ExcelJsModule> | null = null;
async function loadExcelJs(): Promise<ExcelJsModule> {
  if (!exceljsPromise) {
    exceljsPromise = import('exceljs').then((m) => {
      const mod = m as unknown as { default?: ExcelJsModule };
      return mod.default ?? (m as unknown as ExcelJsModule);
    });
  }
  return exceljsPromise;
}

export class DocxExtractor implements Extractor {
  readonly name = 'docx';
  readonly version = VERSION;

  private readonly html = new HtmlExtractor();

  supports(contentType: string): boolean {
    return contentType === DOCX;
  }

  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const mammoth = await loadMammoth();
    let result: MammothResult;
    try {
      result = await mammoth.convertToHtml({
        buffer: Buffer.from(input.bytes),
      });
    } catch (err) {
      throw new ExtractionError(
        `DOCX could not be converted: ${err instanceof Error ? err.message : String(err)}`,
        'malformed',
      );
    }

    if (!result.value.trim()) {
      throw new ExtractionError('DOCX produced no content', 'empty');
    }

    // Reuse the HTML path so headings, lists and tables get the same treatment
    // they get on a web page. A second heading detector for DOCX would be a
    // second thing to keep correct.
    const doc = await this.html.extract({
      ...input,
      contentType: 'text/html',
      bytes: Buffer.from(result.value, 'utf8'),
    });

    doc.extractor = this.name;
    doc.extractorVersion = VERSION;
    for (const msg of result.messages) {
      if (msg.type === 'warning') doc.warnings.push(`docx: ${msg.message}`);
    }
    return doc;
  }
}

export class SpreadsheetExtractor implements Extractor {
  readonly name = 'spreadsheet';
  readonly version = VERSION;

  supports(contentType: string): boolean {
    return contentType === XLSX || contentType === 'application/vnd.ms-excel';
  }

  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const ExcelJS = await loadExcelJs();
    const doc = emptyDocument(this.name, VERSION);
    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(Buffer.from(input.bytes));
    } catch (err) {
      throw new ExtractionError(
        `spreadsheet could not be read: ${err instanceof Error ? err.message : String(err)}`,
        'malformed',
      );
    }

    const built: Array<
      Omit<ExtractedSection, 'charStart' | 'charEnd' | 'ordinal'>
    > = [];

    workbook.eachSheet((sheet) => {
      const sheetName = sheet.name ?? 'Sheet';
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          values.push(cellToText(cell));
        });
        if (values.some((v) => v.trim())) rows.push(values);
      });

      if (rows.length === 0) return;

      built.push({
        kind: 'heading',
        headingPath: [],
        headingLevel: 1,
        text: sheetName,
      });

      // The header is the first row only if it looks like labels: all cells
      // non-empty and none purely numeric. A fee table whose first row is
      // already data would otherwise lose that row AND mislabel every other.
      const first = rows[0];
      const headerLooksReal =
        rows.length > 1 &&
        first.every((c) => c.trim().length > 0) &&
        !first.every((c) => /^-?[\d.,\s]+$/.test(c));
      const header = headerLooksReal ? first : undefined;
      const body = header ? rows.slice(1) : rows;

      const lines = body.map((row) =>
        header
          ? row
              .map((cell, i) => `${header[i] ?? `col${i + 1}`}: ${cell}`)
              .join(' | ')
          : row.join(' | '),
      );

      built.push({
        kind: 'table',
        headingPath: [sheetName],
        text: lines.join('\n'),
        tableHeader: header,
      });
      doc.tableCount++;
    });

    if (built.length === 0)
      throw new ExtractionError('spreadsheet has no rows', 'empty');

    const { text, sections } = assemble(built);
    doc.text = text;
    doc.sections = sections;
    return doc;
  }
}

/**
 * Render a cell as the reader sees it, not as the file stores it.
 *
 * A formula cell carries both the formula and its cached result; the result is
 * what a government publishes as the fee. A date cell carries a JS Date and
 * must be rendered ISO rather than through the host's locale, or a fee
 * schedule's effective date reads differently on the VPS than in a test.
 */
export function cellToText(
  cell: { value?: unknown } | null | undefined,
): string {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: unknown }>)
        .map((r) => asText(r.text))
        .join('');
    }
    if ('text' in obj) return asText(obj.text);
    if ('result' in obj) return asText(obj.result);
    if ('formula' in obj) return '';
    if ('error' in obj) return asText(obj.error);
    return '';
  }
  return asText(v);
}

/**
 * CSV, JSON and XML: officially-published structured data.
 *
 * CSV is parsed with a real quote-aware reader rather than `split(',')`,
 * because a government occupation list has commas inside quoted job titles and
 * a naive split shifts every column after the first one that contains one.
 */
export class DataExtractor implements Extractor {
  readonly name = 'data';
  readonly version = VERSION;

  supports(contentType: string): boolean {
    return (
      contentType === 'text/csv' ||
      contentType === 'application/json' ||
      contentType === 'application/xml' ||
      contentType === 'text/plain'
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const raw = Buffer.from(input.bytes).toString('utf8');
    const doc = emptyDocument(this.name, VERSION);
    const built: Array<
      Omit<ExtractedSection, 'charStart' | 'charEnd' | 'ordinal'>
    > = [];

    if (input.contentType === 'text/csv') {
      const rows = parseCsv(raw);
      if (rows.length === 0)
        throw new ExtractionError('CSV has no rows', 'empty');
      const header = rows[0];
      const body = rows.slice(1);
      built.push({
        kind: 'table',
        headingPath: [],
        text: body
          .map((row) =>
            row
              .map((cell, i) => `${header[i] ?? `col${i + 1}`}: ${cell}`)
              .join(' | '),
          )
          .join('\n'),
        tableHeader: header,
      });
      doc.tableCount = 1;
    } else if (input.contentType === 'application/json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new ExtractionError(
          `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
          'malformed',
        );
      }
      for (const line of flattenJson(parsed)) {
        built.push({ kind: 'prose', headingPath: [], text: line });
      }
    } else if (input.contentType === 'application/xml') {
      // Feeds and structured XML: entries become sections so an announcement
      // is retrievable on its own rather than as part of a wall of feed.
      const entries = extractFeedEntries(raw);
      if (entries.length > 0) {
        for (const e of entries) {
          built.push({
            kind: 'prose',
            headingPath: e.title ? [e.title] : [],
            text: [e.title, e.summary, e.link].filter(Boolean).join('\n'),
          });
        }
      } else {
        const stripped = raw
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!stripped) throw new ExtractionError('XML has no text', 'empty');
        built.push({ kind: 'prose', headingPath: [], text: stripped });
      }
    } else {
      const paragraphs = raw
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, ' ').trim());
      for (const p of paragraphs) {
        if (p) built.push({ kind: 'prose', headingPath: [], text: p });
      }
    }

    if (built.length === 0) throw new ExtractionError('no content', 'empty');
    const { text, sections } = assemble(built);
    doc.text = text;
    doc.sections = sections;
    return doc;
  }
}

/** RFC-4180-ish: quoted fields, doubled quotes, CRLF or LF, no trailing blank row. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const delimiter = detectDelimiter(input);

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      field = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // handled by the \n that follows
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

export function detectDelimiter(input: string): string {
  const head = input.slice(0, 4096).split(/\r?\n/).slice(0, 5);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = head.map((l) => l.split(d).length - 1);
    if (counts.length === 0) continue;
    const first = counts[0];
    if (first === 0) continue;
    const consistent = counts.every((c) => c === first);
    const score = consistent ? first * 10 : first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Flatten JSON to `a.b.c: value` lines, so structured data stays searchable. */
export function flattenJson(value: unknown, prefix = '', depth = 0): string[] {
  if (depth > 12) return [`${prefix}: [nesting too deep]`];
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) =>
      flattenJson(v, `${prefix}[${i}]`, depth + 1),
    );
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flattenJson(v, prefix ? `${prefix}.${k}` : k, depth + 1),
    );
  }
  const s = asText(value).trim();
  return s ? [`${prefix}: ${s}`] : [];
}

/** RSS/Atom entries, without an XML parser dependency. */
export function extractFeedEntries(
  xml: string,
): Array<{ title?: string; summary?: string; link?: string }> {
  const out: Array<{ title?: string; summary?: string; link?: string }> = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[2];
    out.push({
      title: pick(body, 'title'),
      summary:
        pick(body, 'description') ??
        pick(body, 'summary') ??
        pick(body, 'content'),
      link: pick(body, 'link') ?? linkHref(body),
    });
    if (out.length >= 200) break;
  }
  return out;
}

function pick(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(
    xml,
  );
  if (!m) return undefined;
  const text = m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

function linkHref(xml: string): string | undefined {
  const m = /<link\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(xml);
  return m?.[1];
}
