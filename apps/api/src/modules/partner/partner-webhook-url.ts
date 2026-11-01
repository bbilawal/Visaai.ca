/**
 * Webhook destination validation — SSRF defence.
 *
 * A webhook endpoint is a URL a third party gives us and we then fetch from
 * inside our own network. That is the textbook server-side request forgery
 * setup: without this check a partner can register
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` and have
 * our API dutifully sign a request to the cloud metadata service on their
 * behalf.
 *
 * Rules:
 *   - https only in live; http://localhost tolerated in sandbox for local dev
 *   - no credentials in the URL
 *   - no literal IP addresses in a private, loopback, link-local, CGNAT,
 *     multicast or reserved range
 *   - no cloud metadata hostnames
 *
 * A hostname that RESOLVES to a private address still gets through this check
 * — DNS rebinding is not defeated at validation time. The delivery worker is
 * the second line of defence and this limitation is recorded as debt (PD-4).
 */

export type WebhookUrlRejection =
  | 'malformed'
  | 'scheme_not_allowed'
  | 'credentials_in_url'
  | 'private_address'
  | 'metadata_host'
  | 'port_not_allowed';

export interface WebhookUrlResult {
  valid: boolean;
  reason: WebhookUrlRejection | null;
}

const ALLOWED_PORTS = new Set(['', '80', '443', '8443']);

/** Hostnames that are never a legitimate webhook destination. */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata',
]);

export function validateWebhookUrl(
  raw: string,
  environment: 'sandbox' | 'live',
): WebhookUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopbackName = hostname === 'localhost' || hostname === '127.0.0.1';

  if (url.protocol !== 'https:') {
    const devLoopback =
      environment === 'sandbox' && url.protocol === 'http:' && isLoopbackName;
    if (!devLoopback) return { valid: false, reason: 'scheme_not_allowed' };
  }

  // A URL carrying credentials would put them in our logs and in the outbound
  // request; there is no legitimate reason for one here.
  if (url.username || url.password) {
    return { valid: false, reason: 'credentials_in_url' };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { valid: false, reason: 'port_not_allowed' };
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: 'metadata_host' };
  }

  // Sandbox may point at localhost deliberately; everything else must not
  // resolve to a literal internal address.
  if (environment === 'sandbox' && isLoopbackName) {
    return { valid: true, reason: null };
  }

  if (isPrivateAddress(hostname)) {
    return { valid: false, reason: 'private_address' };
  }

  return { valid: true, reason: null };
}

/**
 * True when `hostname` is a literal IP in a range that must never be a
 * webhook target. Non-IP hostnames return false — they are resolved later.
 */
export function isPrivateAddress(hostname: string): boolean {
  const v4 = parseIpv4(hostname);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // RFC 1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
    if (a === 192 && b === 168) return true; // RFC 1918
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  if (hostname.includes(':')) {
    // Parsed to bytes, not matched as a string: `new URL()` rewrites
    // `::ffff:10.0.0.1` to `::ffff:a00:1`, so any textual rule for the
    // IPv4-mapped form is trivially bypassed by handing us the dotted
    // notation and letting the URL parser normalise it.
    const bytes = parseIpv6(hostname.toLowerCase());
    if (!bytes) return false;

    // ::1 (loopback) and :: (unspecified).
    if (bytes.every((b, i) => (i === 15 ? b === 1 || b === 0 : b === 0)))
      return true;
    // fc00::/7 unique-local.
    if ((bytes[0] & 0xfe) === 0xfc) return true;
    // fe80::/10 link-local.
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
    // ::ffff:0:0/96 IPv4-mapped — apply the IPv4 rules to the embedded address.
    const mapped =
      bytes.slice(0, 10).every((b) => b === 0) &&
      bytes[10] === 0xff &&
      bytes[11] === 0xff;
    if (mapped) {
      return isPrivateAddress(
        `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`,
      );
    }
    return false;
  }

  return false;
}

/**
 * Expand an IPv6 literal (with or without `::`) to 16 bytes.
 *
 * The trailing dotted-quad form (`::ffff:10.0.0.1`) is handled explicitly. It
 * never reaches here from `new URL()`, which normalises it to `::ffff:a00:1` —
 * but it does reach here from `dns.lookup`, which returns whatever the resolver
 * said, unnormalised. Without this branch such an address parses as `null` and
 * is treated as public.
 */
function parseIpv6(value: string): number[] | null {
  if (value.indexOf('::') !== value.lastIndexOf('::')) return null;

  const lastColon = value.lastIndexOf(':');
  const tailLiteral = lastColon === -1 ? '' : value.slice(lastColon + 1);
  if (tailLiteral.includes('.')) {
    const v4 = parseIpv4(tailLiteral);
    if (!v4) return null;
    // Rewrite the dotted quad as two hex groups and re-parse the whole address.
    const asHex = `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    return parseIpv6(`${value.slice(0, lastColon + 1)}${asHex}`);
  }

  const [head, tail] = value.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const hasElision = value.includes('::');
  const missing = 8 - headGroups.length - tailGroups.length;
  if (hasElision && missing < 0) return null;
  if (!hasElision && headGroups.length !== 8) return null;

  const groups = hasElision
    ? [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups]
    : headGroups;

  const bytes: number[] = [];
  for (const group of groups) {
    const g = group === '' ? '0' : group;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = Number.parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums as [number, number, number, number];
}
