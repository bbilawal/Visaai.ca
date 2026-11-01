import type {
  OcrProvider,
  OcrExtractionInput,
  OcrExtractionResult,
} from './ocr-provider.interface';

/**
 * Deterministic OCR provider for development and tests. No network, no cost.
 * Marked regional=true so it is usable under any residency mode in non-prod
 * (production config forbids it via the regional-managed-provider check).
 */
export class MockOcrProvider implements OcrProvider {
  readonly name = 'mock';
  readonly regional = true;
  // Deterministic dev/test provider — accepts every type the scan gate allows.
  readonly capabilities = {
    implemented: true,
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

  async extract(_input: OcrExtractionInput): Promise<OcrExtractionResult> {
    return {
      text: 'MOCK OCR TEXT',
      fields: { full_name: 'Test User', nationality: 'XX' },
    };
  }
}
