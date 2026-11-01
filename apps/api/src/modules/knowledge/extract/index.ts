/**
 * The extractor dispatcher, and the OCR fallback.
 *
 * Format detection has already happened (mime.ts). This picks the extractor,
 * runs it, and decides what to do when it cannot produce text — which for
 * government documents is not an edge case: scanned bulletins, image-only
 * fee schedules and photocopied policy annexes are routine.
 *
 * OCR IS A PORT, NOT A DEPENDENCY. `apps/api/src/modules/documents/ocr/`
 * already defines a vendor-agnostic OCR provider used for applicant documents,
 * and the same interface shape is reused here rather than a second one being
 * invented. What is NOT reused is the provider instance: applicant documents
 * are sensitive and go through the region-aware, no-retention configuration,
 * while government PDFs are public. Keeping the two wires separate is what
 * stops a future change to one silently changing the residency posture of the
 * other.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  ExtractionError,
  type ExtractedDocument,
  type ExtractInput,
  type Extractor,
} from './types';
import { HtmlExtractor } from './html.extractor';
import { PdfExtractor } from './pdf.extractor';
import {
  DataExtractor,
  DocxExtractor,
  SpreadsheetExtractor,
} from './office.extractor';
import { REQUIRES_OCR, type SniffedType } from '../mime';

export * from './types';

/**
 * Minimal OCR contract. Deliberately narrower than the applicant-document one:
 * this path never needs field extraction, only text and a confidence.
 */
export interface KnowledgeOcrProvider {
  readonly name: string;
  recognize(input: {
    bytes: Uint8Array;
    contentType: string;
    languageHint?: string;
  }): Promise<{ text: string; confidence: number; pageCount?: number }>;
}

export const KNOWLEDGE_OCR_PROVIDER = Symbol('KNOWLEDGE_OCR_PROVIDER');

/** Below this, OCR output is treated as unusable and the document quarantined. */
export const MIN_OCR_CONFIDENCE = 0.55;

@Injectable()
export class ExtractorRegistry {
  private readonly log = new Logger(ExtractorRegistry.name);

  private readonly extractors: Extractor[] = [
    new HtmlExtractor(),
    new PdfExtractor(),
    new DocxExtractor(),
    new SpreadsheetExtractor(),
    new DataExtractor(),
  ];

  constructor(
    @Optional()
    private readonly ocr?: KnowledgeOcrProvider,
  ) {}

  /** The extractor that claims this content type, or null. */
  select(contentType: string): Extractor | null {
    return this.extractors.find((e) => e.supports(contentType)) ?? null;
  }

  /**
   * Extract, falling back to OCR where the format needs it or the text layer
   * is missing.
   *
   * Throws `ExtractionError` when nothing usable can be produced. It never
   * returns an empty document: an empty extraction that reports success is how
   * a document silently leaves the corpus while the dashboard stays green.
   */
  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const needsOcrUpfront = REQUIRES_OCR.has(input.contentType as SniffedType);

    if (needsOcrUpfront) {
      return this.runOcr(input, 'image format has no text layer');
    }

    const extractor = this.select(input.contentType);
    if (!extractor) {
      throw new ExtractionError(
        `no extractor for ${input.contentType}`,
        'unsupported',
      );
    }

    try {
      return await extractor.extract(input);
    } catch (err) {
      // A PDF with no text layer is the one failure OCR can fix. Everything
      // else — encrypted, malformed, unsupported — is a genuine dead end and
      // must surface rather than be papered over with an OCR attempt that
      // would produce plausible-looking noise.
      if (err instanceof ExtractionError && err.reason === 'no_text_layer') {
        return this.runOcr(input, err.message);
      }
      throw err;
    }
  }

  private async runOcr(
    input: ExtractInput,
    why: string,
  ): Promise<ExtractedDocument> {
    if (!this.ocr) {
      throw new ExtractionError(
        `${why}; no OCR provider configured (set KNOWLEDGE_OCR_PROVIDER)`,
        'no_text_layer',
      );
    }

    this.log.debug(`OCR fallback for ${input.url}: ${why}`);
    const result = await this.ocr.recognize({
      bytes: input.bytes,
      contentType: input.contentType,
      languageHint: input.languageHint,
    });

    const text = result.text.trim();
    if (!text) {
      throw new ExtractionError(
        `OCR produced no text (${this.ocr.name})`,
        'empty',
      );
    }
    if (result.confidence < MIN_OCR_CONFIDENCE) {
      // Low-confidence OCR of a legal document is worse than no document: it
      // reads as authoritative and is wrong in ways a reader cannot detect.
      throw new ExtractionError(
        `OCR confidence ${result.confidence.toFixed(2)} below ${MIN_OCR_CONFIDENCE}`,
        'no_text_layer',
      );
    }

    // OCR output has no reliable structure, so it is emitted as paragraphs with
    // an empty heading path rather than as invented headings.
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
    const sections = paragraphs.map((p, i) => ({
      ordinal: i,
      kind: 'prose' as const,
      headingPath: [] as string[],
      text: p,
      charStart: 0,
      charEnd: 0,
    }));

    let cursor = 0;
    for (const s of sections) {
      s.charStart = cursor;
      cursor += s.text.length;
      s.charEnd = cursor;
      cursor += 2;
    }

    return {
      text: paragraphs.join('\n\n'),
      sections,
      extractor: `ocr:${this.ocr.name}`,
      extractorVersion: 'v1',
      pageCount: result.pageCount,
      tableCount: 0,
      links: [],
      warnings: [
        `text recovered by OCR (${this.ocr.name}); structure is not available`,
      ],
      ocrApplied: true,
      ocrConfidence: result.confidence,
    };
  }
}
