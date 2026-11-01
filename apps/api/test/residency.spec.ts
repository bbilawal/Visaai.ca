/**
 * Data-residency enforcement (global platform).
 *  - validateEnv refuses to boot in production unless residency is enforced
 *    (mode != global) and a regional managed OCR provider is configured.
 *  - the run-ocr node fails closed (blocks non-regional providers) under any
 *    non-global residency mode.
 */
import { validateEnv } from '../src/config/configuration';
import { makeRunOcrNode } from '../src/modules/documents/graphs/nodes/run-ocr';
import type { DocumentState } from '../src/modules/documents/graphs/document.state';
import type { OcrProvider } from '../src/modules/documents/ocr/ocr-provider.interface';

const BASE_ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_JWT_SECRET: 'jwt-secret',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  OPENAI_API_KEY: 'sk-openai',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
  // Real voice providers. Production boot now refuses a 'mock' chain — and an
  // UNSET chain too, because the factory falls back to mock. These tests are
  // about residency, so they supply a real chain rather than exercise that.
  VOICE_STT_PROVIDERS: 'openai',
  VOICE_TTS_PROVIDERS: 'openai',
};

const imageState = (): DocumentState =>
  ({
    documentId: 'doc-1',
    applicationId: 'app-1',
    storagePath: 'u/app/p.png',
    mimeType: 'image/png',
    documentType: 'passport',
    signedUrl: 'https://signed.example/p.png',
    rawOcrText: '',
    extractedFields: {},
    verificationResult: 'pass',
    verificationDetails: [],
    allDocsProcessed: false,
    error: null,
  }) as unknown as DocumentState;

/**
 * Stand-in for an OCR provider, used to test the residency gate in isolation.
 *
 * A WARNING ATTACHED TO THIS FIXTURE. It used to name itself "azure-di" and
 * hardcode `implemented: true`. Every real regional provider was a scaffold
 * declaring `implemented: false`, so this fixture asserted a configuration that
 * could not exist — and that is why OCR-001 (production could not boot with any
 * OCR provider at all) survived twelve audit phases with this suite green.
 *
 * The name is now deliberately NOT a real provider name: these tests are about
 * the residency rule, and borrowing a real provider's identity is what let a
 * fixture quietly stand in for reality. Whether the real providers are
 * implemented is asserted against the real factory in test/ocr-deadlock.spec.ts.
 */
function fakeProvider(regional: boolean, extract = jest.fn()): OcrProvider {
  return {
    name: regional ? 'test-regional' : 'test-non-regional',
    regional,
    capabilities: {
      implemented: true,
      mimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
    },
    extract,
  };
}

describe('production residency enforcement (validateEnv)', () => {
  it('throws in production when DATA_RESIDENCY_MODE is global', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        OCR_PROVIDER: 'azure-di',
      }),
    ).toThrow(/DATA_RESIDENCY_MODE/);
  });

  it('throws in production when OCR_PROVIDER is not a regional managed provider', () => {
    expect(() =>
      validateEnv({
        ...BASE_ENV,
        NODE_ENV: 'production',
        DATA_RESIDENCY_MODE: 'regional',
        OCR_PROVIDER: 'openai',
      }),
    ).toThrow(/OCR_PROVIDER/);
  });

  it('accepts production config with enforced residency + regional provider', () => {
    const env = validateEnv({
      ...BASE_ENV,
      NODE_ENV: 'production',
      DATA_RESIDENCY_MODE: 'jurisdiction-specific',
      OCR_PROVIDER: 'azure-di',
    });
    expect(env.DATA_RESIDENCY_MODE).toBe('jurisdiction-specific');
    expect(env.OCR_PROVIDER).toBe('azure-di');
  });

  it('allows mock/global in non-production', () => {
    expect(() =>
      validateEnv({ ...BASE_ENV, NODE_ENV: 'development' }),
    ).not.toThrow();
  });
});

describe('run-ocr residency guard (fail closed)', () => {
  it('blocks a non-regional provider under regional mode and never extracts', async () => {
    const provider = fakeProvider(false);
    const node = makeRunOcrNode(provider, {
      residencyMode: 'regional',
      region: 'ca-central-1',
    });
    const out = await node(imageState());
    expect(out.error).toMatch(/residency/i);
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('allows a regional provider under regional mode', async () => {
    const extract = jest.fn().mockResolvedValue({
      text: 'ok',
      fields: { full_name: 'A', nationality: 'CA' },
    });
    const provider = fakeProvider(true, extract);
    const node = makeRunOcrNode(provider, {
      residencyMode: 'regional',
      region: 'ca-central-1',
    });
    const out = await node(imageState());
    expect(extract).toHaveBeenCalled();
    expect(out.verificationResult).toBe('pass');
  });

  it('allows a non-regional provider only under global mode', async () => {
    const extract = jest.fn().mockResolvedValue({ text: 'ok', fields: {} });
    const provider = fakeProvider(false, extract);
    const node = makeRunOcrNode(provider, {
      residencyMode: 'global',
      region: 'global',
    });
    await node(imageState());
    expect(extract).toHaveBeenCalled();
  });
});
