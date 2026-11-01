import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PartnerEnvironment } from '@visaai/types';

/**
 * Credential primitives for the partner platform. Pure functions, no DB, no
 * clock beyond an injected `now` — mirrors iam.engine / commission.engine so
 * the security-critical rules are unit-tested in isolation.
 *
 * Two credential families:
 *   API keys      — long-lived, presented as `Authorization: Bearer vak_...`
 *   Access tokens — short-lived, issued by the OAuth token endpoint
 *
 * Both are stored ONLY as SHA-256 hashes. Neither can be recovered from the
 * database; a lost key is rotated, not looked up.
 *
 * Why SHA-256 and not bcrypt/argon2: these are 256-bit random secrets, not
 * human-chosen passwords. There is no dictionary to attack and no meaningful
 * offline-cracking risk, and every API request has to verify one — a
 * deliberately slow KDF here would put ~100ms of CPU on the hot path of every
 * call. Password hashing (Supabase's job) is a different problem.
 */

/** `vak_live_` / `vak_test_`. Test keys are visibly different at a glance. */
const KEY_NAMESPACE = 'vak';
const PREFIX_BYTES = 8;
const SECRET_BYTES = 32;
const TOKEN_BYTES = 32;

export interface GeneratedApiKey {
  /** Full plaintext key. Returned to the caller ONCE and never stored. */
  key: string;
  /** Public lookup handle, stored in the clear. */
  prefix: string;
  /** SHA-256 of the full key. */
  hash: string;
  /** Last four characters of the secret, for human recognition in the portal. */
  lastFour: string;
}

/** Environment segment of a key. `test` reads better than `sandbox` in a key. */
function envSegment(environment: PartnerEnvironment): string {
  return environment === 'live' ? 'live' : 'test';
}

export function generateApiKey(
  environment: PartnerEnvironment,
): GeneratedApiKey {
  const prefix = randomBytes(PREFIX_BYTES).toString('hex');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const key = `${KEY_NAMESPACE}_${envSegment(environment)}_${prefix}_${secret}`;
  return {
    key,
    prefix,
    hash: sha256(key),
    lastFour: secret.slice(-4),
  };
}

export interface ParsedApiKey {
  environment: PartnerEnvironment;
  prefix: string;
}

/**
 * Parse a presented key into its lookup parts. Returns null for anything that
 * is not a well-formed key so the caller can reject it WITHOUT a database
 * round-trip — an unauthenticated caller must not be able to make us query.
 *
 * Matched as a whole rather than split on '_': the secret is base64url, whose
 * alphabet includes '_', so splitting on the separator would over-split most
 * real keys.
 */
const KEY_PATTERN = new RegExp(
  `^${KEY_NAMESPACE}_(live|test)_([0-9a-f]{16})_([A-Za-z0-9_-]{32,})$`,
);

export function parseApiKey(presented: string): ParsedApiKey | null {
  const match = KEY_PATTERN.exec(presented);
  if (!match) return null;
  const [, env, prefix] = match;
  return { environment: env === 'live' ? 'live' : 'sandbox', prefix };
}

