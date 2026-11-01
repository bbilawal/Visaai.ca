import type {
  OcrProvider,
  OcrExtractionInput,
  OcrExtractionResult,
} from './ocr-provider.interface';
import { safeLog } from '../../shared/log/redact';
import { withRetryTimeout } from './retry';

export interface GoogleDocAiConfig {
  region: string;
  processorId?: string;
  credentialsJson?: string;
}

/**
 * Google Document AI (regional, e.g. eu / us / asia processors). REGIONAL.
 * Scaffolded with retry/timeout/audit; fails closed until processor + creds are
 * wired (@google-cloud/documentai).
 */
export class GoogleDocumentAiProvider implements OcrProvider {
  readonly name = 'google-docai';
  readonly regional = true;
  // Scaffold: processDocument not wired yet -> fails fast at boot via
  // assertOcrProviderImplemented. When wired, Document AI handles images + PDFs.
  readonly capabilities = {
    implemented: false,
    mimeTypes: [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
    ],
  };

  constructor(private cfg: GoogleDocAiConfig) {}

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!this.cfg.processorId || !this.cfg.credentialsJson) {
      throw new Error(
        'google-docai OCR is not configured (processor / credentials missing)',
      );
    }
    return withRetryTimeout(
      async (_signal) => {
        // TODO: processDocument via @google-cloud/documentai in this.cfg.region.
        throw new Error('google-docai OCR adapter not yet implemented');
      },
      {
        attempts: 3,
        timeoutMs: 30_000,
        onAttempt: (n) =>
          safeLog.warn(
            'ocr.google-docai',
            `attempt ${n} region=${this.cfg.region} mime=${input.mimeType}`,
          ),
      },
    );
  }
}
