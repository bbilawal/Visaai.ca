import type { ErrorEvent } from '@sentry/react-native';
import { initCrashReporting, sanitizeEvent, scrub } from './crash-reporting';

/**
 * The wiring of a crash SDK is trivial; the redaction is not. These tests exist
 * because a default Sentry configuration would exfiltrate exactly the data this
 * product must protect — application ids, emails, request bodies containing
 * immigration answers, and typed input captured as breadcrumbs.
 */
const UUID = '11111111-1111-4111-8111-111111111111';

describe('scrub', () => {
  it('removes uuids', () => {
    expect(scrub(`/applications/${UUID}/documents`)).toBe('/applications/<id>/documents');
  });

  it('removes email addresses', () => {
    expect(scrub('failed for sam.jones@example.com')).toBe('failed for <email>');
  });

  it('removes several occurrences at once', () => {
    expect(scrub(`${UUID} and ${UUID}`)).toBe('<id> and <id>');
  });

  it('leaves ordinary text intact', () => {
    expect(scrub('Network request failed')).toBe('Network request failed');
  });
});

describe('sanitizeEvent', () => {
  it('reduces the user to an opaque id', () => {
    const event = sanitizeEvent({
      user: { id: 'user-1', email: 'sam@example.com', ip_address: '1.2.3.4', username: 'sam' },
    } as unknown as ErrorEvent);
    expect(event?.user).toEqual({ id: 'user-1' });
  });

  it('drops the request body — it can contain a whole immigration form', () => {
    const event = sanitizeEvent({
      request: {
        url: `https://api.visaai.co/applications/${UUID}`,
        data: { passportNumber: 'X1234567' },
        cookies: { session: 'abc' },
        headers: { authorization: 'Bearer secret' },
      },
    } as unknown as ErrorEvent);
    expect(event?.request?.data).toBeUndefined();
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.headers).toBeUndefined();
    expect(event?.request?.url).toBe('https://api.visaai.co/applications/<id>');
  });

  it('strips console and typed-input breadcrumbs entirely', () => {
    const event = sanitizeEvent({
      breadcrumbs: [
        { category: 'console', message: 'passport X1234567' },
        { category: 'ui.input', message: 'typed: sam@example.com' },
        { category: 'navigation', message: `to /applications/${UUID}` },
      ],
    } as unknown as ErrorEvent);
    expect(event?.breadcrumbs?.[0]?.message).toBeUndefined();
    expect(event?.breadcrumbs?.[1]?.message).toBeUndefined();
    // Navigation is kept, but scrubbed.
    expect(event?.breadcrumbs?.[2]?.message).toBe('to /applications/<id>');
  });

  it('scrubs breadcrumb urls', () => {
    const event = sanitizeEvent({
      breadcrumbs: [{ category: 'fetch', data: { url: `/documents/${UUID}` } }],
    } as unknown as ErrorEvent);
    expect(event?.breadcrumbs?.[0]?.data?.url).toBe('/documents/<id>');
  });

  it('scrubs the exception message', () => {
    const event = sanitizeEvent({
      exception: { values: [{ value: `no row for ${UUID}` }] },
    } as unknown as ErrorEvent);
    expect(event?.exception?.values?.[0]?.value).toBe('no row for <id>');
  });

  it('handles a minimal event without throwing', () => {
    expect(() => sanitizeEvent({} as ErrorEvent)).not.toThrow();
  });
});

describe('initCrashReporting', () => {
  it('is a no-op without a DSN, so dev and CI emit nothing', () => {
    // EXPO_PUBLIC_SENTRY_DSN is unset in the test environment.
    expect(initCrashReporting()).toBe(false);
  });
});
