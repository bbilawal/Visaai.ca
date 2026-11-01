import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Sentry } from '../observability/sentry';

interface ErrorEnvelope {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
}

/**
 * Single global exception filter → one consistent error envelope across every
 * controller. Before this, error shapes diverged (Nest default 3-field body,
 * a 2-field analytics filter, and zod `flatten()` objects nested under
 * `message`), so clients could not parse errors uniformly.
 *
 * 5xx bodies are intentionally generic (no internal message leakage); the real
 * error is logged server-side. 4xx keep their message so clients can react.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<{
      status: (c: number) => { json: (b: unknown) => void };
    }>();
    const req = ctx.getRequest<{ url?: string; method?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        // zod `flatten()` and class-validator arrays land here → keep the human
        // string in `message`, move the structured payload to `details`.
        if (typeof b.message === 'string') {
          message = b.message;
        } else if (b.message !== undefined) {
          message = 'Validation failed';
          details = b.message;
        } else if (b.fieldErrors || b.formErrors) {
          message = 'Validation failed';
          details = b;
        }
      }
    }

    const envelope: ErrorEnvelope = {
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      ...(details !== undefined ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: req?.url ?? '',
    };

    if (status >= 500) {
      this.logger.error(
        `${req?.method ?? ''} ${req?.url ?? ''} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // No-op unless SENTRY_DSN is configured.
      Sentry.captureException(exception);
    }

    res.status(status).json(envelope);
  }
}
