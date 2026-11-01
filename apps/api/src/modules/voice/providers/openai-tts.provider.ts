import OpenAI from 'openai';
import type { LanguageTag } from './stt-provider.interface';
import type {
  TtsProvider,
  TtsResult,
  TtsSynthesizeInput,
  TtsVoice,
} from './tts-provider.interface';

/**
 * OpenAI text-to-speech. Same rationale as the STT adapter: implemented because
 * OpenAI is already the configured vendor, not because the design assumes it.
 *
 * Validated languages only — see the note in `openai-stt.provider.ts`.
 */
const VALIDATED_LANGUAGES: readonly LanguageTag[] = ['en', 'fr', 'es'];

/** The model is multilingual; the voice is a timbre, not a language. */
const VOICES: TtsVoice[] = [
  { id: 'alloy', label: 'Alloy (neutral)', language: 'en' },
  { id: 'nova', label: 'Nova (warm)', language: 'en' },
  { id: 'alloy', label: 'Alloy (neutre)', language: 'fr' },
  { id: 'nova', label: 'Nova (cálida)', language: 'es' },
];

/** Fallback duration estimate when the response carries no duration header. */
const CHARS_PER_SECOND = 14;

export class OpenAiTtsProvider implements TtsProvider {
  readonly name = 'openai';
  readonly available: boolean;
  readonly supportedLanguages = VALIDATED_LANGUAGES;

  private client?: OpenAI;

  constructor(
    apiKey: string | undefined,
    private readonly model = 'gpt-4o-mini-tts',
  ) {
    this.available = Boolean(apiKey);
    if (apiKey) this.client = new OpenAI({ apiKey });
  }

  listVoices(language?: LanguageTag): TtsVoice[] {
    if (!language) return [...VOICES];
    const base = language.split('-')[0];
    return VOICES.filter((v) => v.language === base);
  }

  async synthesize(input: TtsSynthesizeInput): Promise<TtsResult> {
    if (!this.client) throw new Error('openai tts provider is not configured');

    const voice =
      input.voice ?? this.listVoices(input.language)[0]?.id ?? 'alloy';

    const response = await this.client.audio.speech.create(
      {
        model: this.model,
        voice,
        input: input.text,
        response_format: 'mp3',
        ...(input.speed ? { speed: clampSpeed(input.speed) } : {}),
      },
      { signal: input.signal },
    );

    const audio = Buffer.from(await response.arrayBuffer());

    return {
      audio,
      mimeType: 'audio/mpeg',
      // The API returns no duration; estimate from text length. Flagged as an
      // estimate in the interface because cost control depends on it.
      durationMs: Math.max(
        1,
        Math.round(
          (input.text.length / CHARS_PER_SECOND / (input.speed ?? 1)) * 1000,
        ),
      ),
      provider: this.name,
      voice,
    };
  }
}

/** The API rejects anything outside 0.25–4.0; our UI range is 0.5–2.0. */
function clampSpeed(speed: number): number {
  return Math.min(2, Math.max(0.5, speed));
}
