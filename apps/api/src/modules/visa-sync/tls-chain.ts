import { connect as tlsConnect, rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { isPrivateAddress } from './source-fetcher';

/**
 * Complete a TLS chain the server failed to send.
 *
 * THE PROBLEM, AND WHY IT LOOKED LIKE SOMETHING ELSE
 *
 * Portugal's AIMA (aima.gov.pt) was recorded as unreachable from our egress,
 * filed alongside migri.fi as "the edge drops us by source IP". It is not. It
 * serves us fine; it sends ONE certificate:
 *
 *   depth=0  CN = *.aima.gov.pt
 *   issuer   CN = Sectigo Public Server Authentication CA OV R36
 *   Verify return code: 21 (unable to verify the first certificate)
 *
 * The Sectigo ROOT is in our trust store. The INTERMEDIATE between them is not,
 * because the server never sends it. Browsers paper over this by fetching the
 * missing issuer from the Authority Information Access extension in the leaf —
 * so the site looks perfectly fine to every human who checks it, and fails only
 * for the automated client nobody watches. That asymmetry is exactly how it got
 * misfiled as an IP block: "works in my browser, dies on the VPS" reads as
 * egress, and it was the chain the whole time.
 *
 * An audit of all 28 registered source hosts on 2026-08-26 found 28 sending a
 * complete chain and verifying cleanly; aima.gov.pt was the only broken one. So
 * this is not rot in our trust store, it is one authority's misconfiguration —
 * and, at 196 countries, the first of a class rather than a one-off.
 *
 * WHY THIS IS NOT A HOLE IN VERIFICATION
 *
 * The tempting fix is `rejectUnauthorized: false`, and it would be a disaster:
 * it accepts ANY certificate, turning a chain bug into a permanent
 * man-in-the-middle window on the one component that decides what a government
 * says. This does the opposite — it makes verification SUCCEED honestly:
 *
 *   1. read the certificate chain the server actually sends (unverified, and
 *      trusted for nothing except the URL in its AIA extension);
 *   2. fetch the named issuer, through the same SSRF guards as any other URL,
 *      because a URL inside a certificate is still attacker-influenced input;
 *   3. require that the fetched certificate ACTUALLY ISSUED the one below it —
 *      `checkIssued` plus a signature check, not a name match;
 *   4. require that it chains to a root ALREADY in the system trust store;
 *   5. only then retry the request with full verification on, with that
 *      intermediate supplied.
 *
 * Step 4 is the one that matters. The intermediate becomes a trust anchor for
 * the retry, so it must be one a root we already trust has delegated to. An
 * intermediate that verifies against nothing is discarded, and the fetch stays
 * failed. We never trust a certificate because it was convenient.
 */

/** Hosts whose missing issuer we have already resolved (or failed to). */
const chainCache = new Map<string, string[] | null>();

let rootsParsed: X509Certificate[] | null = null;
function roots(): X509Certificate[] {
  if (!rootsParsed) {
    rootsParsed = rootCertificates
      .map((pem) => {
        try {
          return new X509Certificate(pem);
        } catch {
          return null;
        }
      })
      .filter((c): c is X509Certificate => c !== null);
  }
  return rootsParsed;
}

/** Does `cert` verify against a root we already trust? */
function anchoredInTrustStore(cert: X509Certificate): boolean {
  return roots().some((root) => {
    try {
      return cert.checkIssued(root) && cert.verify(root.publicKey);
    } catch {
      return false;
    }
  });
}

/** The AIA `CA Issuers` URI, if the certificate names one. */
function caIssuersUri(cert: X509Certificate): string | null {
  const info = cert.infoAccess;
  if (!info) return null;
  const m = info.match(/CA Issuers - URI:\s*(\S+)/);
  return m ? m[1] : null;
}

/** The chain the server sends, leaf first, without verifying any of it. */
async function peerChain(
  hostname: string,
  port: number,
): Promise<X509Certificate[]> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: 15_000,
      },
      () => {
        const chain: X509Certificate[] = [];
        const seen = new Set<string>();
        let cert: X509Certificate | undefined = socket.getPeerX509Certificate();
        while (cert && !seen.has(cert.fingerprint256)) {
          seen.add(cert.fingerprint256);
          chain.push(cert);
          cert = cert.issuerCertificate;
        }
        socket.destroy();
        resolve(chain);
      },
    );
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('tls timeout'));
    });
    socket.on('error', reject);
  });
}

