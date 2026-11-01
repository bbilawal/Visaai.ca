import { DASHBOARD, destinationFromPushData, resolveDeepLink } from './routing';

/**
 * Deep links are attacker-influencable input. These tests pin the two rules
 * that matter: an unknown/hostile path can only ever land on the dashboard, and
 * a non-UUID id is never interpolated into a route that becomes an API path.
 */
const UUID = '11111111-1111-4111-8111-111111111111';

describe('resolveDeepLink', () => {
  it('routes a known application path', () => {
    expect(resolveDeepLink(`/applications/${UUID}`)).toEqual({
      pathname: '/(app)/applications/[id]',
      params: { id: UUID },
      requiresAuth: true,
    });
  });

  it('routes nested application sections', () => {
    expect(resolveDeepLink(`/applications/${UUID}/messages`).pathname).toBe(
      '/(app)/applications/[id]/messages',
    );
    expect(resolveDeepLink(`/applications/${UUID}/documents`).pathname).toBe(
      '/(app)/applications/[id]/documents',
    );
  });

  it('accepts a full universal-link URL', () => {
    expect(resolveDeepLink(`https://visaai.co/applications/${UUID}`).params).toEqual({ id: UUID });
  });

  it('accepts a custom-scheme URL', () => {
    expect(resolveDeepLink(`visaai://applications/${UUID}`).params).toEqual({ id: UUID });
  });

  it('ignores query strings and fragments', () => {
    expect(resolveDeepLink(`/applications/${UUID}?utm=x#frag`).params).toEqual({ id: UUID });
  });

  it('rejects a non-UUID id rather than interpolating it', () => {
    expect(resolveDeepLink('/applications/../../admin')).toEqual(DASHBOARD);
    expect(resolveDeepLink('/applications/1 OR 1=1')).toEqual(DASHBOARD);
    expect(resolveDeepLink('/applications/00000000')).toEqual(DASHBOARD);
  });

  it('falls back to the dashboard for an unknown route', () => {
    expect(resolveDeepLink('/admin/users')).toEqual(DASHBOARD);
    expect(resolveDeepLink('/../../etc/passwd')).toEqual(DASHBOARD);
  });

  it('falls back to the dashboard for empty input', () => {
    expect(resolveDeepLink(null)).toEqual(DASHBOARD);
    expect(resolveDeepLink('')).toEqual(DASHBOARD);
    expect(resolveDeepLink('/')).toEqual(DASHBOARD);
  });

  it('marks every routable destination as auth-required', () => {
    const paths = [
      `/applications/${UUID}`,
      '/appointments',
      '/notifications',
      '/billing',
      '/payment/return',
      '/consultants',
    ];
    for (const path of paths) {
      expect(resolveDeepLink(path).requiresAuth).toBe(true);
    }
  });

  it('does not let a percent-encoded traversal slip through', () => {
    expect(resolveDeepLink('/applications/%2E%2E%2F%2E%2E%2Fadmin')).toEqual(DASHBOARD);
  });
});

describe('destinationFromPushData', () => {
  it('uses an explicit path when present', () => {
    expect(
      destinationFromPushData({ path: `/applications/${UUID}/messages` }).pathname,
    ).toBe('/(app)/applications/[id]/messages');
  });

  it('reconstructs from ids when the sender omitted a path', () => {
    expect(destinationFromPushData({ applicationId: UUID, conversationId: 'c1' }).pathname).toBe(
      '/(app)/applications/[id]/messages',
    );
    expect(destinationFromPushData({ applicationId: UUID }).pathname).toBe(
      '/(app)/applications/[id]',
    );
  });

  it('ignores a hostile path in the payload', () => {
    expect(destinationFromPushData({ path: 'javascript:alert(1)' })).toEqual(DASHBOARD);
    expect(destinationFromPushData({ path: '/admin/financial-ops' })).toEqual(DASHBOARD);
  });

  it('ignores a non-UUID applicationId', () => {
    expect(destinationFromPushData({ applicationId: 'not-a-uuid' })).toEqual(DASHBOARD);
  });

  it('handles missing or malformed payloads', () => {
    expect(destinationFromPushData(undefined)).toEqual(DASHBOARD);
    expect(destinationFromPushData('string')).toEqual(DASHBOARD);
    expect(destinationFromPushData({})).toEqual(DASHBOARD);
  });
});
