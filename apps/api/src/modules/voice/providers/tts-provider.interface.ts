import type { LanguageTag } from './stt-provider.interface';

/**
 * Provider-neutral text-to-speech contract. Same shape rationale as the STT
 * interface and the existing OCR provider factory.
 */
export interface TtsSynthesizeInput {
  text: string;
  language: LanguageTag;
  /** Provider voice id. Omit for the adapter's default for that language. */
  voice?: string;
  /** 0.5–2.0. Accessibility requirement: users must be able to slow speech. */
  speed?: number;
  signal?: AbortSignal;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
  /**
   * Estimated when the provider does not report it. Used for cost control, so
   * an estimate is better than nothing — but it is an estimate.
   */
  durationMs: number;
  provider: string;
  voice: string;
}

export interface TtsVoice {
  id: string;
  label: string;
  language: LanguageTag;
}

export class TtsUnsupportedLanguageError extends Error {
  constructor(readonly language: LanguageTag) {
    super(`Speech synthesis is not available for ${language}`);
    this.name = 'TtsUnsupportedLanguageError';
  }
}

export interface TtsProvider {
  readonly name: string;
  readonly available: boolean;
  readonly supportedLanguages: readonly LanguageTag[];
  listVoices(language?: LanguageTag): TtsVoice[];
  synthesize(input: TtsSynthesizeInput): Promise<TtsResult>;
}

export const TTS_PROVIDER = Symbol('TtsProvider');
