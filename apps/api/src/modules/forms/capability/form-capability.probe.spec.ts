import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { probeFormCapability } from './form-capability.probe';

/** A one-page PDF flagged NeedsRendering — the shape every IRCC form has. */
async function xfaLike(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
  return pdf.save();
}

/** A real AcroForm with one fillable text field. */
async function acroFormLike(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const field = pdf.getForm().createTextField('Names.FamilyName');
  field.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  return pdf.save();
}

/** A plain page: no fields, no XFA flag. Not fillable, but not XFA either. */
async function flat(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}

/**
 * The IMM 5645 shape, found in PRODUCTION on 2026-08-12.
 *
 * `PDFDocument.load` succeeds, but `getPageCount()` throws
 * "Expected instance of PDFDict, but got instance of undefined" because the
 * real file has a broken page-tree reference (pdf-lib logs
 * "Invalid object ref: 771 0 R" while loading it). `getPageCount()` was the
 * one call in the probe with no guard, so it escaped and marked the row
 * 'error' — the Family Information form never cached.
 *
 * Reproduced by loading a valid document and then breaking /Pages, which is
 * what the real file effectively presents.
 */
async function brokenPageTree(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  // useObjectStreams:false keeps the catalog as literal text so the /Pages
  // reference can be patched below.
  const bytes = await pdf.save({ useObjectStreams: false });

  // Repoint /Pages at an object number that does not exist, which is exactly
  // what the real file presents ("Invalid object ref: 771 0 R"). Patching the
  // saved bytes rather than the in-memory document, because breaking the page
  // tree before save() makes save() itself throw.
  const text = Buffer.from(bytes).toString('latin1');
  const patched = text.replace(/\/Pages (\d+) 0 R/, '/Pages 9999 0 R');
  if (patched === text) throw new Error('fixture: /Pages ref not found');
  return new Uint8Array(Buffer.from(patched, 'latin1'));
}

describe('probeFormCapability', () => {
  it('classifies a NeedsRendering PDF as xfa', async () => {
    const r = await probeFormCapability(await xfaLike());
    expect(r.capability).toBe('xfa');
    expect(r.fieldCount).toBe(0);
    expect(r.pageCount).toBe(1);
  });

  it('classifies a PDF with AcroForm fields as acroform', async () => {
    const r = await probeFormCapability(await acroFormLike());
    expect(r.capability).toBe('acroform');
    expect(r.fieldCount).toBe(1);
  });

  it('classifies a field-less, flag-less PDF as unknown', async () => {
    const r = await probeFormCapability(await flat());
    expect(r.capability).toBe('unknown');
    expect(r.fieldCount).toBe(0);
  });

  it('returns unknown rather than throwing on bytes that are not a PDF', async () => {
    const r = await probeFormCapability(new TextEncoder().encode('<html>'));
    expect(r).toEqual({
      capability: 'unknown',
      fieldCount: 0,
      pageCount: 0,
      parsed: false,
    });
  });

  it('prefers acroform when fields exist even if NeedsRendering is set', async () => {
    // A hybrid XFA/AcroForm PDF is fillable by pdf-lib via its AcroForm
    // fallback. Field presence is the operative signal, so it wins.
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    pdf.getForm().createTextField('x').addToPage(page, {
      x: 10,
      y: 10,
      width: 50,
      height: 10,
    });
    pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
    const r = await probeFormCapability(await pdf.save());
    expect(r.capability).toBe('acroform');
  });

  it('treats an explicit NeedsRendering false as not xfa', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.False);
    const r = await probeFormCapability(await pdf.save());
    expect(r.capability).toBe('unknown');
  });

  it('classifies rather than throwing when NeedsRendering holds a non-boolean', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(PDFName.of('NeedsRendering'), PDFName.of('Nonsense'));
    const r = await probeFormCapability(await pdf.save());
    expect(r.capability).toBe('unknown');
  });

  it('classifies rather than throwing when getPageCount() fails (IMM 5645 shape)', async () => {
    const r = await probeFormCapability(await brokenPageTree());
    expect(r.capability).toBe('unknown');
    expect(r.pageCount).toBe(0);
    // The bytes DID parse as a PDF — only the page tree is unreadable. The
    // refresh job must not mistake this for "not a PDF" and discard the form.
    expect(r.parsed).toBe(true);
  });

  it('reports parsed=false only when the bytes are not a PDF at all', async () => {
    const r = await probeFormCapability(new TextEncoder().encode('<html>'));
    expect(r.parsed).toBe(false);
  });

  it('reports parsed=true for every PDF it can load', async () => {
    expect((await probeFormCapability(await xfaLike())).parsed).toBe(true);
    expect((await probeFormCapability(await acroFormLike())).parsed).toBe(true);
    expect((await probeFormCapability(await flat())).parsed).toBe(true);
  });
});
