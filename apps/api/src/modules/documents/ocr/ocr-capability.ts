import {
  ACCEPTED_DOCUMENT_MIME_TYPES,
  type OcrProvider,
} from './ocr-provider.interface';

/**
 * Config/boot-time validation of the selected OCR provider (GAPS.md §5/§6).
 *
 * The regional scaffolds (azure-di / aws-textract / google-docai) throw
 * "not yet implemented" from inside extract() — i.e. a misconfiguration only
 * surfaced mid-pipeline, per document, after the upload + scan + signed URL were
 * already spent. These helpers move the failure to module init so an
 * unimplemented or capability-mismatched provider fails fast with a clear
 * message.
 */

/** Throws if the selected provider is a scaffold (extract() not wired). */
export function assertOcrProviderImplemented(provider: OcrProvider): void {
  if (!provider.capabilities) return; // undeclared => assume implemented
  if (!provider.capabilities.implemented) {
    throw new Error(
      `OCR_PROVIDER "${provider.name}" is selected but not implemented ` +
        `(scaffold — its extract() is not wired yet). Configure an implemented ` +
        `provider (mock for dev/test, openai for images) or finish wiring ` +
        `"${provider.name}" before selecting it.`,
    );
  }
}

export function providerSupportsMime(
  provider: OcrProvider,
  mimeType: string,
): boolean {
  // Backward-compatible: a provider that does not declare capabilities is
  // treated as accepting everything the scan gate allowed (no extra gating).
  if (!provider.capabilities) return true;
  return provider.capabilities.mimeTypes.includes(mimeType);
}

/**
 * MIME types accepted at the upload boundary that the selected provider CANNOT
 * OCR. Non-empty => those uploads will be rejected at run_ocr with a clear error
 * (e.g. PDFs under OCR_PROVIDER=openai). Surfaced as a boot warning, not a hard
 * throw, because an image-only OCR deployment is a legitimate configuration.
 */
export function unsupportedAcceptedMimeTypes(provider: OcrProvider): string[] {
  if (!provider.capabilities || !provider.capabilities.implemented) return [];
  return ACCEPTED_DOCUMENT_MIME_TYPES.filter(
    (m) => !provider.capabilities.mimeTypes.includes(m),
  );
}
