import { createHash, randomBytes } from 'node:crypto';
import {
  generateApiKey,
  generateAccessToken,
  generateAuthorizationCode,
  generateClientId,
  generateClientSecret,
  generateWebhookSecret,
  ipAllowed,
  isCredentialUsable,
  parseApiKey,
  rotationGraceExpiry,
  secureCompare,
  sha256,
  tokenExpiry,
  verifyPkce,
} from './partner-credentials';

describe('partner credentials — API keys', () => {
  it('generates a key whose hash matches sha256 of the plaintext', () => {
    const generated = generateApiKey('live');
    expect(generated.hash).toBe(sha256(generated.key));
  });

  it('marks the environment in the key itself so a test key is visible', () => {
    expect(generateApiKey('live').key.startsWith('vak_live_')).toBe(true);
    expect(generateApiKey('sandbox').key.startsWith('vak_test_')).toBe(true);
  });

  it('never repeats a key', () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => generateApiKey('live').key),
    );
    expect(keys.size).toBe(200);
  });

  it('round-trips through parseApiKey', () => {
    const generated = generateApiKey('sandbox');
    const parsed = parseApiKey(generated.key);
    expect(parsed).toEqual({
      environment: 'sandbox',
      prefix: generated.prefix,
    });
  });

  it('exposes only the last four characters of the secret', () => {
    const generated = generateApiKey('live');
    expect(generated.lastFour).toHaveLength(4);
    expect(generated.key.endsWith(generated.lastFour)).toBe(true);
  });

  // A malformed key must be rejected before any DB lookup, or an
  // unauthenticated caller can make us query at will.
  it.each([
    ['empty', ''],
    ['no namespace', 'live_0011223344556677_secretsecretsecretsecretsecret12'],
    [
      'wrong namespace',
      'sk_live_0011223344556677_secretsecretsecretsecretsecret12',
    ],
    [
      'unknown environment',
      'vak_stage_0011223344556677_secretsecretsecretsecret12',
    ],
    ['short prefix', 'vak_live_00112233_secretsecretsecretsecretsecret12'],
    [
      'non-hex prefix',
      'vak_live_zzzzzzzzzzzzzzzz_secretsecretsecretsecretsecret12',
    ],
    ['short secret', 'vak_live_0011223344556677_tooshort'],
    [
      'secret with an illegal character',
      'vak_live_0011223344556677_secret/secret/secret/secret/secret1',
    ],
    [
      'trailing whitespace',
      'vak_live_0011223344556677_secretsecretsecretsecretsecret12 ',
    ],
    ['a bearer JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'],
  ])('rejects a malformed key (%s)', (_label, value) => {
    expect(parseApiKey(value)).toBeNull();
  });

  // A trailing `_x` cannot be distinguished from a secret that happens to end
  // in `_x`, because base64url includes '_'. That is fine and deliberate:
  // parsing only produces the LOOKUP handle. Authentication is the constant-
  // time hash comparison, and a key with a longer secret hashes to something
  // that matches nothing.
  it('parses a key whose secret contains underscores', () => {
    const parsed = parseApiKey(
      'vak_live_0011223344556677_secret_secret_secret_secret_secret1',
    );
    expect(parsed).toEqual({ environment: 'live', prefix: '0011223344556677' });
  });
});

describe('partner credentials — comparison', () => {
  it('matches identical digests', () => {
    const digest = sha256('abc');
    expect(secureCompare(digest, digest)).toBe(true);
  });

  it('rejects a different digest of the same length', () => {
    expect(secureCompare(sha256('abc'), sha256('abd'))).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(secureCompare('short', sha256('abc'))).toBe(false);
  });
});

describe('partner credentials — tokens', () => {
  it('issues opaque access tokens with a recognisable prefix', () => {
    const token = generateAccessToken();
    expect(token.token.startsWith('vat_')).toBe(true);
    expect(token.hash).toBe(sha256(token.token));
  });

  it('issues distinct authorization codes and client secrets', () => {
    expect(generateAuthorizationCode().token.startsWith('vac_')).toBe(true);
    expect(generateClientSecret().token.startsWith('vcs_')).toBe(true);
    expect(generateWebhookSecret().startsWith('whsec_')).toBe(true);
  });

  it('marks the environment in the client id', () => {
    expect(generateClientId('sandbox')).toMatch(/^vac_test_[0-9a-f]{24}$/);
    expect(generateClientId('live')).toMatch(/^vac_live_[0-9a-f]{24}$/);
  });

  it('computes expiries from the injected clock', () => {
    const now = new Date('2026-08-06T00:00:00.000Z');
    expect(tokenExpiry(now, 3600)).toBe('2026-08-06T01:00:00.000Z');
    expect(rotationGraceExpiry(now, 48)).toBe('2026-08-08T00:00:00.000Z');
  });
});

