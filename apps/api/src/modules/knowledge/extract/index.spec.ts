import {
  ExtractorRegistry,
  ExtractionError,
  MIN_OCR_CONFIDENCE,
  type KnowledgeOcrProvider,
} from './index';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
const HTML =
  '<html><body><h1>Visitor visa</h1><p>You must have a valid passport.</p></body></html>';
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

function ocr(text: string, confidence: number): KnowledgeOcrProvider {
  return {
    name: 'stub',
    recognize: () => Promise.resolve({ text, confidence, pageCount: 1 }),
  };
}

describe('ExtractorRegistry.select', () => {
  const registry = new ExtractorRegistry();

  it('picks the right extractor per content type', () => {
    expect(registry.select('text/html')!.name).toBe('html');
    expect(registry.select('application/pdf')!.name).toBe('pdf');
    expect(registry.select('text/csv')!.name).toBe('data');
    expect(
      registry.select(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )!.name,
    ).toBe('docx');
    expect(
      registry.select(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )!.name,
    ).toBe('spreadsheet');
  });

  it('returns null for a type nothing handles', () => {
    expect(registry.select('application/x-tar')).toBeNull();
  });
});

describe('ExtractorRegistry.extract', () => {
  it('extracts HTML without touching OCR', async () => {
    const provider = ocr('should not be used', 1);
    const spy = jest.spyOn(provider, 'recognize');
    const doc = await new ExtractorRegistry(provider).extract({
      bytes: bytes(HTML),
      contentType: 'text/html',
      url: 'https://gov.example/a',
    });
    expect(doc.text).toContain('valid passport');
    expect(doc.ocrApplied).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('routes an image straight to OCR', async () => {
    const doc = await new ExtractorRegistry(
      ocr('Scanned requirement text.', 0.9),
    ).extract({
      bytes: PNG,
      contentType: 'image/png',
      url: 'https://gov.example/scan.png',
    });
    expect(doc.ocrApplied).toBe(true);
    expect(doc.text).toContain('Scanned requirement');
    expect(doc.extractor).toBe('ocr:stub');
    // OCR output has no reliable structure, so none is invented.
    expect(doc.sections.every((s) => s.headingPath.length === 0)).toBe(true);
    expect(doc.warnings.join(' ')).toMatch(/structure is not available/);
  });

  it('fails loudly for an image when no OCR provider is configured', async () => {
    // Silence here would remove a document from the corpus while reporting success.
    await expect(
      new ExtractorRegistry().extract({
        bytes: PNG,
        contentType: 'image/png',
        url: 'https://gov.example/scan.png',
      }),
    ).rejects.toMatchObject({ reason: 'no_text_layer' });
  });

  it('rejects OCR output below the confidence floor', async () => {
    // Low-confidence OCR of a legal document is worse than no document: it
    // reads as authoritative and is wrong in ways a reader cannot detect.
    await expect(
      new ExtractorRegistry(
        ocr('garbled text', MIN_OCR_CONFIDENCE - 0.1),
      ).extract({
        bytes: PNG,
        contentType: 'image/png',
        url: 'https://gov.example/scan.png',
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it('rejects empty OCR output', async () => {
    await expect(
      new ExtractorRegistry(ocr('   ', 0.99)).extract({
        bytes: PNG,
        contentType: 'image/png',
        url: 'https://gov.example/scan.png',
      }),
    ).rejects.toMatchObject({ reason: 'empty' });
  });

  it('refuses a type it has no extractor for', async () => {
    await expect(
      new ExtractorRegistry().extract({
        bytes: bytes('x'),
        contentType: 'application/x-tar',
        url: 'https://gov.example/a',
      }),
    ).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('does not reach for OCR on a malformed document — that would produce plausible noise', async () => {
    const provider = ocr('invented text', 0.99);
    const spy = jest.spyOn(provider, 'recognize');
    await expect(
      new ExtractorRegistry(provider).extract({
        bytes: bytes('{not json'),
        contentType: 'application/json',
        url: 'https://gov.example/a.json',
      }),
    ).rejects.toMatchObject({ reason: 'malformed' });
    expect(spy).not.toHaveBeenCalled();
  });
});
