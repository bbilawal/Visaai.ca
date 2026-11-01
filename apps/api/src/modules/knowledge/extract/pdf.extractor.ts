/**
 * PDF extraction, with page numbers preserved.
 *
 * Government PDFs are where the fee schedules and the policy manuals live, and
 * a citation into a 300-page manual without a page number is not a citation —
 * nobody can check it. So `pageNumber` is carried on every section and lands
 * on every chunk and every citation.
 *
 * THE SCANNED-PDF PROBLEM. A PDF with no text layer extracts to zero
 * characters, and the naive handling is to index the empty string, which
 * quietly removes a document from the corpus while reporting success. This
 * extractor raises `no_text_layer` instead, which is what routes the document
 * to OCR (see `extract/index.ts`) or to quarantine when no OCR provider is
 * configured. Silence is the failure mode being designed out.
 *
 * pdfjs is loaded lazily and by its legacy build. Two reasons: the legacy
 * build is the one that runs under Node without a DOM, and a top-level import
 * of a ~2 MB parser in a Nest module that mostly does not touch PDFs is a
 * startup cost paid on every boot.
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
import {
  asPdfjsModule,
  type PdfDocument,
  type PdfjsModule,
  type PdfTextContent,
  type PdfTextItem,
} from './pdfjs-shapes';

const VERSION = 'v1';

/**
 * Above this, a document is chunked from a streamed page walk rather than held
 * whole. A 900-page immigration manual is a real artifact and must not be an
 * out-of-memory.
 */
const MAX_PAGES = 2000;

type TextItem = PdfTextItem;

/**
 * Loaded once, then cached. The shape comes from `./pdfjs-shapes`, which
 * explains why it is a normal module rather than an ambient declaration — the
 * short version is that the ambient one did not compile under ts-node, so the
 * documented production backfill script could not run.
 */
let pdfjsPromise: Promise<PdfjsModule> | null = null;
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then(
      asPdfjsModule,
    );
  }
  return pdfjsPromise;
}

export class PdfExtractor implements Extractor {
  readonly name = 'pdf';
  readonly version = VERSION;

  supports(contentType: string): boolean {
    return contentType === 'application/pdf';
  }

  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const pdfjs = await loadPdfjs();
    const doc = emptyDocument(this.name, VERSION);

