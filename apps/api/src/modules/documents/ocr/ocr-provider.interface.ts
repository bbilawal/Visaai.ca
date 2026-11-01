import type { ExtractedFields } from '../graphs/document.state';

/**
 * Vendor-agnostic OCR abstraction (global platform). Business services depend on
 * this interface ONLY — never on Azure/AWS/Google SDKs directly. Add a provider
 * by implementing this and registering it in the factory; no core code changes.
 */
export interface OcrExtractionInput {
  /** Short-lived signed URL to the original document. */
  signedUrl: string;
  mimeType: string;
  /** Processing region (e.g. 'ca-central-1', 'eu', 'global'). Region-aware. */
  region: string;
  /**
   * Canonical `documents.document_type` (e.g. 'passport', 'admission_letter').
   * Optional: a provider that only does generic text extraction ignores it.
   * Providers that do structured extraction use it to ask for the right keys
   * (see `extraction-schema.ts`) instead of one passport-shaped key set.
   */
  documentType?: string;
}

export interface OcrExtractionResult {
  text: string;
  fields: ExtractedFields;
  /**
   * Token usage when the provider is LLM-based (e.g. openai), for cost metering.
   * Undefined for providers that don't expose it (mock / azure / aws / google).
   */
  usage?: { model: string; inputTokens: number; outputTokens: number };
}

/**
 * Declared capabilities of a provider — checked at config/boot time and at the
 * run_ocr node boundary so a mismatch fails fast with a clear message instead of
 * a silent mid-pipeline throw.
 */
export interface OcrCapabilities {
  /**
   * False for a scaffold whose remote call is not yet wired (azure/aws/google).
   * Selecting an unimplemented provider must fail fast at boot, not mid-pipeline.
   */
  readonly implemented: boolean;
  /** MIME types this provider can actually OCR. */
  readonly mimeTypes: readonly string[];
}

export interface OcrProvider {
  readonly name: string;
  /**
   * True when the provider keeps document data within the requested region
   * (managed regional services). Non-regional providers (mock/openai) are blocked
   * under residency modes other than 'global'.
   */
  readonly regional: boolean;
  readonly capabilities: OcrCapabilities;
  extract(input: OcrExtractionInput): Promise<OcrExtractionResult>;
}

/** MIME types accepted at the upload/scan boundary (allowlist in scan-document). */
export const ACCEPTED_DOCUMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

export type OcrProviderName =
  | 'mock'
  | 'openai'
  | 'azure-di'
  | 'aws-textract'
  | 'google-docai';
