import type { DocumentState } from '../document.state';
import type { OcrProvider } from '../../ocr/ocr-provider.interface';
import { providerSupportsMime } from '../../ocr/ocr-capability';
import type { AiUsageMeter } from '../../../shared/ai/ai-usage.meter';
import { isRetryableError } from '../../ocr/retry';

export type ResidencyMode = 'regional' | 'global' | 'jurisdiction-specific';

export interface OcrOptions {
  residencyMode: ResidencyMode;
  region: string;
}

/**
 * OCR node. Vendor-agnostic: depends only on the OcrProvider interface. Enforces
 * the data-residency guard (under any non-global mode, only a regional provider
 * may process raw identity/financial documents) before delegating extraction.
 */
export function makeRunOcrNode(
  ocr: OcrProvider,
  opts: OcrOptions,
  meter?: AiUsageMeter,
) {
  return async function runOcr(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};

    if (opts.residencyMode !== 'global' && !ocr.regional) {
      return {
        error:
          `OCR blocked by data-residency policy (${opts.residencyMode}): provider ` +
          `"${ocr.name}" is not regional. Configure a regional OCR_PROVIDER.`,
        errorRetryable: false,
      };
    }

    // Capability pre-check: the upload/scan allowlist accepts more types than
    // some providers can OCR (e.g. PDFs pass the scan gate but openai is
    // image-only). Reject here with a clear, structured error BEFORE spending an
    // SDK call — so an accepted-but-unsupported type can never silently fail.
    if (!providerSupportsMime(ocr, state.mimeType)) {
      return {
        error:
          `OCR provider "${ocr.name}" does not support ${state.mimeType} ` +
          `(supported: ${ocr.capabilities.mimeTypes.join(', ')}). Route this ` +
          `type to a provider that supports it (e.g. a regional provider for PDFs).`,
        errorRetryable: false,
      };
    }

    try {
      const { text, fields, usage } = await ocr.extract({
        signedUrl: state.signedUrl,
        mimeType: state.mimeType,
        region: opts.region,
        // Lets a structured-extraction provider ask for the keys that this KIND
        // of document actually carries (admission letter, deed, birth
        // certificate), not just the passport/bank set.
        documentType: state.documentType,
      });

      // PRICE-8: meter LLM-based OCR spend (usage present only for openai).
      if (usage && meter) {
        void meter.record({
          operation: 'ocr',
          applicationId: state.applicationId,
          provider: 'openai',
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      }

      const fieldCount = Object.keys(fields).length;
      const verificationResult: 'pass' | 'warn' | 'fail' =
        fieldCount >= 2 ? 'pass' : fieldCount === 1 ? 'warn' : 'fail';

      return { rawOcrText: text, extractedFields: fields, verificationResult };
    } catch (err) {
      return {
        error: `OCR failed: ${err instanceof Error ? err.message : 'unknown'}`,
        errorRetryable: isRetryableError(err),
      };
    }
  };
}
