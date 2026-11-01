import type {
  OcrProvider,
  OcrExtractionInput,
  OcrExtractionResult,
} from './ocr-provider.interface';
import { safeLog } from '../../shared/log/redact';
import { withRetryTimeout } from './retry';

export interface AwsTextractConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * AWS Textract (regional). REGIONAL: data stays in the configured AWS region.
 * Scaffolded with retry/timeout/audit; fails closed until credentials + the
 * @aws-sdk/client-textract call are wired.
 */
export class AwsTextractProvider implements OcrProvider {
  readonly name = 'aws-textract';
  readonly regional = true;
  // Scaffold: AnalyzeDocument not wired yet -> fails fast at boot via
  // assertOcrProviderImplemented. When wired, Textract handles images + PDFs.
  readonly capabilities = {
    implemented: false,
    mimeTypes: [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/pdf',
    ],
  };

  constructor(private cfg: AwsTextractConfig) {}

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!this.cfg.accessKeyId || !this.cfg.secretAccessKey) {
      throw new Error(
        'aws-textract OCR is not configured (AWS credentials missing)',
      );
    }
    return withRetryTimeout(
      async (_signal) => {
        // TODO: AnalyzeDocument via @aws-sdk/client-textract in this.cfg.region.
        throw new Error('aws-textract OCR adapter not yet implemented');
      },
      {
        attempts: 3,
        timeoutMs: 30_000,
        onAttempt: (n) =>
          safeLog.warn(
            'ocr.aws-textract',
            `attempt ${n} region=${this.cfg.region} mime=${input.mimeType}`,
          ),
      },
    );
  }
}
