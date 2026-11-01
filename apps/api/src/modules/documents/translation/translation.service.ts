import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../shared/ai/ai.service';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import {
  asUntrustedData,
  UNTRUSTED_DATA_DIRECTIVE,
} from '../../shared/ai/untrusted';

/**
 * Document-content translation (GAPS.md §C).
 *
 * Non-English OCR text is translated to English (or a target language) FOR
 * HUMAN REVIEW — it never overwrites the source `rawOcrText` (the residency /
 * fidelity reason OCR deliberately does not translate). The translation goes
 * through the shared, multi-provider, metered `AiService` (NOT a raw SDK), so it
 * is priced into ai_usage_events like every other AI call. The provider/model is
 * chosen by AiService's configured chain (AI_PROVIDERS) — to default to Claude,
 * put `anthropic` first in that chain at the platform level.
 *
 * Best-effort: callers run this in a swallow-and-log block (post-graph), so a
 * translation failure never fails or retries the OCR job.
 */

const SYSTEM_PROMPT = `You translate scanned immigration document text into the target language for a human reviewer.
Rules:
- Translate prose faithfully and completely.
- PRESERVE VERBATIM (do not translate or reformat): proper nouns, personal names, place names, organization names, passport/ID/reference numbers, account numbers, dates, currency amounts, and any alphanumeric codes.
- Do not add commentary, notes, or explanations.
Return ONE JSON object exactly: {"translated_text": "..."}`;

export interface TranslateInput {
  documentId: string;
  applicationId: string;
  userId?: string | null;
  sourceLang: string;
  rawText: string;
  targetLang?: string;
}

export interface TranslateResult {
  translated: boolean;
  reason?: string;
}

@Injectable()
export class TranslationService {
  private readonly log = new Logger(TranslationService.name);

  constructor(
    private readonly ai: AiService,
    private readonly supabase: SupabaseService,
  ) {}

  async translateDocument(input: TranslateInput): Promise<TranslateResult> {
    const targetLang = input.targetLang ?? 'en';

    if (!input.rawText?.trim()) {
      return { translated: false, reason: 'empty source text' };
    }
    if (input.sourceLang === targetLang) {
      return { translated: false, reason: 'source already in target language' };
    }
    if (!this.ai.available) {
      return { translated: false, reason: 'no AI provider configured' };
    }

    // SEC-6003: OCR text from an uploaded document is untrusted — it can carry
    // injected instructions. Fence it and tell the model it is DATA to be
    // translated, never instructions to obey.
    const content = await this.ai.completeJSON({
      system: `${SYSTEM_PROMPT}\n\n${UNTRUSTED_DATA_DIRECTIVE}`,
      user: asUntrustedData('document text to translate', input.rawText),
      json: true,
      maxTokens: 4096,
      meta: {
        operation: 'translation',
        applicationId: input.applicationId,
        userId: input.userId ?? null,
      },
    });

    let translatedText = '';
    try {
      const parsed = JSON.parse(content) as { translated_text?: unknown };
      if (typeof parsed.translated_text === 'string') {
        translatedText = parsed.translated_text;
      }
    } catch {
      // Provider returned non-JSON despite json mode — fall back to raw content.
      translatedText = content;
    }

    if (!translatedText.trim()) {
      return { translated: false, reason: 'empty translation' };
    }

    // Idempotent upsert: one translation per (document, target language).
    // provider/model are owned/metered by AiService's chain; not surfaced here.
    const { error } = await this.supabase.admin
      .from('document_translations')
      .upsert(
        {
          document_id: input.documentId,
          application_id: input.applicationId,
          source_lang: input.sourceLang,
          target_lang: targetLang,
          translated_text: translatedText,
        },
        { onConflict: 'document_id,target_lang' },
      );

    if (error) {
      this.log.warn(
        `document_translations upsert failed for ${input.documentId}: ${error.message}`,
      );
      return { translated: false, reason: error.message };
    }

    return { translated: true };
  }
}