/**
 * Download a certificate named by an AIA URI.
 *
 * The URI comes out of a certificate served by the host we are investigating,
 * so it is untrusted input and gets the same treatment as a source URL: scheme
 * allowlist, public-address check on every resolved address, timeout, and a
 * hard size cap. A certificate is a few kilobytes; anything larger is not one.
 */
async function fetchIssuerCert(uri: string): Promise<X509Certificate | null> {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  // AIA URLs are conventionally plain http — the payload is self-authenticating
  // (we verify its signature below), so http is acceptable here and nowhere else.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  try {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (records.length === 0) return null;
    if (records.some((r) => isPrivateAddress(r.address))) return null;
  } catch {
    return null;
  }

  const body = await new Promise<Buffer | null>((resolve) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        timeout: 15_000,
        headers: {
          'user-agent': 'VisaAI-SourceMonitor/1.0 (+https://visaai.co/bots)',
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 300) {
          res.resume();
          return resolve(null);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > 64 * 1024) {
            req.destroy();
            return resolve(null);
          }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });

  if (!body || body.length === 0) return null;
  try {
    return new X509Certificate(body); // accepts DER and PEM
  } catch {
    return null;
  }
}

/**
 * Resolve the intermediate(s) a host omits, or null if we cannot do so safely.
 *
 * Returns PEM strings to supply as additional trust anchors for a retry. A null
 * result means the fetch should stay failed: either the host's chain is fine and
 * something else is wrong, or the missing piece could not be verified, and an
 * unverifiable certificate is worth strictly less than an error.
 */
export async function resolveMissingIntermediates(
  hostname: string,
  port = 443,
): Promise<string[] | null> {
  if (chainCache.has(hostname)) return chainCache.get(hostname) ?? null;

  let result: string[] | null = null;
  try {
    const chain = await peerChain(hostname, port);
    if (chain.length === 0) {
      chainCache.set(hostname, null);
      return null;
    }

    const found: string[] = [];
    let current = chain[chain.length - 1]; // topmost cert the server sent

    // Up to four hops: a server may omit more than one link, but a chain that
    // long is pathological and we stop rather than be walked in circles.
    for (let hop = 0; hop < 4; hop++) {
      if (anchoredInTrustStore(current)) break;

      const uri = caIssuersUri(current);
      if (!uri) break;

      const issuer = await fetchIssuerCert(uri);
      if (!issuer) break;

      // It must genuinely be the issuer — name equality is not enough, the
      // signature has to check out against its public key.
      let issued = false;
      try {
        issued =
          current.checkIssued(issuer) && current.verify(issuer.publicKey);
      } catch {
        issued = false;
      }
      if (!issued) break;

      found.push(issuer.toString());
      current = issuer;
    }

    // The whole point: the top of what we assembled must be something the
    // system trust store already vouches for. Otherwise we assembled a chain to
    // nowhere and it is worthless.
    result = found.length > 0 && anchoredInTrustStore(current) ? found : null;
  } catch {
    result = null;
  }

  chainCache.set(hostname, result);
  return result;
}

/** Errors meaning "the chain was incomplete", as opposed to any other failure. */
const CHAIN_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

export function isChainError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let e: any = err;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    if (typeof e.code === 'string' && CHAIN_ERROR_CODES.has(e.code))
      return true;
    if (
      typeof e.message === 'string' &&
      /unable to (verify|get issuer)/i.test(e.message)
    ) {
      return true;
    }
    e = e.cause;
  }
  return false;
}

/**
 * A fetch-compatible function verifying against the system roots PLUS the
 * supplied intermediates.
 *
 * Built on node:https rather than a dispatcher so no new dependency is needed,
 * and shaped as `fetch` so the caller's redirect handling, address re-checks and
 * size caps all still apply — the retry must not become a second, less careful
 * code path.
 */
export function fetchWithExtraCa(extraCa: string[]): typeof fetch {
  const ca = [...rootCertificates, ...extraCa];

  return ((input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    return new Promise<Response>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
          ca,
          servername: url.hostname,
          timeout: 30_000,
        },
        (res) => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((one) => headers.append(k, one));
            else if (v !== undefined) headers.set(k, String(v));
          }
          const status = res.statusCode ?? 0;
          // 204/304 must not carry a body, and Response rejects one.
          const body =
            status === 204 || status === 304
              ? null
              : (Readable.toWeb(res) as unknown as ReadableStream);
          resolve(new Response(body, { status, headers }));
        },
      );
      if (init.signal) {
        init.signal.addEventListener('abort', () =>
          req.destroy(new Error('aborted')),
        );
      }
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }) as typeof fetch;
}
