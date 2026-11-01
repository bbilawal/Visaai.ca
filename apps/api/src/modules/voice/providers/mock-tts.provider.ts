import type { LanguageTag } from './stt-provider.interface';
import type {
  TtsProvider,
  TtsResult,
  TtsSynthesizeInput,
  TtsVoice,
} from './tts-provider.interface';
import { TtsUnsupportedLanguageError } from './tts-provider.interface';

/**
 * Deterministic TTS for development, CI and tests. Default provider, mirroring
 * `mock-ocr.provider.ts`. Emits a small deterministic buffer rather than real
 * audio — enough to exercise streaming, playback control, duration accounting
 * and cost limits without calling a paid vendor.
 */
/** Speaking rate used to estimate duration: ~14 characters per second. */
const CHARS_PER_SECOND = 14;

export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock';
  readonly available = true;
  readonly supportedLanguages: readonly LanguageTag[] = ['en', 'fr', 'es'];

  private readonly voices: TtsVoice[] = [
    { id: 'mock-en', label: 'Mock (English)', language: 'en' },
    { id: 'mock-fr', label: 'Mock (French)', language: 'fr' },
    { id: 'mock-es', label: 'Mock (Spanish)', language: 'es' },
  ];

  listVoices(language?: LanguageTag): TtsVoice[] {
    if (!language) return [...this.voices];
    const base = language.split('-')[0];
    return this.voices.filter((v) => v.language === base);
  }

  async synthesize(input: TtsSynthesizeInput): Promise<TtsResult> {
    if (input.signal?.aborted) throw new Error('aborted');

    const base = input.language.split('-')[0] ?? 'en';
    if (!this.supportedLanguages.includes(base)) {
      throw new TtsUnsupportedLanguageError(input.language);
    }

    const speed = input.speed ?? 1;
    const durationMs = Math.max(
      1,
      Math.round((input.text.length / CHARS_PER_SECOND / speed) * 1000),
    );

    return {
      // Deterministic and inspectable: the test can assert what was spoken
      // without decoding audio.
      audio: Buffer.from(`mock-audio:${base}:${input.text}`, 'utf8'),
      mimeType: 'audio/mpeg',
      durationMs,
      provider: this.name,
      voice: input.voice ?? this.listVoices(base)[0]?.id ?? 'mock-en',
    };
  }
}
