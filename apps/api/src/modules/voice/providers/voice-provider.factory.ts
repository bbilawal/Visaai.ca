import { Logger } from '@nestjs/common';
import type {
  SttProvider,
  SttTranscribeInput,
  SttResult,
} from './stt-provider.interface';
import type {
  TtsProvider,
  TtsSynthesizeInput,
  TtsResult,
} from './tts-provider.interface';
import { MockSttProvider } from './mock-stt.provider';
import { MockTtsProvider } from './mock-tts.provider';
import { OpenAiSttProvider } from './openai-stt.provider';
import { OpenAiTtsProvider } from './openai-tts.provider';

/**
 * Provider selection + resilience, mirroring `ocr-provider.factory.ts` and the
 * fallback chain in `AiService`.
 *
 * `VOICE_STT_PROVIDERS` / `VOICE_TTS_PROVIDERS` are comma-separated preference
 * chains (e.g. `openai,mock`). The FIRST AVAILABLE provider handles the call;
 * on timeout or failure the next one is tried. An unconfigured provider is
 * skipped rather than attempted, so a missing key degrades to the next vendor
 * instead of erroring.
 *
 * Default is `mock` alone. A deployment must opt in to a paid vendor
 * explicitly — nothing should start billing because a key happened to be set.
 */
export interface VoiceProviderConfig {
  sttChain: string;
  ttsChain: string;
  openaiApiKey?: string;
  sttModel?: string;
  ttsModel?: string;
  /** Per-attempt deadline. The chain as a whole can take longer. */
  timeoutMs: number;
}

export class VoiceProviderRegistry {
  private readonly log = new Logger(VoiceProviderRegistry.name);
  private readonly stt: SttProvider[];
  private readonly tts: TtsProvider[];

  constructor(private readonly config: VoiceProviderConfig) {
    this.stt = resolveChain(config.sttChain, (name) => {
      if (name === 'openai')
        return new OpenAiSttProvider(config.openaiApiKey, config.sttModel);
      if (name === 'mock') return new MockSttProvider();
      return null;
    });
    this.tts = resolveChain(config.ttsChain, (name) => {
      if (name === 'openai')
        return new OpenAiTtsProvider(config.openaiApiKey, config.ttsModel);
      if (name === 'mock') return new MockTtsProvider();
      return null;
    });
  }

  /** Providers actually usable right now, in preference order. */
  availableStt(): SttProvider[] {
    return this.stt.filter((p) => p.available);
  }

  availableTts(): TtsProvider[] {
    return this.tts.filter((p) => p.available);
  }

  /** Union of languages the configured chain can actually handle. */
  supportedLanguages(): string[] {
    const stt = new Set(
      this.availableStt().flatMap((p) => p.supportedLanguages),
    );
    const tts = new Set(
      this.availableTts().flatMap((p) => p.supportedLanguages),
    );
    // A language is only supported if BOTH directions work — claiming one the
    // assistant can hear but cannot speak would be a broken experience.
    return [...stt].filter((l) => tts.has(l)).sort();
  }

  async transcribe(input: SttTranscribeInput): Promise<SttResult> {
    return this.withFallback(this.availableStt(), 'stt', (provider, signal) =>
      provider.transcribe({ ...input, signal }),
    );
  }

  async synthesize(input: TtsSynthesizeInput): Promise<TtsResult> {
    return this.withFallback(this.availableTts(), 'tts', (provider, signal) =>
      provider.synthesize({ ...input, signal }),
    );
  }

  /**
   * Try each provider in order with a per-attempt timeout. Returns the first
   * success; throws the LAST error if every provider fails, because that is the
   * one describing the final state the caller is actually in.
   */
  private async withFallback<P extends { name: string }, R>(
    providers: P[],
    kind: 'stt' | 'tts',
    call: (provider: P, signal: AbortSignal) => Promise<R>,
  ): Promise<R> {
    if (providers.length === 0) {
      throw new Error(`no ${kind} provider is configured`);
    }

    let lastError: unknown;
    for (const provider of providers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        return await call(provider, controller.signal);
      } catch (err) {
        lastError = err;
        this.log.warn(
          `${kind} provider ${provider.name} failed: ${(err as Error).message}; trying next`,
        );
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`all ${kind} providers failed`);
  }
}

function resolveChain<T>(
  chain: string,
  build: (name: string) => T | null,
): T[] {
  const names = chain
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  const resolved: T[] = [];
  for (const name of names.length > 0 ? names : ['mock']) {
    const provider = build(name);
    if (provider) resolved.push(provider);
  }
  return resolved;
}