/** SHA-256 hex. Used for keys, tokens and authorization codes alike. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex digests. A plain `===` on a secret
 * comparison leaks length and prefix through timing; this does not.
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface GeneratedToken {
  token: string;
  hash: string;
}

/** Opaque bearer token. Opaque, not JWT, so revocation actually revokes. */
export function generateAccessToken(): GeneratedToken {
  const token = `vat_${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  return { token, hash: sha256(token) };
}

/** Authorization code for the PKCE flow. Single-use, short-lived. */
export function generateAuthorizationCode(): GeneratedToken {
  const token = `vac_${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  return { token, hash: sha256(token) };
}

/** Client secret for a confidential OAuth client. */
export function generateClientSecret(): GeneratedToken {
  const token = `vcs_${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { token, hash: sha256(token) };
}

/** Client id. Public, non-secret, but unguessable to avoid enumeration. */
export function generateClientId(environment: PartnerEnvironment): string {
  return `vac_${envSegment(environment)}_${randomBytes(12).toString('hex')}`;
}

/** Webhook signing secret. Recoverable (needed to sign), so stored encrypted. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(SECRET_BYTES).toString('base64url')}`;
}

/** Endpoint-verification challenge token. */
export function generateVerificationToken(): string {
  return randomBytes(16).toString('base64url');
}

// ---- PKCE ------------------------------------------------------------

/**
 * RFC 7636 S256 verification: challenge == base64url(sha256(verifier)).
 *
 * `plain` is deliberately NOT supported. It offers no protection against the
 * interception attack PKCE exists to stop, and accepting it would let a
 * malicious client downgrade itself.
 */
export function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (method !== 'S256') return false;
  // RFC 7636 §4.1: 43–128 characters of the unreserved set.
  if (verifier.length < 43 || verifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  return secureCompare(computed, challenge);
}

// ---- Lifecycle predicates --------------------------------------------

export interface CredentialLifecycle {
  status: string;
  expires_at?: string | null;
  revoked_at?: string | null;
}

/**
 * A credential is usable when it is active, unrevoked and unexpired.
 * `rotating` is deliberately usable — that IS the rotation grace window; the
 * old key keeps working until its `expires_at` passes so a partner can deploy
 * the new one without downtime.
 */
export function isCredentialUsable(
  credential: CredentialLifecycle | null,
  now: Date,
): boolean {
  if (!credential) return false;
  if (credential.revoked_at) return false;
  if (credential.status !== 'active' && credential.status !== 'rotating') {
    return false;
  }
  if (credential.expires_at) {
    if (new Date(credential.expires_at).getTime() <= now.getTime())
      return false;
  }
  return true;
}

/** Expiry for a rotated key's grace window. */
export function rotationGraceExpiry(now: Date, graceHours: number): string {
  return new Date(now.getTime() + graceHours * 3_600_000).toISOString();
}

/** Expiry for a freshly issued access token. */
export function tokenExpiry(now: Date, ttlSeconds: number): string {
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

// ---- IP allow-listing -------------------------------------------------

/**
 * CIDR / exact-IP match for the optional per-application allow-list.
 * IPv4 and IPv6 both supported. An empty list means "no restriction" — the
 * common case, since most partners do not have stable egress IPs.
 *
 * Returns false for a malformed candidate rather than throwing: an unparseable
 * client address must fail closed, not 500.
 */
export function ipAllowed(clientIp: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const client = normalizeIp(clientIp);
  if (!client) return false;
  return allowlist.some((entry) => matchesCidr(client, entry.trim()));
}

interface NormalizedIp {
  bytes: Uint8Array;
  /** 4 for IPv4, 16 for IPv6. */
  size: number;
}

function normalizeIp(value: string): NormalizedIp | null {
  // Strip an IPv6-mapped IPv4 prefix so ::ffff:203.0.113.5 matches 203.0.113.5.
  const stripped = value.startsWith('::ffff:') ? value.slice(7) : value;
  if (stripped.includes('.')) {
    const octets = stripped.split('.');
    if (octets.length !== 4) return null;
    const bytes = new Uint8Array(4);
    for (let i = 0; i < 4; i += 1) {
      if (!/^\d{1,3}$/.test(octets[i])) return null;
      const n = Number(octets[i]);
      if (n > 255) return null;
      bytes[i] = n;
    }
    return { bytes, size: 4 };
  }
  if (!stripped.includes(':')) return null;
  const [head, tail] = stripped.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  if (stripped.indexOf('::') !== stripped.lastIndexOf('::')) return null;
  const missing = 8 - headGroups.length - tailGroups.length;
  if (!stripped.includes('::') && headGroups.length !== 8) return null;
  if (missing < 0) return null;
  const groups = stripped.includes('::')
    ? [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups]
    : headGroups;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i] === '' ? '0' : groups[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = Number.parseInt(g, 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return { bytes, size: 16 };
}

function matchesCidr(client: NormalizedIp, entry: string): boolean {
  const [addr, bitsRaw] = entry.split('/');
  const network = normalizeIp(addr);
  if (!network) return false;
  if (network.size !== client.size) return false;
  const maxBits = network.size * 8;
  const bits = bitsRaw === undefined ? maxBits : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) return false;

  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i += 1) {
    if (client.bytes[i] !== network.bytes[i]) return false;
  }
  const remainder = bits % 8;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (client.bytes[fullBytes] & mask) === (network.bytes[fullBytes] & mask);
}
