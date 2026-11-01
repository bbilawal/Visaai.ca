import { isPrivateAddress, validateWebhookUrl } from './partner-webhook-url';

/**
 * SSRF defence. Every case here is a URL that, if accepted, would make our own
 * server issue a signed request into somewhere it should not reach.
 */
describe('validateWebhookUrl', () => {
  it('accepts an ordinary https endpoint', () => {
    expect(
      validateWebhookUrl('https://hooks.acme.test/visaai', 'live'),
    ).toEqual({
      valid: true,
      reason: null,
    });
  });

  it('accepts a path and query', () => {
    expect(
      validateWebhookUrl('https://hooks.acme.test/v1/hook?src=visaai', 'live')
        .valid,
    ).toBe(true);
  });

  it('rejects http in live', () => {
    expect(validateWebhookUrl('http://hooks.acme.test/x', 'live')).toEqual({
      valid: false,
      reason: 'scheme_not_allowed',
    });
  });

  it('permits http://localhost in sandbox for local development', () => {
    expect(
      validateWebhookUrl('http://localhost:8443/hook', 'sandbox').valid,
    ).toBe(true);
  });

  it('still rejects http to a non-loopback host in sandbox', () => {
    expect(validateWebhookUrl('http://acme.test/hook', 'sandbox').reason).toBe(
      'scheme_not_allowed',
    );
  });

  it.each([
    ['ftp', 'ftp://acme.test/x'],
    ['file', 'file:///etc/passwd'],
    ['gopher', 'gopher://acme.test/'],
    ['javascript', 'javascript:alert(1)'],
  ])('rejects the %s scheme', (_label, url) => {
    expect(validateWebhookUrl(url, 'live').valid).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(validateWebhookUrl('not a url', 'live').reason).toBe('malformed');
  });

  it('rejects embedded credentials', () => {
    expect(
      validateWebhookUrl('https://user:pass@hooks.acme.test/x', 'live').reason,
    ).toBe('credentials_in_url');
  });

  it('rejects an unusual port', () => {
    expect(
      validateWebhookUrl('https://hooks.acme.test:22/x', 'live').reason,
    ).toBe('port_not_allowed');
  });

  it('accepts 443 and 8443', () => {
    expect(
      validateWebhookUrl('https://hooks.acme.test:443/x', 'live').valid,
    ).toBe(true);
    expect(
      validateWebhookUrl('https://hooks.acme.test:8443/x', 'live').valid,
    ).toBe(true);
  });

  // The attack this file exists for.
  it('rejects the cloud metadata address', () => {
    expect(
      validateWebhookUrl('https://169.254.169.254/latest/meta-data/', 'live')
        .reason,
    ).toBe('private_address');
  });

  it('rejects the GCP metadata hostname', () => {
    expect(
      validateWebhookUrl(
        'https://metadata.google.internal/computeMetadata/v1/',
        'live',
      ).reason,
    ).toBe('metadata_host');
  });

  it.each([
    ['loopback', 'https://127.0.0.1/x'],
    ['RFC 1918 /8', 'https://10.1.2.3/x'],
    ['RFC 1918 /12', 'https://172.16.5.5/x'],
    ['RFC 1918 /16', 'https://192.168.1.1/x'],
    ['CGNAT', 'https://100.64.0.1/x'],
    ['this-network', 'https://0.0.0.0/x'],
    ['multicast', 'https://224.0.0.1/x'],
    ['broadcast', 'https://255.255.255.255/x'],
    ['IPv6 loopback', 'https://[::1]/x'],
    ['IPv6 unique-local', 'https://[fd00::1]/x'],
    ['IPv6 link-local', 'https://[fe80::1]/x'],
    ['IPv4-mapped private', 'https://[::ffff:10.0.0.1]/x'],
  ])('rejects a private destination (%s)', (_label, url) => {
    expect(validateWebhookUrl(url, 'live').reason).toBe('private_address');
  });

  it('rejects loopback in live even though sandbox allows it', () => {
    expect(validateWebhookUrl('https://127.0.0.1/x', 'live').valid).toBe(false);
  });

  it('accepts a public IP literal', () => {
    expect(validateWebhookUrl('https://198.51.100.7/x', 'live').valid).toBe(
      true,
    );
  });

  it('accepts a public IPv6 literal', () => {
    expect(validateWebhookUrl('https://[2001:db8::1]/x', 'live').valid).toBe(
      true,
    );
  });
});

describe('isPrivateAddress', () => {
  it('treats a hostname as non-private (resolution happens later)', () => {
    expect(isPrivateAddress('hooks.acme.test')).toBe(false);
  });

  it('classifies 172.15 and 172.32 as public, 172.16–172.31 as private', () => {
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
  });

  it('classifies the CGNAT boundaries', () => {
    expect(isPrivateAddress('100.63.255.255')).toBe(false);
    expect(isPrivateAddress('100.64.0.0')).toBe(true);
    expect(isPrivateAddress('100.127.255.255')).toBe(true);
    expect(isPrivateAddress('100.128.0.0')).toBe(false);
  });
});
