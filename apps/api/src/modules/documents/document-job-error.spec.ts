import { UnrecoverableError } from 'bullmq';
import { documentJobError } from './document-job-error';

describe('documentJobError', () => {
  it('lets BullMQ retry a transient failure', () => {
    const err = documentJobError('d1', 'OCR failed: HTTP 429', true);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    expect(err.message).toMatch(/d1.*HTTP 429/);
  });

  it('fails fast on a failure that would repeat on every attempt', () => {
    expect(
      documentJobError('d1', 'OCR failed: HTTP 400', false),
    ).toBeInstanceOf(UnrecoverableError);
  });

  it('defaults to retryable when the graph did not say', () => {
    expect(documentJobError('d1', 'scan failed', null)).not.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
