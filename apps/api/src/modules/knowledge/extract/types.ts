/**
 * The one shape every extractor produces, whatever the input format was.
 *
 * The chunker, the safety scan, the hasher and the admin UI all read this and
 * nothing format-specific. That is what lets a new format (a government's XML
 * feed, a scanned bulletin) be added as one file rather than as a change that
 * ripples through the pipeline.
 *
 * STRUCTURE IS NOT DECORATION HERE. A visa page is mostly lists and tables,
 * and a requirement separated from its heading is a different claim:
 *
 *   "Bank statements for the last 6 months"
 *
 * means one thing under "Documents you must provide" and the opposite under
 * "Documents you do not need to send". Flat text loses that distinction, which
 * is why `headingPath` is on every section and is carried onto every chunk.
 */

export type SectionKind =
  | 'heading'
  | 'prose'
  | 'list'
  | 'table'
  | 'checklist'
  | 'figure'
  | 'metadata';

export interface ExtractedSection {
  ordinal: number;
  kind: SectionKind;
  /** Full heading path from the document root, outermost first. */
  headingPath: string[];
  headingLevel?: number;
  /** 1-based, for paginated formats. Undefined for HTML. */
  pageNumber?: number;
  text: string;
  /** Offsets into the assembled `ExtractedDocument.text`. */
  charStart: number;
  charEnd: number;
  /** For kind='table': the header row, so every cut of the table keeps it. */
  tableHeader?: string[];
}

export interface ExtractedDocument {
  /** The full plain text, sections concatenated in reading order. */
  text: string;
  sections: ExtractedSection[];
  /** Extractor identity, recorded on kb_extractions. */
  extractor: string;
  extractorVersion: string;
  pageCount?: number;
  tableCount: number;
  /** Links found in the document, absolute where they could be resolved. */
  links: Array<{ href: string; text: string }>;
  /** Document title as the format declares it, when it declares one. */
  title?: string;
  /** Dates the document itself states, ISO yyyy-mm-dd, best-effort. */
  publishedAt?: string;
  effectiveFrom?: string;
  /** Non-fatal problems a human should see. */
  warnings: string[];
  /** Set when OCR produced any part of the text. */
  ocrApplied: boolean;
  ocrConfidence?: number;
}

export interface ExtractInput {
  bytes: Uint8Array;
  /** The sniffed type, never the declared one. */
  contentType: string;
  /** Absolute URL, used to resolve relative links. */
  url: string;
  /** Declared language of the source row, used as a prior for detection. */
  languageHint?: string;
}

export interface Extractor {
  readonly name: string;
  readonly version: string;
  supports(contentType: string): boolean;
  extract(input: ExtractInput): Promise<ExtractedDocument>;
}

/** An extractor that produced nothing usable. Distinct from a fetch failure. */
export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'empty'
      | 'encrypted'
      | 'unsupported'
      | 'malformed'
      | 'no_text_layer',
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Build an empty document, so extractors never return a partially-filled one. */
export function emptyDocument(
  extractor: string,
  version: string,
): ExtractedDocument {
  return {
    text: '',
    sections: [],
    extractor,
    extractorVersion: version,
    tableCount: 0,
    links: [],
    warnings: [],
    ocrApplied: false,
  };
}

/**
 * Assemble sections into the document text and fix up their offsets.
 *
 * Extractors build sections with local text and call this once. Doing it here
 * rather than in each extractor is why `charStart`/`charEnd` are guaranteed to
 * index into `text` — a reviewer jumping to an offset lands on the span, in
 * every format.
 */
export function assemble(
  sections: Array<Omit<ExtractedSection, 'charStart' | 'charEnd' | 'ordinal'>>,
): { text: string; sections: ExtractedSection[] } {
  const parts: string[] = [];
  const out: ExtractedSection[] = [];
  let cursor = 0;
  let ordinal = 0;

  for (const s of sections) {
    const text = s.text.trim();
    if (!text) continue;
    const charStart = cursor;
    parts.push(text);
    cursor += text.length;
    const charEnd = cursor;
    // Separator between sections. Two newlines so a downstream reader can
    // still see the block boundary in the flat text.
    parts.push('\n\n');
    cursor += 2;
    out.push({ ...s, text, ordinal: ordinal++, charStart, charEnd });
  }

  return { text: parts.join('').trimEnd(), sections: out };
}
