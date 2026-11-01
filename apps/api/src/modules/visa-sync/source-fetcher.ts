import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  fetchWithExtraCa,
  isChainError,
  resolveMissingIntermediates,
} from './tls-chain';

/**
 * Fetches an official government page, safely.
 *
 * THREAT MODEL
 *
 * This is the one component in VisaAI that makes outbound HTTP requests to a
 * URL stored in a database row. That makes it the SSRF surface: anything that
 * can write `visa_sources.source_url` — a migration, an admin action, a future
 * bulk import, a compromised admin session — can point it at
 * `http://169.254.169.254/latest/meta-data/` and read the VPS's cloud metadata
 * back into a `visa_source_versions` row that admins then view.
 *
 * RLS blocks that write today (service-role only), but a fetcher that is only
 * safe because of who can write to a table is one migration away from being
 * unsafe. The controls belong here, at the point of egress.
 *
 * CONTROLS, and the specific attack each stops:
 *
 *   scheme allowlist        file://, gopher://, ftp:// exfiltration
 *   private-IP rejection    cloud metadata (169.254.169.254), localhost,
 *                           RFC1918 lateral movement, IPv6 ULA/link-local
 *   resolve-then-check      DNS rebinding: the hostname is resolved and EVERY
 *                           returned address is checked before the request, and
 *                           the request is pinned to a checked address
 *   manual redirect follow  a public URL that 302s to 169.254.169.254 — each
 *                           hop is re-validated, not just the first
 *   redirect cap            redirect loops
 *   response size cap       a multi-GB "page" exhausting memory
 *   timeout                 a slowloris government endpoint stalling the run
 *   robots check by caller  see robots.ts; this module never decides policy
 *
 * It also does not send cookies, credentials or an Authorization header, and
 * identifies itself honestly in the User-Agent with a contact URL, because
 * scraping a government site anonymously is how you get an IP banned and
 * deserve it.
 */

export interface FetchPolicy {
  /** Hard ceiling on bytes read. A page over this is a failure, not a truncation. */
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  userAgent: string;
  /**
   * Escape hatch for tests and for a self-hosted mirror. NEVER set true in
   * production: it disables the private-IP check entirely.
   */
  allowPrivateAddresses?: boolean;
}

export const DEFAULT_FETCH_POLICY: FetchPolicy = {
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 30_000,
  maxRedirects: 5,
  userAgent:
    'VisaAI-SourceMonitor/1.0 (+https://visaai.co/bots; visa requirement change monitoring)',
};

export type FetchOutcome =
  | {
      status: 'ok';
      httpStatus: number;
      body: string;
      /**
       * The response body as served, undecoded. Present whenever the fetch
       * succeeded. `body` is the same bytes UTF-8-decoded and is lossy for any
       * non-text format — read this one for anything that is not HTML.
       */
      bodyBytes: Uint8Array;
      contentType: string | null;
      finalUrl: string;
      /**
       * Historically the CHARACTER count of `body`, not the byte count, which
       * differs on any page with non-ASCII text. Kept as-is because the sync
       * run's counters are calibrated against it; use `bodyBytes.byteLength`
       * when the true size matters.
       */
      bytes: number;
    }
  | {
      status: 'redirected';
      httpStatus: number;
      redirectUrl: string;
      finalUrl: string;
    }
  | { status: 'blocked'; httpStatus: number | null; reason: string }
  | { status: 'unavailable'; httpStatus: number | null; reason: string };

/** Reserved ranges that must never be reachable from a source fetch. */
function isPrivateIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (
    p.length !== 4 ||
    p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = p;
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local — cloud metadata lives here
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase().split('%')[0];
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80') || v.startsWith('fec0')) return true; // link/site-local
  if (/^f[cd]/.test(v)) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:169.254.169.254) — check the embedded v4 address.
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true; // not an IP literal → cannot vouch for it
}

/**
 * Resolve a hostname and reject if ANY returned address is private.
 *
 * Rejecting on *any* rather than *all* is deliberate: a rebinding attacker
 * returns one public and one private address and hopes the client picks the
 * private one. Refusing the whole hostname removes the choice.
 */
async function assertPublicHost(
  hostname: string,
  policy: FetchPolicy,
): Promise<string> {
  if (policy.allowPrivateAddresses) return hostname;

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`refusing private address: ${hostname}`);
    }
    return hostname;
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error(`no DNS records for ${hostname}`);
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new Error(
        `refusing ${hostname}: resolves to private address ${r.address}`,
      );
    }
  }
  return records[0].address;
}

function assertAllowedScheme(url: URL): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`refusing scheme ${url.protocol}`);
  }
}

/**
 * Read at most `maxBytes`, and treat overflow as a failure rather than a
 * truncation. A truncated government page would hash differently on every run
 * and manufacture an endless stream of false "content changed" events.
 */
