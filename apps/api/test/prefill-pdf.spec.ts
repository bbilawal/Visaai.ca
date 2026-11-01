import { PDFDocument } from 'pdf-lib';
import type { PrefilledFormPayload } from '@visaai/types';
import { renderPrefilledFormPdf } from '../src/modules/prefill/prefill-pdf';

function payload(value: string): PrefilledFormPayload {
  return {
    visaType: 'visitor',
    countryCode: 'CA',
    purpose: 'tourism',
    generatedAt: new Date('2026-06-12T00:00:00Z').toISOString(),
    fields: [
      { key: 'family_name', label: 'Family name', value, group: 'Personal' },
      { key: 'given_name', label: 'Given name', value, group: 'Personal' },
    ],
  };
}

async function rendersToValidPdf(value: string, locale: string) {
  const bytes = await renderPrefilledFormPdf(payload(value), locale);
  expect(bytes.length).toBeGreaterThan(0);
  const reloaded = await PDFDocument.load(bytes);
  expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
}

describe('renderPrefilledFormPdf i18n', () => {
  it('renders a Latin (default) document', async () => {
    await rendersToValidPdf('Smith', 'en');
  });
  it('renders an Arabic (RTL) document', async () => {
    await rendersToValidPdf('محمد', 'ar');
  });
  it('renders a CJK document', async () => {
    await rendersToValidPdf('田中太郎', 'ja');
  });
  it('renders a Devanagari document', async () => {
    await rendersToValidPdf('शर्मा', 'hi');
  });
  it('renders Turkish dotless-i correctly via Noto (no throw)', async () => {
    await rendersToValidPdf('Yıldırım', 'tr');
  });
  it('defaults to Latin when locale is omitted', async () => {
    const bytes = await renderPrefilledFormPdf(payload('Smith'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('degrades to a valid PDF and logs when font embedding fails', async () => {
    const fonts = require('../src/modules/prefill/pdf-fonts');
    const loadSpy = jest.spyOn(fonts, 'loadFont').mockImplementation(() => {
      throw new Error('font file missing');
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const bytes = await renderPrefilledFormPdf(payload('محمد'), 'ar');

    expect(bytes.length).toBeGreaterThan(0);
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(errSpy).toHaveBeenCalled();

    loadSpy.mockRestore();
    errSpy.mockRestore();
  });
});
