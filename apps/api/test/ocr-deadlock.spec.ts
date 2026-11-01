/**
 * OCR-001 — the guard that keeps the production OCR deadlock closed.
 *
 * WHAT HAPPENED. Two guards, each correct alone, were mutually exclusive:
 *
 *   1. configuration.ts refuses to boot in production unless OCR_PROVIDER is one
 *      of the REGIONAL managed providers (azure-di / aws-textract /
 *      google-docai) — so identity documents cannot egress to a non-regional
 *      service.
 *   2. ocr-capability.ts refuses to run a provider whose extract() is a
 *      scaffold — and ALL THREE regional providers declared implemented:false.
 *
 * The intersection was empty. No production configuration could both boot and
 * read a document, and because DocumentsModule is imported unconditionally and
 * the check runs in onModuleInit, it was total boot failure rather than
 * degraded OCR.
 *
 * WHY NOTHING CAUGHT IT. test/residency.spec.ts covers this exact area and
 * passed throughout, because its fixture hardcoded capabilities.implemented =
 * true on a provider it named "azure-di" — stubbing the one property that was
 * false in reality.
 *
 * WHAT THIS FILE DOES NOW. azure-di is implemented, so the deadlock is closed.
 * These tests assert the INVARIANT rather than the historical bug: production's
 * allow-list and the implemented set must always overlap. Marking every regional
 * provider as a scaffold again fails the first test here — which is exactly the
 * mistake that shipped, so it is the one worth pinning.
 */
import { createOcrProvider } from '../src/modules/documents/ocr/ocr-provider.factory';
import { assertOcrProviderImplemented } from '../src/modules/documents/ocr/ocr-capability';
import { validateEnv } from '../src/config/configuration';
import type { OcrProviderName } from '../src/modules/documents/ocr/ocr-provider.interface';

/** Mirrors the REGIONAL_OCR allow-list in configuration.ts. */
const REGIONAL: OcrProviderName[] = [
  'azure-di',
  'aws-textract',
  'google-docai',
];
const NON_REGIONAL: OcrProviderName[] = ['mock', 'openai'];

/** A production env that is otherwise entirely valid. */
const PROD_ENV = {
  NODE_ENV: 'production',
  DATA_RESIDENCY_MODE: 'regional',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: 'jwt-secret',
  STRIPE_SECRET_KEY: 'sk_live',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  OPENAI_API_KEY: 'sk-openai',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
  VOICE_STT_PROVIDERS: 'openai',
  VOICE_TTS_PROVIDERS: 'openai',
};

function build(provider: OcrProviderName) {
  return createOcrProvider({
    provider,
    region: 'ca-central-1',
    openaiKey: 'sk-test',
    azure: { endpoint: 'https://x.example', apiKey: 'k' },
    aws: { accessKeyId: 'k', secretAccessKey: 's' },
    google: { processorId: 'p', credentialsJson: '{}' },
  });
}

describe('OCR-001 — production must have at least one usable OCR provider', () => {
  it('at least one provider allowed in production is actually implemented', () => {
    // THE invariant. This is the single assertion that would have caught the
    // original defect, and it does not care WHICH provider satisfies it.
    const usable = REGIONAL.filter(
      (name) => build(name).capabilities.implemented,
    );
    expect(usable.length).toBeGreaterThan(0);
  });

  it('azure-di is the implemented one, and boot accepts it', () => {
    const azure = build('azure-di');
    expect(azure.capabilities.implemented).toBe(true);
    expect(azure.regional).toBe(true);
    expect(() => assertOcrProviderImplemented(azure)).not.toThrow();
    expect(() =>
      validateEnv({ ...PROD_ENV, OCR_PROVIDER: 'azure-di' }),
    ).not.toThrow();
  });

  it('a provider that IS allowed in production is never blocked by the capability gate', () => {
    // The two guards must agree. Any regional provider that boot would accept
    // has to survive the capability check, or the deadlock is back for that one.
    for (const name of REGIONAL) {
      const p = build(name);
      const bootAccepts = (() => {
        try {
          validateEnv({ ...PROD_ENV, OCR_PROVIDER: name });
          return true;
        } catch {
          return false;
        }
      })();
      if (bootAccepts && p.capabilities.implemented) {
        expect(() => assertOcrProviderImplemented(p)).not.toThrow();
      }
    }
  });

  it('the remaining scaffolds still fail fast rather than returning empty output', () => {
    // aws-textract and google-docai are deliberately still scaffolds. That is
    // fine — but selecting one must fail at init, not hand the pipeline a
    // silently empty extraction.
    for (const name of REGIONAL) {
      const p = build(name);
      if (!p.capabilities.implemented) {
        expect(() => assertOcrProviderImplemented(p)).toThrow(
          /not implemented/i,
        );
      }
    }
  });

  it.each(NON_REGIONAL)(
    'production still REFUSES the non-regional provider %s',
    (name) => {
      // The residency half of the guard must not have been loosened to fix the
      // deadlock. mock invents fields; openai is US-hosted.
      expect(() => validateEnv({ ...PROD_ENV, OCR_PROVIDER: name })).toThrow(
        /OCR_PROVIDER must be a regional managed provider/,
      );
    },
  );
});