/**
 * THE BYTES ARE RETURNED UNDECODED, and the caller decodes.
 *
 * This function used to UTF-8-decode inline, which is correct for an HTML page
 * and destructive for anything else: every byte outside valid UTF-8 becomes
 * U+FFFD, so a PDF round-tripped through it is unparseable and hashes to a
 * value that has nothing to do with what the authority served. The knowledge
 * pipeline needs the real bytes to hash, to store, and to hand to a PDF or
 * DOCX extractor. The decoded string the change-detection path has always seen
 * is produced from exactly these bytes, so that path is unchanged.
 */
async function readCappedBytes(
  res: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface FetchDeps {
  /** Injected so tests exercise the guards without real network or DNS. */
  fetchImpl?: typeof fetch;
}

export async function fetchSource(
  rawUrl: string,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
  deps: FetchDeps = {},
): Promise<FetchOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  let current: string;
  try {
    current = new URL(rawUrl).toString();
  } catch {
    return { status: 'blocked', httpStatus: null, reason: 'malformed url' };
  }

  for (let hop = 0; hop <= policy.maxRedirects; hop++) {
    let url: URL;
    try {
      url = new URL(current);
      assertAllowedScheme(url);
      await assertPublicHost(url.hostname, policy);
    } catch (err) {
      return {
        status: 'blocked',
        httpStatus: null,
        reason: err instanceof Error ? err.message : 'url rejected',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    let res: Response;
    const requestInit = {
      // Manual, so every hop goes back through the private-address check.
      // 'follow' would let a public URL redirect into the metadata service.
      redirect: 'manual' as const,
      signal: controller.signal,
      headers: {
        'user-agent': policy.userAgent,
        accept:
          'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
        'accept-language': 'en',
      },
      // No cookies, no credentials: a government session cookie must never
      // ride along on a monitoring request.
      credentials: 'omit' as const,
    };

    try {
      res = await doFetch(current, requestInit);
    } catch (err) {
      // An incomplete certificate chain is the server's misconfiguration, not a
      // network failure and not a refusal — and it is recoverable. Complete the
      // chain from the leaf's own AIA extension and try once more, still fully
      // verifying. If the chain cannot be completed and anchored in the system
      // trust store, `resolveMissingIntermediates` returns null and the original
      // failure stands: we never downgrade verification to get a page.
      //
      // Only ever attempted for a caller using the real fetch. A test or mirror
      // that injected its own fetchImpl gets its own error back untouched.
      const retryable = isChainError(err) && !deps.fetchImpl;
      let recovered: Response | null = null;
      if (retryable) {
        const extraCa = await resolveMissingIntermediates(
          url.hostname,
          Number(url.port) || 443,
        );
        if (extraCa) {
          try {
            recovered = await fetchWithExtraCa(extraCa)(current, requestInit);
          } catch {
            recovered = null;
          }
        }
      }
      if (!recovered) {
        return {
          status: 'unavailable',
          httpStatus: null,
          reason: isChainError(err)
            ? `incomplete certificate chain: ${err instanceof Error ? err.message : 'tls failure'}`
            : err instanceof Error
              ? err.message
              : 'network error',
        };
      }
      res = recovered;
    } finally {
      clearTimeout(timer);
    }

    // 403/429 from a government host is an instruction, not a transient error.
    // Retrying harder is how a monitoring job becomes an attack; the caller
    // records 'blocked' and backs off.
    if (res.status === 403 || res.status === 429) {
      return {
        status: 'blocked',
        httpStatus: res.status,
        reason: `authority returned ${res.status}`,
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return {
          status: 'unavailable',
          httpStatus: res.status,
          reason: 'redirect without location',
        };
      }
      const next = new URL(location, current).toString();
      if (hop === policy.maxRedirects) {
        return {
          status: 'unavailable',
          httpStatus: res.status,
          reason: 'too many redirects',
        };
      }
      current = next;
      continue;
    }

    if (res.status >= 400) {
      return {
        status: 'unavailable',
        httpStatus: res.status,
        reason: `http ${res.status}`,
      };
    }

    let bodyBytes: Uint8Array;
    let body: string;
    try {
      bodyBytes = await readCappedBytes(res, policy.maxBytes);
      body = new TextDecoder('utf-8').decode(bodyBytes);
    } catch (err) {
      return {
        status: 'unavailable',
        httpStatus: res.status,
        reason: err instanceof Error ? err.message : 'read failed',
      };
    }

    // A redirect chain that ended somewhere else is worth telling the caller
    // about even on success: the registry's stored URL has drifted and should
    // be updated to the destination.
    if (current !== rawUrl) {
      return {
        status: 'ok',
        httpStatus: res.status,
        body,
        bodyBytes,
        contentType: res.headers.get('content-type'),
        finalUrl: current,
        bytes: body.length,
      };
    }

    return {
      status: 'ok',
      httpStatus: res.status,
      body,
      bodyBytes,
      contentType: res.headers.get('content-type'),
      finalUrl: current,
      bytes: body.length,
    };
  }

  return {
    status: 'unavailable',
    httpStatus: null,
    reason: 'too many redirects',
  };
}
