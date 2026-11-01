/**
 * The slice of pdfjs-dist this extractor uses, declared as a normal module.
 *
 * WHY NOT AN AMBIENT `declare module`
 *
 * This started life in `vendor-deps.d.ts` as
 * `declare module 'pdfjs-dist/legacy/build/pdf.mjs'`, which worked under
 * `nest build` and failed everywhere else:
 *
 *     TSError: Module '"pdfjs-dist/legacy/build/pdf.mjs"' has no exported
 *     member 'PdfDocument'.
 *
 * An ambient declaration only applies if the compiler loads the `.d.ts`, and
 * `ts-node` follows imports from its entry point rather than the tsconfig
 * `include`. So `scripts/knowledge-ingest.ts` — the documented way to build the
 * corpus in production — could not compile at all, while CI and the app build
 * stayed green. The failure was invisible until someone ran the backfill.
 *
 * There is a second problem the first one hid. `PdfDocument`, `PdfTextContent`
 * and `PdfTextItem` are OUR names; pdfjs really exports `PDFDocumentProxy`,
 * `TextContent` and `TextItem`. The ambient block was not describing an untyped
 * library, it was overriding a typed one with different names — so wherever the
 * real types did resolve, the build broke.
 *
 * Declaring the shapes here instead makes them ordinary imports that every
 * compiler sees the same way, and confines the assertion about pdfjs to one
 * place: `asPdfjsModule` below.
 *
 * The tradeoff, stated plainly: a pdfjs field rename now surfaces at runtime on
 * a government PDF rather than at build time. The previous arrangement claimed
 * to catch that and did not — it silently stopped type-checking against the
 * real package the moment pdfjs shipped its own types for this path.
 */

/** One positioned text run. `transform` is [a, b, c, d, e, f]. */
export interface PdfTextItem {
  str: string;
  /** [scaleX, skewX, skewY, scaleY, translateX, translateY] */
  transform: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface PdfTextContent {
  items: PdfTextItem[];
}

export interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
  cleanup(): void;
}

export interface PdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

export interface GetDocumentParams {
  data: Uint8Array;
  disableFontFace?: boolean;
  useSystemFonts?: boolean;
  isEvalSupported?: boolean;
  enableXfa?: boolean;
}

export interface PdfjsModule {
  getDocument(params: GetDocumentParams): { promise: Promise<PdfDocument> };
}

/**
 * The single assertion about pdfjs's shape.
 *
 * Narrowed rather than `as any`: if `getDocument` is missing entirely the throw
 * below names the cause, instead of a `TypeError: pdfjs.getDocument is not a
 * function` surfacing three frames deeper inside an extraction run.
 */
export function asPdfjsModule(mod: unknown): PdfjsModule {
  const candidate = mod as Partial<PdfjsModule> | null;
  if (!candidate || typeof candidate.getDocument !== 'function') {
    throw new Error(
      'pdfjs-dist did not export getDocument — the package layout changed',
    );
  }
  return candidate as PdfjsModule;
}
