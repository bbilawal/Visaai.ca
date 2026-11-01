import OpenAI from 'openai';
import type {
  OcrProvider,
  OcrExtractionInput,
  OcrExtractionResult,
} from './ocr-provider.interface';
import type { ExtractedFields } from '../graphs/document.state';
import { withRetryTimeout } from './retry';
import { extractionPromptFor } from './extraction-schema';

// NO language directive here by design: this is data EXTRACTION, not user prose.
// Extracted field values (names, dates, passport numbers) must stay in the
// document's source language/script — forcing a response language would corrupt
// them. The OCR output is internal data, never shown to the user as prose.
//
// The key list is per document type (`extraction-schema.ts`): a fixed
// passport-shaped schema read nothing useful out of an admission letter, a
// birth certificate or a property deed, so the applicant re-typed every one of
// those details by hand.
function ocrPrompt(documentType?: string): string {
  return `You are processing a scanned visa application document. Do two things and return ONE JSON object:

1. "text": the FULL raw text of the document exactly as it appears — preserve names, dates, numbers, and codes verbatim. No markdown, no interpretation.
2. "fields": structured data extracted from that text.

${extractionPromptFor(documentType)}

NEVER guess, infer, or complete a value that is not printed on the document — omit the key instead. Return strictly: {"text": "...", "fields": { ... }}. If nothing is extractable, use "fields": {}.`;
}

/**
 * OpenAI gpt-4o vision OCR. NON-REGIONAL (US): blocked under residency modes
 * other than 'global'. Kept for dev and as a fallback, not for regulated prod.
 */
export class OpenAiOcrProvider implements OcrProvider {
  readonly name = 'openai';
  readonly regional = false;
  // gpt-4o vision is IMAGE-ONLY. PDFs pass the upload/scan allowlist, so the
  // run_ocr node pre-checks this list and rejects an unsupported type with a
  // clear error BEFORE calling the SDK (no silent mid-pipeline throw). A PDF
  // upload under OCR_PROVIDER=openai therefore fails fast and explicitly; route
  // PDFs to a regional provider (azure/aws/google) or add a rasterize step.
  readonly capabilities = {
    implemented: true,
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  };
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /** Read the document from our own storage and inline it as a data: URL. */
  private async toDataUrl(input: OcrExtractionInput): Promise<string> {
    const res = await fetch(input.signedUrl);
    if (!res.ok) {
      // Signed URLs can echo the storage path, so the URL is never logged.
      throw new Error(
        `openai OCR could not read the document from storage (HTTP ${res.status})`,
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error('openai OCR read an empty document from storage');
    }
    return `data:${input.mimeType};base64,${bytes.toString('base64')}`;
  }

  async extract(input: OcrExtractionInput): Promise<OcrExtractionResult> {
    if (!this.capabilities.mimeTypes.includes(input.mimeType)) {
      throw new Error(
        `openai OCR cannot process ${input.mimeType} (image-only: ` +
          `${this.capabilities.mimeTypes.join(', ')}). Route PDFs to a regional ` +
          `provider or add a PDF->image rasterize step.`,
      );
    }

    // Inline the bytes as a data: URL rather than handing OpenAI a link to our
    // storage. On a deployment where SUPABASE_URL is loopback (the default for
    // the self-hosted stack and for local dev) a signed URL is unreachable from
    // outside, which is what made every Azure analyze return 403 — the same
    // trap, a different vendor. Uploading the content sidesteps it entirely.
    const dataUrl = await this.toDataUrl(input);

    const model = 'gpt-4o';
    const { raw, usage } = await withRetryTimeout(async (signal) => {
      const response = await this.client.chat.completions.create(
        {
          model,
          max_tokens: 2560,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: ocrPrompt(input.documentType) },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl, detail: 'high' },
                },
              ],
            },
          ],
        },
        { signal },
      );
      return {
        raw: response.choices[0]?.message?.content ?? '{}',
        // PRICE-8: capture usage (previously discarded) so OCR spend is metered.
        usage: {
          model,
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    });

    let text = '';
    let fields: ExtractedFields = {};
    try {
      const parsed = JSON.parse(raw) as { text?: unknown; fields?: unknown };
      if (typeof parsed.text === 'string') text = parsed.text;
      if (
        parsed.fields &&
        typeof parsed.fields === 'object' &&
        !Array.isArray(parsed.fields)
      ) {
        fields = parsed.fields as ExtractedFields;
      }
    } catch {
      text = raw;
    }
    return { text, fields, usage };
  }
}
