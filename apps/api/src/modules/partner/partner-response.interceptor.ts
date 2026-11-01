import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { PartnerPrincipal } from '@visaai/types';
import {
  CURRENT_API_VERSION,
  deprecationHeaders,
  resolveRequestId,
} from './partner-governance';
import { PartnerUsageService } from './partner-usage.service';

/**
 * Cross-cutting response behaviour for every partner route:
 *   - assign / echo the request id (before the guard runs, so errors have it)
 *   - stamp the API version and any deprecation notice
 *   - surface rate-limit state on every response, not only on 429s — a client
 *     that can only discover the limit by hitting it will hit it
 *   - append to the request log with the ROUTE TEMPLATE, never the resolved
 *     path, so the log never becomes a list of which ids were fetched
 */
/** Only the parts of the express request/response this interceptor touches. */
interface InterceptedRequest {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  route?: { path?: string };
  partner?: PartnerPrincipal;
  partnerRequestId?: string;
  partnerRateLimit?: { limit: number; remaining: number; resetAt: string };
}

interface InterceptedResponse {
  setHeader?: (name: string, value: string) => void;
  statusCode?: number;
}

@Injectable()
export class PartnerResponseInterceptor implements NestInterceptor {
  constructor(private readonly usage: PartnerUsageService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<InterceptedRequest>();
    const res = http.getResponse<InterceptedResponse>();
    const started = Date.now();

    const requestId = resolveRequestId(req.headers?.['x-request-id']);
    req.partnerRequestId = requestId;
    res.setHeader?.('X-Request-Id', requestId);
    res.setHeader?.('X-Api-Version', CURRENT_API_VERSION);

    const deprecation = deprecationHeaders(CURRENT_API_VERSION);
    if (deprecation) {
      for (const [key, value] of Object.entries(deprecation)) {
        res.setHeader?.(key, value);
      }
    }

    return next.handle().pipe(
      tap({
        next: () => this.finish(req, res, started, requestId, null),
        error: (err: unknown) =>
          this.finish(req, res, started, requestId, errorCodeOf(err)),
      }),
    );
  }

  private finish(
    req: InterceptedRequest,
    res: InterceptedResponse,
    started: number,
    requestId: string,
    errorCode: string | null,
  ): void {
    const limits = req.partnerRateLimit;
    if (limits && limits.limit > 0) {
      res.setHeader?.('RateLimit-Limit', String(limits.limit));
      res.setHeader?.('RateLimit-Remaining', String(limits.remaining));
      res.setHeader?.('RateLimit-Reset', limits.resetAt);
    }

    const principal = req.partner;
    // No principal means authentication failed; there is no application to
    // bill the request to, and logging it under a guess would be wrong.
    if (!principal) return;

    void this.usage.log({
      applicationId: principal.applicationId,
      environment: principal.environment,
      method: req.method ?? 'GET',
      routeTemplate: req.route?.path ?? 'unknown',
      apiVersion: CURRENT_API_VERSION,
      statusCode: res.statusCode ?? (errorCode ? 500 : 200),
      latencyMs: Date.now() - started,
      requestId,
      credentialKind: principal.credentialKind,
      credentialId: principal.credentialId,
      errorCode,
    });
  }
}

function errorCodeOf(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : 'error';
}
