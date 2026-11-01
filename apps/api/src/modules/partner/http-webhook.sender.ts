import { Injectable } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { redact } from '../shared/log/redact';
import { isPrivateAddress } from './partner-webhook-url';
import { createPinnedLookup } from './pinned-lookup';
import type {
  WebhookSender,
  WebhookSendResult,
} from './partner-webhook.service';

const MAX_RESPONSE_BYTES = 2048;

/**
 * HTTP transport for webhook delivery.
 *
 * Four defensive choices worth stating:
 *
 * 1. Redirects are never followed. Following one would undo the SSRF check —
 *    a partner registers an innocuous https URL that 302s to 169.254.169.254
 *    and we follow it with a signed request. `node:http` does not follow
 *    redirects at all, so a 3xx is simply reported as a non-2xx response.
 *
 * 2. A pinned DNS lookup (PD-4). Registration-time URL validation cannot see
 *    where a hostname will point at delivery time. `createPinnedLookup` is
 *    installed as the request's own resolver, so the address it validates is
 *    the address the socket connects to — there is no second resolution to
 *    race. See `pinned-lookup.ts`.
 *
 * 3. The response body is truncated and passed through the PII redactor before
 *    it is stored. A partner's error page can contain anything, and it lands
 *    in our delivery log — which the partner can read back.
 *
 * 4. Every network failure is a `networkError`, never an exception. The retry
 *    policy decides what happens next; a throw here would bypass it.
 */
@Injectable()
export class HttpWebhookSender implements WebhookSender {
  /**
   * Loopback destinations are tolerated outside production so a developer can
   * point a sandbox endpoint at their own machine. Production refuses them
   * along with every other non-public address.
   */
  private readonly lookup = createPinnedLookup(
    process.env.NODE_ENV !== 'production',
  );

  async send(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<WebhookSendResult> {
    const started = Date.now();

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return {
        statusCode: null,
        networkError: true,
        durationMs: Date.now() - started,
        responseSnippet: 'malformed webhook url',
      };
    }

    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return {
        statusCode: null,
        networkError: true,
        durationMs: Date.now() - started,
        responseSnippet: `scheme not allowed: ${target.protocol}`,
      };
    }

    // A literal IP host never reaches the `lookup` hook — `net.connect` skips
    // resolution entirely when the host is already an address. So the literal
    // case has to be checked here, before a socket is opened.
    const literal = target.hostname.replace(/^\[|\]$/g, '');
    const loopbackOk = process.env.NODE_ENV !== 'production';
    const isLoopbackLiteral = literal === '::1' || literal.startsWith('127.');
    if (isPrivateAddress(literal) && !(loopbackOk && isLoopbackLiteral)) {
      return {
        statusCode: null,
        networkError: true,
        durationMs: Date.now() - started,
        responseSnippet: `refusing to connect to ${literal}: non-public address`,
      };
    }

    const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const payload = Buffer.from(body, 'utf8');

    return new Promise<WebhookSendResult>((resolve) => {
      let settled = false;
      const finish = (result: Omit<WebhookSendResult, 'durationMs'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, durationMs: Date.now() - started });
      };

      let req: ClientRequest;
      const timer = setTimeout(() => {
        req?.destroy(new Error(`timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        req = requestFn(
          {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: `${target.pathname}${target.search}`,
            method: 'POST',
            headers: {
              ...headers,
              'content-length': String(payload.byteLength),
            },
            lookup: this.lookup,
          },
          (res: IncomingMessage) => {
            readCapped(res)
              .then((text) =>
                finish({
                  statusCode: res.statusCode ?? null,
                  networkError: false,
                  responseSnippet: text === null ? null : redact(text),
                }),
              )
              .catch(() =>
                finish({
                  statusCode: res.statusCode ?? null,
                  networkError: false,
                  responseSnippet: null,
                }),
              );
          },
        );
      } catch (err) {
        finish({
          statusCode: null,
          networkError: true,
          responseSnippet: redact((err as Error).message),
        });
        return;
      }

      req.on('error', (err: Error) => {
        finish({
          statusCode: null,
          networkError: true,
          responseSnippet: redact(err.message),
        });
      });

      req.end(payload);
    });
  }
}

/**
 * Read at most MAX_RESPONSE_BYTES. A partner endpoint that streams a gigabyte
 * of HTML must not be able to exhaust our memory through a delivery attempt.
 */
async function readCapped(res: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;

    const settle = () => {
      if (done) return;
      done = true;
      if (chunks.length === 0) return resolve(null);
      resolve(
        Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString('utf8'),
      );
    };

    res.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.byteLength;
      if (total >= MAX_RESPONSE_BYTES) {
        res.destroy();
        settle();
      }
    });
    res.on('end', settle);
    res.on('error', settle);
    res.on('close', settle);
  });
}

/** Re-exported so callers can re-check a resolved address. */
export { isPrivateAddress };
