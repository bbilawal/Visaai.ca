import {
  assertOcrProviderImplemented,
  providerSupportsMime,
  unsupportedAcceptedMimeTypes,
} from './ocr-capability';
import { MockOcrProvider } from './mock-ocr.provider';
import { OpenAiOcrProvider } from './openai-ocr.provider';
import { AzureDocumentIntelligenceProvider } from './azure-document-intelligence.provider';
import { AwsTextractProvider } from './aws-textract.provider';
import { makeRunOcrNode } from '../graphs/nodes/run-ocr';
import type { DocumentState } from '../graphs/document.state';
import type { OcrProvider } from './ocr-provider.interface';

describe('OCR capability gating (PDF + provider implementation)', () => {
  const mock = new MockOcrProvider();
  const openai = new OpenAiOcrProvider('test-key');
  const azure = new AzureDocumentIntelligenceProvider({ region: 'eu' });
  // Still a scaffold (azure-di was implemented for OCR-001), so it is the one
  // that must still trip the capability gate.
  const textract = new AwsTextractProvider({ region: 'ca-central-1' });

  it('mock supports PDFs; openai is image-only', () => {
    expect(providerSupportsMime(mock, 'application/pdf')).toBe(true);
    expect(providerSupportsMime(openai, 'image/png')).toBe(true);
    expect(providerSupportsMime(openai, 'application/pdf')).toBe(false);
  });

  it('lists accepted-but-unsupported types (PDF under openai)', () => {
    expect(unsupportedAcceptedMimeTypes(openai)).toContain('application/pdf');
    expect(unsupportedAcceptedMimeTypes(mock)).toEqual([]);
  });

  it('assertOcrProviderImplemented passes implemented, throws scaffold (config-time)', () => {
    expect(() => assertOcrProviderImplemented(mock)).not.toThrow();
    expect(() => assertOcrProviderImplemented(openai)).not.toThrow();
    // azure-di is implemented as of OCR-001 — it is the provider production
    // actually runs, so it must pass.
    expect(() => assertOcrProviderImplemented(azure)).not.toThrow();
    // aws-textract remains a deliberate scaffold and must still fail fast.
    expect(() => assertOcrProviderImplemented(textract)).toThrow(
      /not implemented/i,
    );
  });

  it('openai.extract rejects a PDF before any SDK call', async () => {
    await expect(
      openai.extract({
        signedUrl: 'u',
        mimeType: 'application/pdf',
        region: 'global',
      }),
    ).rejects.toThrow(/image-only|cannot process/i);
  });
});

describe('run_ocr capability pre-check', () => {
  // Image-only provider whose extract() must NOT be reached for a PDF.
  function imageOnlyProvider(extract: jest.Mock): OcrProvider {
    return {
      name: 'openai',
      regional: false,
      capabilities: {
        implemented: true,
        mimeTypes: ['image/png', 'image/jpeg'],
      },
      extract,
    };
  }

  function state(mimeType: string): DocumentState {
    return {
      documentId: 'd',
      applicationId: 'a',
      storagePath: 'p',
      mimeType,
      documentType: 'passport',
      signedUrl: 'signed',
      rawOcrText: '',
      extractedFields: {},
      verificationResult: 'pass',
      verificationDetails: [],
      allDocsProcessed: false,
      error: null,
    } as unknown as DocumentState;
  }

  it('rejects an unsupported type with a clear error and never calls extract', async () => {
    const extract = jest.fn();
    const node = makeRunOcrNode(imageOnlyProvider(extract), {
      residencyMode: 'global',
      region: 'global',
    });
    const out = await node(state('application/pdf'));
    expect(out.error).toMatch(/does not support application\/pdf/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('proceeds for a supported type', async () => {
    const extract = jest.fn().mockResolvedValue({
      text: 'x',
      fields: { full_name: 'A', nationality: 'B' },
    });
    const node = makeRunOcrNode(imageOnlyProvider(extract), {
      residencyMode: 'global',
      region: 'global',
    });
    const out = await node(state('image/png'));
    expect(out.error).toBeUndefined();
    expect(out.verificationResult).toBe('pass');
    expect(extract).toHaveBeenCalledTimes(1);
  });
});
