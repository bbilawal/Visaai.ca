import type { DocumentState } from '../document.state';
import type { OcrProvider } from '../../ocr/ocr-provider.interface';
import { makeRunOcrNode } from './run-ocr';
import { NonRetryableOcrError, OcrHttpError } from '../../ocr/retry';

function provider(extract: jest.Mock, regional = true): OcrProvider {
  return {
    name: 'azure-di',
    regional,
    capabilities: { implemented: true, mimeTypes: ['application/pdf'] },
    extract,
  };
}

const state = {
  documentId: 'd',
  applicationId: 'a',
  signedUrl: 'u',
  mimeType: 'application/pdf',
  documentType: 'bank_statement',
  error: null,
} as unknown as DocumentState;

const opts = { residencyMode: 'regional' as const, region: 'ca' };

/** The job queue retries only what can succeed on a later attempt. */
describe('run_ocr — errorRetryable', () => {
  it('marks an exhausted 429 as retryable', async () => {
    const node = makeRunOcrNode(
      provider(jest.fn().mockRejectedValue(new OcrHttpError('HTTP 429', 429))),
      opts,
    );
    const out = await node(state);
    expect(out.error).toMatch(/HTTP 429/);
    expect(out.errorRetryable).toBe(true);
  });

  it('marks a 400 as not retryable', async () => {
    const node = makeRunOcrNode(
      provider(jest.fn().mockRejectedValue(new OcrHttpError('HTTP 400', 400))),
      opts,
    );
    expect((await node(state)).errorRetryable).toBe(false);
  });

  it('marks a document-level failure as not retryable', async () => {
    const node = makeRunOcrNode(
      provider(
        jest.fn().mockRejectedValue(new NonRetryableOcrError('InvalidImage')),
      ),
      opts,
    );
    expect((await node(state)).errorRetryable).toBe(false);
  });

  it('marks a residency block as not retryable', async () => {
    const node = makeRunOcrNode(provider(jest.fn(), false), opts);
    const out = await node(state);
    expect(out.error).toMatch(/residency/);
    expect(out.errorRetryable).toBe(false);
  });

  it('marks an unsupported mime type as not retryable', async () => {
    const node = makeRunOcrNode(provider(jest.fn()), opts);
    const out = await node({ ...state, mimeType: 'image/tiff' });
    expect(out.errorRetryable).toBe(false);
  });
});
