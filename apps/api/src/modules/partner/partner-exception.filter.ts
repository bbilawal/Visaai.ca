import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Sentry } from '../../observability/sentry';
import { redact } from '../shared/log/redact';
import { PartnerApiException, OAuthException } from './partner-errors';
import { resolveRequestId } from './partner-governance';
import type { PartnerErrorBody } from '@visaai/types';

/**
 * Error rendering for partner routes. Applied per-controller, so it overrides
 * the global AllExceptionsFilter without changing behaviour anywhere else.
 *
 * Three rules:
 *   - the partner error envelope is the contract; nothing else escapes
 *   - 5xx never carries an internal message, only the request id
 *   - the request id appears in the body AND the header, so a partner can
 *     quote it from either
 */
/**
 * Minimal structural types for the pieces of the express request/response we
 * touch. Nest types `getRequest()` as `any`, and an `any` here would silently
 * swallow a typo in a header name.
 */
interface PartnerErrorResponse {
  status: (code: number) => { json: (body: unknown) => void };
  setHeader?: (name: string, value: string) => void;
}

interface PartnerErrorRequest {
  partnerRequestId?: string;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  route?: { path?: string };
}

@Catch()
export class PartnerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PartnerApi');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<PartnerErrorResponse>();
    const req = ctx.getRequest<PartnerErrorRequest>();

    const requestId = resolveRequestId(
      req?.partnerRequestId ?? req?.headers?.['x-request-id'],
    );
    res.setHeader?.('X-Request-Id', requestId);

    // RFC 6749 defines the token endpoint's error body; ours would be wrong
    // there and would break every conforming OAuth client library.
    if (exception instanceof OAuthException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof PartnerApiException) {
      if (exception.errorOptions.retryAfter !== undefined) {
        res.setHeader?.(
          'Retry-After',
          String(exception.errorOptions.retryAfter),
        );
      }
      res.status(exception.httpStatus).json(exception.toBody(requestId));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: PartnerErrorBody = {
        error: {
          type: status >= 500 ? 'api_error' : 'invalid_request',
          code: status >= 500 ? 'internal_error' : 'invalid_request',
          message:
            status >= 500
              ? 'Something went wrong on our side.'
              : extractMessage(exception),
          request_id: requestId,
        },
      };
      if (status >= 500) this.report(exception, req, requestId);
      res.status(status).json(body);
      return;
    }

    // Unknown throw: log the detail, tell the partner nothing but the id.
    this.report(exception, req, requestId);
    const body: PartnerErrorBody = {
      error: {
        type: 'api_error',
        code: 'internal_error',
        message:
          'Something went wrong on our side. Quote the request id when contacting support.',
        request_id: requestId,
      },
    };
    res.status(500).json(body);
  }

  private report(
    exception: unknown,
    request: PartnerErrorRequest,
    requestId: string,
  ): void {
    this.logger.error(
      redact(
        `${request?.method ?? ''} ${request?.route?.path ?? ''} req=${requestId} → ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
      ),
      exception instanceof Error ? exception.stack : undefined,
    );
    Sentry.captureException(exception);
  }
}

function extractMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return 'The request could not be processed.';
}