describe('partner credentials — PKCE', () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  it('accepts a correct S256 verifier', () => {
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    const other = randomBytes(32).toString('base64url');
    expect(verifyPkce(other, challenge, 'S256')).toBe(false);
  });

  // `plain` gives no protection against the interception attack PKCE exists
  // for; accepting it would let a client downgrade itself.
  it('refuses the plain method even when the value matches', () => {
    expect(verifyPkce(challenge, challenge, 'plain')).toBe(false);
  });

  it('enforces the RFC 7636 length bounds', () => {
    const short = 'a'.repeat(42);
    const long = 'a'.repeat(129);
    expect(
      verifyPkce(
        short,
        createHash('sha256').update(short).digest('base64url'),
        'S256',
      ),
    ).toBe(false);
    expect(
      verifyPkce(
        long,
        createHash('sha256').update(long).digest('base64url'),
        'S256',
      ),
    ).toBe(false);
  });

  it('rejects a verifier containing characters outside the unreserved set', () => {
    const bad = `${'a'.repeat(42)}/`;
    expect(
      verifyPkce(
        bad,
        createHash('sha256').update(bad).digest('base64url'),
        'S256',
      ),
    ).toBe(false);
  });
});

describe('partner credentials — lifecycle', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  it('accepts an active, unexpired credential', () => {
    expect(isCredentialUsable({ status: 'active' }, now)).toBe(true);
  });

  it('rejects a null credential', () => {
    expect(isCredentialUsable(null, now)).toBe(false);
  });

  it('rejects a revoked credential even while its status says active', () => {
    expect(
      isCredentialUsable(
        { status: 'active', revoked_at: '2026-08-01T00:00:00.000Z' },
        now,
      ),
    ).toBe(false);
  });

  it('rejects a suspended credential', () => {
    expect(isCredentialUsable({ status: 'revoked' }, now)).toBe(false);
  });

  it('rejects an expired credential', () => {
    expect(
      isCredentialUsable(
        { status: 'active', expires_at: '2026-08-06T11:59:59.000Z' },
        now,
      ),
    ).toBe(false);
  });

  // The rotation grace window is the whole point of the `rotating` status:
  // the old key must keep working until it expires.
  it('accepts a rotating key inside its grace window', () => {
    expect(
      isCredentialUsable(
        { status: 'rotating', expires_at: '2026-08-07T00:00:00.000Z' },
        now,
      ),
    ).toBe(true);
  });

  it('rejects a rotating key past its grace window', () => {
    expect(
      isCredentialUsable(
        { status: 'rotating', expires_at: '2026-08-06T00:00:00.000Z' },
        now,
      ),
    ).toBe(false);
  });
});

describe('partner credentials — IP allow-list', () => {
  it('allows everything when the list is empty', () => {
    expect(ipAllowed('203.0.113.9', [])).toBe(true);
  });

  it('matches an exact IPv4 address', () => {
    expect(ipAllowed('203.0.113.9', ['203.0.113.9'])).toBe(true);
    expect(ipAllowed('203.0.113.10', ['203.0.113.9'])).toBe(false);
  });

  it('matches an IPv4 CIDR range', () => {
    expect(ipAllowed('203.0.113.42', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('203.0.114.42', ['203.0.113.0/24'])).toBe(false);
  });

  it('handles a non-byte-aligned prefix length', () => {
    // 203.0.113.0/28 covers .0–.15 only.
    expect(ipAllowed('203.0.113.15', ['203.0.113.0/28'])).toBe(true);
    expect(ipAllowed('203.0.113.16', ['203.0.113.0/28'])).toBe(false);
  });

  it('treats an IPv6-mapped IPv4 address as its IPv4 form', () => {
    expect(ipAllowed('::ffff:203.0.113.9', ['203.0.113.0/24'])).toBe(true);
  });

  it('matches IPv6 CIDR ranges', () => {
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:dba::1', ['2001:db8::/32'])).toBe(false);
  });

  it('does not match an IPv4 address against an IPv6 range', () => {
    expect(ipAllowed('203.0.113.9', ['2001:db8::/32'])).toBe(false);
  });

  it('accepts a match from any entry in the list', () => {
    expect(
      ipAllowed('198.51.100.7', ['203.0.113.0/24', '198.51.100.0/24']),
    ).toBe(true);
  });

  // Fail closed: an address we cannot parse is not an address we can allow.
  it.each([
    ['garbage', 'not-an-ip'],
    ['too many octets', '1.2.3.4.5'],
    ['out-of-range octet', '999.0.0.1'],
    ['empty', ''],
  ])('rejects an unparseable client address (%s)', (_label, value) => {
    expect(ipAllowed(value, ['203.0.113.0/24'])).toBe(false);
  });

  it('rejects a malformed allow-list entry rather than throwing', () => {
    expect(ipAllowed('203.0.113.9', ['203.0.113.0/99'])).toBe(false);
    expect(ipAllowed('203.0.113.9', ['nonsense/24'])).toBe(false);
  });
});
