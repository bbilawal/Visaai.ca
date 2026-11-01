/**
 * OCR provider pattern: the factory resolves the configured vendor and every
 * provider satisfies the same interface (business code depends only on it).
 */
import { createOcrProvider } from '../src/modules/documents/ocr/ocr-provider.factory';

describe('createOcrProvider', () => {
  it('resolves the mock provider (regional, usable in dev)', () => {
    const p = createOcrProvider({ provider: 'mock', region: 'global' });
    expect(p.name).toBe('mock');
    expect(p.regional).toBe(true);
  });

  it('resolves openai as non-regional', () => {
    const p = createOcrProvider({
      provider: 'openai',
      region: 'global',
      openaiKey: 'sk',
    });
    expect(p.name).toBe('openai');
    expect(p.regional).toBe(false);
  });

  it('resolves regional managed providers', () => {
    expect(
      createOcrProvider({ provider: 'azure-di', region: 'ca-central-1' })
        .regional,
    ).toBe(true);
    expect(
      createOcrProvider({ provider: 'aws-textract', region: 'ca-central-1' })
        .regional,
    ).toBe(true);
    expect(
      createOcrProvider({ provider: 'google-docai', region: 'eu' }).regional,
    ).toBe(true);
  });

  it('mock provider returns the OcrExtractionResult shape', async () => {
    const p = createOcrProvider({ provider: 'mock', region: 'global' });
    const r = await p.extract({
      signedUrl: 'x',
      mimeType: 'image/png',
      region: 'global',
    });
    expect(typeof r.text).toBe('string');
    expect(typeof r.fields).toBe('object');
  });

  it('unconfigured azure-di fails closed', async () => {
    const p = createOcrProvider({
      provider: 'azure-di',
      region: 'ca-central-1',
    });
    await expect(
      p.extract({
        signedUrl: 'x',
        mimeType: 'image/png',
        region: 'ca-central-1',
      }),
    ).rejects.toThrow();
  });
});
