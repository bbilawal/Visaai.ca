import { MockSttProvider } from './mock-stt.provider';
import { MockTtsProvider } from './mock-tts.provider';
import { SttUnsupportedLanguageError } from './stt-provider.interface';
import { TtsUnsupportedLanguageError } from './tts-provider.interface';
import { VoiceProviderRegistry } from './voice-provider.factory';

/**
 * Adapter contract tests. Any new STT/TTS adapter must satisfy the same
 * assertions, which is the point of having an interface at all.
 */
const baseConfig = {
  sttChain: 'mock',
  ttsChain: 'mock',
  timeoutMs: 1000,
};

describe('MockSttProvider', () => {
  const provider = new MockSttProvider();

  it('is always available so CI never needs a vendor key', () => {
    expect(provider.available).toBe(true);
  });

  it('produces a deterministic transcript for the same audio', async () => {
    const audio = Buffer.alloc(320);
    const a = await provider.transcribe({
      audio,
      mimeType: 'audio/wav',
      language: 'en',
    });
    const b = await provider.transcribe({
      audio,
      mimeType: 'audio/wav',
      language: 'en',
    });
    expect(a.text).toBe(b.text);
  });

  it('produces different transcripts for different audio', async () => {
    const a = await provider.transcribe({
      audio: Buffer.alloc(320),
      mimeType: 'audio/wav',
    });
    const b = await provider.transcribe({
      audio: Buffer.alloc(640),
      mimeType: 'audio/wav',
    });
    expect(a.text).not.toBe(b.text);
  });

  it('reports a duration derived from the audio, for cost control', async () => {
    const result = await provider.transcribe({
      audio: Buffer.alloc(3200),
      mimeType: 'audio/wav',
    });
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('rejects an unsupported language rather than silently using English', async () => {
    await expect(
      provider.transcribe({
        audio: Buffer.alloc(32),
        mimeType: 'audio/wav',
        language: 'sw',
      }),
    ).rejects.toBeInstanceOf(SttUnsupportedLanguageError);
  });

  it('accepts a regional tag by its base language', async () => {
    const result = await provider.transcribe({
      audio: Buffer.alloc(32),
      mimeType: 'audio/wav',
      language: 'fr-CA',
    });
    expect(result.detectedLanguage).toBe('fr');
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.transcribe({
        audio: Buffer.alloc(32),
        mimeType: 'audio/wav',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

describe('MockTtsProvider', () => {
  const provider = new MockTtsProvider();

  it('lists voices for a language', () => {
    expect(provider.listVoices('fr').every((v) => v.language === 'fr')).toBe(
      true,
    );
  });

  it('synthesises deterministic audio', async () => {
    const result = await provider.synthesize({ text: 'hello', language: 'en' });
    expect(result.audio.toString('utf8')).toContain('hello');
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('reports a longer duration for longer text', async () => {
    const short = await provider.synthesize({ text: 'hi', language: 'en' });
    const long = await provider.synthesize({
      text: 'hi '.repeat(200),
      language: 'en',
    });
    expect(long.durationMs).toBeGreaterThan(short.durationMs);
  });

  it('shortens duration as playback speed increases (accessibility control)', async () => {
    const normal = await provider.synthesize({
      text: 'hello there',
      language: 'en',
      speed: 1,
    });
    const fast = await provider.synthesize({
      text: 'hello there',
      language: 'en',
      speed: 2,
    });
    expect(fast.durationMs).toBeLessThan(normal.durationMs);
  });

  it('rejects an unsupported language', async () => {
    await expect(
      provider.synthesize({ text: 'hi', language: 'sw' }),
    ).rejects.toBeInstanceOf(TtsUnsupportedLanguageError);
  });
});

describe('VoiceProviderRegistry', () => {
  it('defaults to mock when no chain is configured', () => {
    const registry = new VoiceProviderRegistry({
      ...baseConfig,
      sttChain: '',
      ttsChain: '',
    });
    expect(registry.availableStt().map((p) => p.name)).toEqual(['mock']);
    expect(registry.availableTts().map((p) => p.name)).toEqual(['mock']);
  });

  it('skips a provider with no credentials instead of attempting it', () => {
    // openai first, but no API key -> unavailable, so mock handles the call.
    const registry = new VoiceProviderRegistry({
      ...baseConfig,
      sttChain: 'openai,mock',
      ttsChain: 'openai,mock',
    });
    expect(registry.availableStt().map((p) => p.name)).toEqual(['mock']);
  });

  it('keeps a configured provider ahead of the fallback', () => {
    const registry = new VoiceProviderRegistry({
      ...baseConfig,
      sttChain: 'openai,mock',
      openaiApiKey: 'sk-test',
    });
    expect(registry.availableStt().map((p) => p.name)).toEqual([
      'openai',
      'mock',
    ]);
  });

  it('falls back to the next provider when the first fails', async () => {
    const registry = new VoiceProviderRegistry(baseConfig);
    const failing = {
      name: 'failing',
      available: true,
      supportedLanguages: ['en'],
      transcribe: jest.fn().mockRejectedValue(new Error('provider down')),
    };
    // Inject a failing provider ahead of the mock.
    (registry as unknown as { stt: unknown[] }).stt = [
      failing,
      new MockSttProvider(),
    ];

    const result = await registry.transcribe({
      audio: Buffer.alloc(32),
      mimeType: 'audio/wav',
    });

    expect(failing.transcribe).toHaveBeenCalled();
    expect(result.provider).toBe('mock');
  });

  it('throws the last error when every provider fails', async () => {
    const registry = new VoiceProviderRegistry(baseConfig);
    (registry as unknown as { stt: unknown[] }).stt = [
      {
        name: 'a',
        available: true,
        supportedLanguages: [],
        transcribe: () => Promise.reject(new Error('first')),
      },
      {
        name: 'b',
        available: true,
        supportedLanguages: [],
        transcribe: () => Promise.reject(new Error('last')),
      },
    ];
    await expect(
      registry.transcribe({ audio: Buffer.alloc(4), mimeType: 'audio/wav' }),
    ).rejects.toThrow('last');
  });

  it('errors clearly when nothing is configured at all', async () => {
    const registry = new VoiceProviderRegistry(baseConfig);
    (registry as unknown as { stt: unknown[] }).stt = [];
    await expect(
      registry.transcribe({ audio: Buffer.alloc(4), mimeType: 'audio/wav' }),
    ).rejects.toThrow(/no stt provider/i);
  });

  it('only reports a language as supported when BOTH stt and tts can handle it', () => {
    const registry = new VoiceProviderRegistry(baseConfig);
    (registry as unknown as { tts: unknown[] }).tts = [
      {
        name: 'partial',
        available: true,
        supportedLanguages: ['en'],
        listVoices: () => [],
        synthesize: jest.fn(),
      },
    ];
    // Mock STT supports en/fr/es; this TTS supports only en.
    expect(registry.supportedLanguages()).toEqual(['en']);
  });

  it('applies a per-attempt timeout', async () => {
    const registry = new VoiceProviderRegistry({
      ...baseConfig,
      timeoutMs: 20,
    });
    (registry as unknown as { stt: unknown[] }).stt = [
      {
        name: 'slow',
        available: true,
        supportedLanguages: ['en'],
        transcribe: (input: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            input.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      },
      new MockSttProvider(),
    ];

    const result = await registry.transcribe({
      audio: Buffer.alloc(32),
      mimeType: 'audio/wav',
    });
    // The slow provider is abandoned and the next one answers.
    expect(result.provider).toBe('mock');
  });
});
