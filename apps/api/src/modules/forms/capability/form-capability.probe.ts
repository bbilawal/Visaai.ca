import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';

/**
 * Can pdf-lib fill this form?
 *
 *   acroform  yes — it has named AcroForm fields
 *   xfa       no  — dynamic XFA; the file is a "please open in Acrobat" stub
 *   unknown   no  — a flat PDF, or bytes we could not parse
 *
 * MEASURED against the live IMM 5257 (2026-08-11):
 *   NeedsRendering = true, fields = 0, pages = 1
 * and, importantly, `form.acroForm.dict.get(PDFName.of('XFA'))` is UNDEFINED
 * for that file. Detection therefore keys on NeedsRendering plus the field
 * count, not on the /XFA key — which is why the obvious check does not work.
 *
 * pdf-lib prints "Trying to parse invalid object" warnings to stderr while
 * loading IRCC PDFs and still succeeds. That noise is expected, not an error.
 */
export type FormCapability = 'acroform' | 'xfa' | 'unknown';

export interface CapabilityResult {
  capability: FormCapability;
  fieldCount: number;
  pageCount: number;
  /**
   * Did `PDFDocument.load` succeed?
   *
   * Distinct from `capability`, and the distinction is load-bearing: a valid
   * PDF that pdf-lib cannot introspect is `parsed: true, capability:'unknown'`,
   * while bytes that are not a PDF at all are `parsed: false`. The refresh job
   * discards only the latter. Collapsing the two would throw away real forms —
   * see the IMM 5645 note below.
   */
  parsed: boolean;
}

const UNPARSEABLE: CapabilityResult = {
  capability: 'unknown',
  fieldCount: 0,
  pageCount: 0,
  parsed: false,
};

export async function probeFormCapability(
  bytes: Uint8Array,
): Promise<CapabilityResult> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return UNPARSEABLE;
  }

  // MEASURED in production on 2026-08-12: the live IMM 5645 loads fine but
  // throws "Expected instance of PDFDict, but got instance of undefined" here,
  // because its page tree carries a broken reference (pdf-lib logs "Invalid
  // object ref: 771 0 R" on the way in). This was the ONLY unguarded call in
  // the probe, so it escaped a function whose contract is to classify rather
  // than throw, and the refresh job marked the form 'error' — Family
  // Information never cached.
  let pageCount = 0;
  try {
    pageCount = pdf.getPageCount();
  } catch {
    pageCount = 0;
  }

  let fieldCount = 0;
  try {
    fieldCount = pdf.getForm().getFields().length;
  } catch {
    fieldCount = 0;
  }

  // Fields win: a hybrid file with both an XFA layer and an AcroForm fallback
  // is fillable through the fallback.
  if (fieldCount > 0) {
    return { capability: 'acroform', fieldCount, pageCount, parsed: true };
  }

  let needsRendering = false;
  try {
    needsRendering =
      pdf.catalog
        .lookupMaybe(PDFName.of('NeedsRendering'), PDFBool)
        ?.asBoolean() === true;
  } catch {
    // Present but not a boolean — a malformed flag is not a reliable XFA
    // signal, so fall through to the unknown classification rather than
    // throwing out of a function whose contract is to classify.
    needsRendering = false;
  }
  if (needsRendering) {
    return { capability: 'xfa', fieldCount, pageCount, parsed: true };
  }

  return { capability: 'unknown', fieldCount, pageCount, parsed: true };
}
