import OpenAI, { toFile } from 'openai';
import type {
  LanguageTag,
  SttProvider,
  SttResult,
  SttTranscribeInput,
} from './stt-provider.interface';

/**
 * OpenAI speech-to-text.
 *
 * OpenAI is not hard-coded as *the* provider — it is the only non-mock adapter
 * implemented because it is already the repository's configured AI vendor
 * (`AiService`, `AI_PROVIDERS`, `OPENAI_API_KEY`). Adding Azure Speech,
 * Deepgram or Google is a new file plus a factory line, exactly as with OCR.
 *
 * `supportedLanguages` is deliberately SHORT. The model accepts far more, but
 * Task 10 forbids claiming a language until STT, model behaviour, TTS, UI and
 * evaluation have all been validated for it. This list is the validated set,
 * not the vendor's marketing list.
 */
const VALIDATED_LANGUAGES: readonly LanguageTag[] = ['en', 'fr', 'es'];

export class OpenAiSttProvider implements SttProvider {
  readonly name = 'openai';
  readonly available: boolean;
  readonly supportedLanguages = VALIDATED_LANGUAGES;

  private client?: OpenAI;

  constructor(
    apiKey: string | undefined,
    private readonly model = 'whisper-1',
  ) {
    this.available = Boolean(apiKey);
    if (apiKey) this.client = new OpenAI({ apiKey });
  }

  async transcribe(input: SttTranscribeInput): Promise<SttResult> {
    if (!this.client) throw new Error('openai stt provider is not configured');

    const file = await toFile(
      input.audio,
      `utterance.${extensionFor(input.mimeType)}`,
      {
        type: input.mimeType,
      },
    );

    const response = await this.client.audio.transcriptions.create(
      {
        file,
        model: this.model,
        // Only pass the base tag: the API expects ISO-639-1, not BCP-47.
        ...(input.language ? { language: input.language.split('-')[0] } : {}),
        response_format: 'verbose_json',
      },
      { signal: input.signal },
    );

    const verbose = response as unknown as {
      text?: string;
      language?: string;
      duration?: number;
      segments?: { text: string; no_speech_prob?: number; start?: number }[];
    };

    const text = (verbose.text ?? '').trim();
    const segments = (verbose.segments ?? []).map((s) => ({
      text: s.text.trim(),
      isFinal: true,
      // Whisper reports the probability that a segment is NOT speech; invert it
      // for a confidence figure. Absent stays absent — never coerced to 0.
      confidence:
        s.no_speech_prob === undefined ? undefined : 1 - s.no_speech_prob,
      offsetMs: s.start === undefined ? undefined : Math.round(s.start * 1000),
    }));

    return {
      text,
      segments: segments.length > 0 ? segments : [{ text, isFinal: true }],
      detectedLanguage: verbose.language,
      durationMs: Math.round((verbose.duration ?? 0) * 1000),
      provider: this.name,
    };
  }
}

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
  };
  return map[mimeType.split(';')[0]?.trim() ?? ''] ?? 'webm';
}
