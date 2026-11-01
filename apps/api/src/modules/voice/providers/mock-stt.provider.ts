import type {
  LanguageTag,
  SttProvider,
  SttResult,
  SttTranscribeInput,
} from './stt-provider.interface';
import { SttUnsupportedLanguageError } from './stt-provider.interface';

/**
 * Deterministic STT for development, CI, and every automated test.
 *
 * This is the DEFAULT provider, mirroring `mock-ocr.provider.ts`. Tests must
 * never reach a paid vendor: it makes the suite slow, flaky, non-deterministic,
 * and expensive, and it would send synthetic audio to a third party.
 *
 * The mock is behavioural, not a stub returning a constant: it derives its
 * output from the input so that language handling, unsupported-language
 * rejection, and duration-based cost control can all be exercised for real.
 */
export const MOCK_TRANSCRIPT_HEADER = 'mock-transcript:';

/** Rough PCM-16 mono 16 kHz assumption — good enough for deterministic tests. */
const BYTES_PER_MS = 32;

export class MockSttProvider implements SttProvider {
  readonly name = 'mock';
  readonly available = true;
  readonly supportedLanguages: readonly LanguageTag[] = ['en', 'fr', 'es'];

  async transcribe(input: SttTranscribeInput): Promise<SttResult> {
    if (input.signal?.aborted) throw new Error('aborted');

    const language = input.language ?? 'en';
    const base = language.split('-')[0];
    if (!this.supportedLanguages.includes(base)) {
      // Exercised by tests: an unsupported language must fail loudly rather
      // than silently transcribing as English.
      throw new SttUnsupportedLanguageError(language);
    }

    // Deterministic text derived from the audio so different inputs produce
    // different transcripts, and the same input always produces the same one.
    const fingerprint = input.audio.length.toString(16);
    const text = `${MOCK_TRANSCRIPT_HEADER} ${base} ${fingerprint}`;
    const durationMs = Math.max(
      1,
      Math.round(input.audio.length / BYTES_PER_MS),
    );

    return {
      text,
      segments: [
        { text, isFinal: true, confidence: 0.99, detectedLanguage: base },
      ],
      detectedLanguage: base,
      durationMs,
      provider: this.name,
    };
  }
}
