/**
 * Provider-neutral speech-to-text contract.
 *
 * Shaped deliberately like `modules/documents/ocr/ocr-provider.interface.ts`:
 * an interface, per-vendor adapters, and a factory chosen by config, with
 * `mock` as the default. Business code depends on this interface only, so
 * swapping vendors — or running with no vendor at all in CI — is a config
 * change rather than a code change.
 */

/** BCP-47 tag, e.g. `en-CA`, `fr-CA`, `es`. */
export type LanguageTag = string;

export interface SttSegment {
  /** Text recognised so far, or the final utterance. */
  text: string;
  /**
   * False while the recogniser may still revise this text. A UI must render
   * interim segments differently — showing an interim as final makes the
   * assistant look like it misheard when it simply had not finished.
   */
  isFinal: boolean;
  /**
   * 0..1 where the provider supplies it. ABSENT means "not reported", which is
   * NOT the same as low confidence; callers must not coerce it to 0.
   */
  confidence?: number;
  /** Detected language, when the provider performs detection. */
  detectedLanguage?: LanguageTag;
  /** Milliseconds from the start of the utterance. */
  offsetMs?: number;
}

export interface SttTranscribeInput {
  /** Complete utterance audio. */
  audio: Buffer;
  /** Container/codec, e.g. `audio/webm`, `audio/m4a`, `audio/wav`. */
  mimeType: string;
  /**
   * Caller-selected language. Omit to let the provider detect. An explicit tag
   * materially improves accuracy and is preferred whenever the user has chosen
   * a language in the app.
   */
  language?: LanguageTag;
  /** Abort signal — the caller owns the timeout budget. */
  signal?: AbortSignal;
}

export interface SttResult {
  segments: SttSegment[];
  /** Concatenated final text, punctuation-normalised. */
  text: string;
  detectedLanguage?: LanguageTag;
  /** Audio length, used for metering and cost control. */
  durationMs: number;
  provider: string;
}

export class SttUnsupportedLanguageError extends Error {
  constructor(readonly language: LanguageTag) {
    super(`Speech recognition is not available for ${language}`);
    this.name = 'SttUnsupportedLanguageError';
  }
}

export interface SttProvider {
  readonly name: string;
  /** False when credentials are absent; the factory skips unavailable providers. */
  readonly available: boolean;
  /** Languages this adapter is validated for. Empty = provider auto-detects. */
  readonly supportedLanguages: readonly LanguageTag[];
  transcribe(input: SttTranscribeInput): Promise<SttResult>;
}

export const STT_PROVIDER = Symbol('SttProvider');
