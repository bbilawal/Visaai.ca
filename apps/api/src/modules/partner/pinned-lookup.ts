import { lookup as dnsLookup } from 'node:dns';
import type {
  LookupAddress,
  LookupOneOptions,
  LookupAllOptions,
} from 'node:dns';
import { isPrivateAddress } from './partner-webhook-url';

/**
 * SSRF defence at connect time (PD-4).
 *
 * `validateWebhookUrl` inspects the URL a partner registers. It cannot inspect
 * where that hostname will point when we actually deliver — a partner can
 * register `https://hooks.example.com`, pass validation, and then repoint the
 * record at `169.254.169.254` before the first delivery. That is DNS rebinding,
 * and a check that runs at registration time cannot see it.
 *
 * The fix has to happen where the socket is opened, and it has to be the same
 * resolution that the socket uses. Resolving separately and then handing the
 * hostname to the connector re-opens the race: the connector would resolve a
 * second time and could get a different answer. So this is installed as the
 * `lookup` function on the request itself — whatever address it returns is the
 * address the kernel connects to, and nothing resolves the name again.
 *
 * Every returned address is checked. A hostname with one public and one private
 * A record must not be reachable by retrying until the private one is picked, so
 * private answers are dropped rather than the set being rejected only when all
 * of them are private... except that dropping is exactly what an attacker wants
 * if they can make the public answer fail. Hence: if ANY answer is private, the
 * whole resolution is refused.
 */
export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';
  constructor(hostname: string, address: string) {
    super(
      `refusing to connect to ${hostname}: resolves to non-public address ${address}`,
    );
    this.name = 'SsrfBlockedError';
  }
}

export type PinnedLookup = (
  hostname: string,
  options: LookupOneOptions | LookupAllOptions | number,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

/**
 * Build a `lookup` implementation for http(s).request.
 *
 * @param allowLoopback tolerate 127.0.0.1/::1 — sandbox endpoints may legitimately
 *   point at localhost during local development. Never enable in production.
 */
export function createPinnedLookup(allowLoopback = false): PinnedLookup {
  return function pinnedLookup(hostname, options, callback) {
    const opts = typeof options === 'number' ? { family: options } : options;

    dnsLookup(
      hostname,
      { ...opts, all: true },
      (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
        if (err) return callback(err, '', 0);
        if (!addresses || addresses.length === 0) {
          const e: NodeJS.ErrnoException = new Error(
            `no addresses for ${hostname}`,
          );
          e.code = 'ENOTFOUND';
          return callback(e, '', 0);
        }

        for (const a of addresses) {
          if (isLoopback(a.address) && allowLoopback) continue;
          if (isPrivateAddress(a.address)) {
            return callback(new SsrfBlockedError(hostname, a.address), '', 0);
          }
        }

        const wantsAll =
          typeof options !== 'number' && (options as LookupAllOptions).all;
        if (wantsAll) return callback(null, addresses);
        return callback(null, addresses[0].address, addresses[0].family);
      },
    );
  };
}

function isLoopback(address: string): boolean {
  return address === '::1' || address.startsWith('127.');
}
