import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import type { PrefilledFormPayload } from '@visaai/types';
import { renderImm5257, setTemplateLoader } from './imm5257';

function payload(): PrefilledFormPayload {
  return {
    visaType: 'visitor',
    countryCode: 'CA',
    purpose: 'tourism',
    generatedAt: new Date('2026-08-11T00:00:00Z').toISOString(),
    fields: [
      {
        key: 'family_name',
        label: 'Family name',
        value: 'Smith',
        group: 'Personal',
      },
    ],
  };
}

async function xfaTemplate(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.catalog.set(PDFName.of('NeedsRendering'), PDFBool.True);
  return pdf.save();
}

/** An AcroForm carrying one of the names in FIELD_MAP. */
async function acroTemplate(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  pdf
    .getForm()
    .createTextField('Names.FamilyName')
    .addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  return pdf.save();
}

afterEach(() => setTemplateLoader(null));

describe('renderImm5257', () => {
  it('returns null when no template is cached', async () => {
    setTemplateLoader(() => Promise.resolve(null));
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });

  it('returns null for an XFA template — pdf-lib cannot fill it', async () => {
    const bytes = await xfaTemplate();
    setTemplateLoader(() => Promise.resolve(bytes));
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });

  it('fills an AcroForm template and returns a loadable PDF', async () => {
    const bytes = await acroTemplate();
    setTemplateLoader(() => Promise.resolve(bytes));

    const out = await renderImm5257(payload());
    expect(out).not.toBeNull();

    const reloaded = await PDFDocument.load(out!);
    expect(reloaded.getForm().getTextField('Names.FamilyName').getText()).toBe(
      'Smith',
    );
  });

  it('requests the template by form code', async () => {
    const seen: string[] = [];
    setTemplateLoader((code) => {
      seen.push(code);
      return Promise.resolve(null);
    });
    await renderImm5257(payload());
    expect(seen).toEqual(['IMM 5257']);
  });

  it('returns null rather than throwing when the loader rejects', async () => {
    setTemplateLoader(() => Promise.reject(new Error('storage down')));
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });

  it('makes no network call — there is no loader by default', async () => {
    // The dead canada.ca URL is gone. With no loader wired, the renderer
    // degrades immediately instead of fetching anything.
    await expect(renderImm5257(payload())).resolves.toBeNull();
  });

  it('makes no network call — templates come only from the cache', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    setTemplateLoader(() => Promise.resolve(null));
    await renderImm5257(payload());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('makes no network call on the success path either', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const bytes = await acroTemplate();
    setTemplateLoader(() => Promise.resolve(bytes));
    await renderImm5257(payload());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