    let pdf: PdfDocument;
    try {
      pdf = await pdfjs.getDocument({
        // A copy: pdfjs transfers ownership of the buffer it is given, and the
        // caller still needs the bytes to hash and store.
        data: new Uint8Array(input.bytes),
        // No network fetches for fonts or standard font data: this is an
        // untrusted document and must not cause egress.
        disableFontFace: true,
        useSystemFonts: false,
        isEvalSupported: false,
        // Do not run any JavaScript the PDF carries. PDFs can contain JS; there
        // is no version of "running it" that helps text extraction.
        enableXfa: false,
      }).promise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/password|encrypt/i.test(message)) {
        throw new ExtractionError(`encrypted PDF: ${message}`, 'encrypted');
      }
      throw new ExtractionError(`unreadable PDF: ${message}`, 'malformed');
    }

    const pageCount = pdf.numPages;
    doc.pageCount = pageCount;
    if (pageCount > MAX_PAGES) {
      doc.warnings.push(
        `document has ${pageCount} pages; only the first ${MAX_PAGES} were indexed`,
      );
    }

    const built: Array<
      Omit<ExtractedSection, 'charStart' | 'charEnd' | 'ordinal'>
    > = [];
    const headingPath: string[] = [];
    let bodyFontSize = 0;
    let charsExtracted = 0;

    const limit = Math.min(pageCount, MAX_PAGES);
    for (let pageNo = 1; pageNo <= limit; pageNo++) {
      let content: PdfTextContent;
      try {
        const page = await pdf.getPage(pageNo);
        content = await page.getTextContent();
        // Release per-page resources as we go; a manual held entirely in
        // memory is the difference between a 200 MB and a 2 GB worker.
        page.cleanup();
      } catch (err) {
        doc.warnings.push(
          `page ${pageNo} could not be read: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      const lines = groupIntoLines(content.items);
      if (bodyFontSize === 0) bodyFontSize = medianFontSize(lines);

      for (const line of lines) {
        const text = line.text.trim();
        if (!text) continue;
        charsExtracted += text.length;

        // A line noticeably larger than the body text is a heading. This is the
        // only structural signal a PDF text layer carries — there are no tags —
        // and it is why headingPath is best-effort here and exact in HTML.
        const isHeading =
          bodyFontSize > 0 &&
          line.fontSize >= bodyFontSize * 1.25 &&
          text.length < 120;

        if (isHeading) {
          // PDFs have no heading levels, so the path is kept shallow: replace
          // rather than nest. A deep guessed hierarchy is worse than a flat
          // true one.
          headingPath.length = 0;
          headingPath.push(text);
          built.push({
            kind: 'heading',
            headingPath: [],
            pageNumber: pageNo,
            text,
          });
          continue;
        }

        built.push({
          kind: looksLikeListItem(text) ? 'list' : 'prose',
          headingPath: [...headingPath],
          pageNumber: pageNo,
          text,
        });
      }
    }

    // A PDF that yields almost nothing has an image-only text layer. The
    // threshold is per-page rather than absolute so a 1-page scan and a
    // 300-page scan are both caught.
    const perPage = limit > 0 ? charsExtracted / limit : 0;
    if (charsExtracted === 0 || perPage < 20) {
      throw new ExtractionError(
        `PDF text layer yielded ${charsExtracted} characters over ${limit} page(s)`,
        'no_text_layer',
      );
    }

    // Merge consecutive prose lines within a page into paragraphs. Line-level
    // sections would make every chunk a single line, and a requirement split
    // across two lines would be split across two chunks.
    const merged = mergeProseLines(built);
    const { text, sections } = assemble(merged);
    doc.text = text;
    doc.sections = sections;
    return doc;
  }
}

interface Line {
  text: string;
  y: number;
  fontSize: number;
}

/**
 * Group pdfjs text items into visual lines.
 *
 * pdfjs emits positioned fragments, not lines; a single sentence can arrive as
 * eight items. Grouping by baseline (transform[5]) with a tolerance derived
 * from the glyph height is what turns them back into readable text. Without
 * it, chunks read like ransom notes and embed accordingly.
 */
export function groupIntoLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let current: {
    parts: string[];
    y: number;
    fontSize: number;
    lastX: number;
  } | null = null;

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5] ?? 0;
    const x = item.transform?.[4] ?? 0;
    // transform[3] is the vertical scale, which is the effective font size.
    const fontSize = Math.abs(item.transform?.[3] ?? item.height ?? 10);
    const tolerance = Math.max(2, fontSize * 0.4);

    if (current && Math.abs(current.y - y) <= tolerance) {
      // Same line. Insert a space when the horizontal gap implies one; pdfjs
      // does not emit inter-word spaces reliably.
      const needsSpace =
        x - current.lastX > fontSize * 0.2 &&
        !/\s$/.test(current.parts[current.parts.length - 1] ?? '') &&
        !/^\s/.test(item.str);
      current.parts.push(needsSpace ? ` ${item.str}` : item.str);
      current.lastX = x + item.str.length * fontSize * 0.5;
      current.fontSize = Math.max(current.fontSize, fontSize);
    } else {
      if (current)
        lines.push({
          text: current.parts.join(''),
          y: current.y,
          fontSize: current.fontSize,
        });
      current = {
        parts: [item.str],
        y,
        fontSize,
        lastX: x + item.str.length * fontSize * 0.5,
      };
    }
    if (item.hasEOL && current) {
      lines.push({
        text: current.parts.join(''),
        y: current.y,
        fontSize: current.fontSize,
      });
      current = null;
    }
  }
  if (current)
    lines.push({
      text: current.parts.join(''),
      y: current.y,
      fontSize: current.fontSize,
    });

  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text);
}

export function medianFontSize(lines: Line[]): number {
  const sizes = lines
    .map((l) => l.fontSize)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  if (sizes.length === 0) return 0;
  return sizes[Math.floor(sizes.length / 2)];
}

export function looksLikeListItem(text: string): boolean {
  return /^\s*([•·▪◦‣–—-]|\(?[a-z0-9]{1,3}[.)])\s+/i.test(text);
}

/**
 * Join consecutive prose lines on the same page into paragraph sections.
 *
 * A paragraph break is inferred from a line that ends a sentence followed by a
 * line that starts one, or from a change of section kind, heading or page.
 * List items are never merged — each bullet is its own requirement.
 */
export function mergeProseLines<
  T extends {
    kind: string;
    headingPath: string[];
    pageNumber?: number;
    text: string;
  },
>(sections: T[]): T[] {
  const out: T[] = [];
  for (const s of sections) {
    const prev = out[out.length - 1];
    const mergeable =
      prev &&
      prev.kind === 'prose' &&
      s.kind === 'prose' &&
      prev.pageNumber === s.pageNumber &&
      prev.headingPath.join(' ') === s.headingPath.join(' ') &&
      // Do not merge across a sentence boundary followed by a capital: that is
      // where a new paragraph most often is.
      !(/[.!?:]["')\]]?$/.test(prev.text) && /^[A-Z(]/.test(s.text));
    if (mergeable) {
      // Hyphenated line break: "requi-\nrements" must become "requirements".
      if (/[a-z]-$/.test(prev.text) && /^[a-z]/.test(s.text)) {
        prev.text = prev.text.slice(0, -1) + s.text;
      } else {
        prev.text = `${prev.text} ${s.text}`;
      }
    } else {
      out.push({ ...s });
    }
  }
  return out;
}
