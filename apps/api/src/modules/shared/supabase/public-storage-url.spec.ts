import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

/**
 * Regression guard for a PRODUCTION OUTAGE (found 2026-08-13).
 *
 * supabase-js builds signed URLs from the base it was constructed with. On the
 * VPS that base is `http://127.0.0.1:54421` — Kong listens on loopback — so
 * every upload link, attachment link and generated-document link the API
 * returned pointed at the SERVER'S OWN loopback. Document upload, the core
 * flow, had been broken since the domain cutover and nothing caught it because
 * no server-side code ever follows those URLs.
 */

function serviceWith(url: string, publicUrl?: string): SupabaseService {
  const config = {
    get: (key: string) =>
      ({
        SUPABASE_URL: url,
        SUPABASE_PUBLIC_URL: publicUrl,
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      })[key],
  } as unknown as ConfigService;
  return new SupabaseService(config);
}

const INTERNAL = 'http://127.0.0.1:54421';
const PUBLIC = 'https://api.visaai.co';
const SIGNED = `${INTERNAL}/storage/v1/object/upload/sign/documents/u/app/1-x.pdf?token=abc.def`;

describe('SupabaseService.toPublicStorageUrl', () => {
  it('rewrites a loopback signed URL onto the public base', () => {
    const svc = serviceWith(INTERNAL, PUBLIC);
    expect(svc.toPublicStorageUrl(SIGNED)).toBe(
      `${PUBLIC}/storage/v1/object/upload/sign/documents/u/app/1-x.pdf?token=abc.def`,
    );
  });

  it('preserves the query string, which carries the signing token', () => {
    const svc = serviceWith(INTERNAL, PUBLIC);
    // Losing `?token=` would produce a URL that resolves and then 400s — a
    // failure that looks like a permissions bug rather than a mangled link.
    expect(svc.toPublicStorageUrl(SIGNED)).toContain('?token=abc.def');
  });

  // Hosted Supabase and local development set both to the same value; the
  // rewrite must be a no-op there rather than a source of surprise.
  it('is a no-op when no separate public base is configured', () => {
    const svc = serviceWith(INTERNAL);
    expect(svc.toPublicStorageUrl(SIGNED)).toBe(SIGNED);
  });

  it('leaves a URL from another host untouched', () => {
    const svc = serviceWith(INTERNAL, PUBLIC);
    const foreign = 'https://www.canada.ca/x/imm5257e.pdf';
    expect(svc.toPublicStorageUrl(foreign)).toBe(foreign);
  });

  it('does not choke on an empty value', () => {
    const svc = serviceWith(INTERNAL, PUBLIC);
    expect(svc.toPublicStorageUrl('')).toBe('');
  });

  it('does not double a slash when the public base has a trailing one', () => {
    const svc = serviceWith(INTERNAL, `${PUBLIC}/`);
    expect(svc.toPublicStorageUrl(SIGNED)).toBe(
      `${PUBLIC}/storage/v1/object/upload/sign/documents/u/app/1-x.pdf?token=abc.def`,
    );
  });

  // A public base that carries a path prefix is a real deployment shape here:
  // this VPS already exposes Kong at https://visaai.co/sbkong.
  it('supports a public base with a path prefix', () => {
    const svc = serviceWith(INTERNAL, 'https://visaai.co/sbkong');
    expect(svc.toPublicStorageUrl(SIGNED)).toBe(
      'https://visaai.co/sbkong/storage/v1/object/upload/sign/documents/u/app/1-x.pdf?token=abc.def',
    );
  });
});
