import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  InvalidQueryError,
  UnsupportedFilterError,
} from '../analytics-metrics/contracts/metric.errors';
import {
  AlertValidationError,
  AlertNotFoundError,
} from './analytics-alerts.errors';

@Catch()
export class AnalyticsAlertsExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let message = 'Internal error';
    if (err instanceof AlertNotFoundError) {
      status = 404;
      message = err.message;
    } else if (
      err instanceof AlertValidationError ||
      err instanceof InvalidQueryError ||
      err instanceof UnsupportedFilterError
    ) {
      status = 400;
      message = err.message;
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      message = err.message;
    } else if (err instanceof Error) {
      // ERR-001: an UNEXPECTED error keeps the generic message.
      //
      // This branch used to assign `err.message` with the status left at 500,
      // which silently opted every route under this filter out of the platform
      // protection `AllExceptionsFilter` documents as "5xx bodies are
      // intentionally generic (no internal message leakage)". A raw Postgres
      // error — table, column and constraint names — or any TypeError went
      // straight to the client. The typed domain errors above are curated
      // messages and stay; only the catch-all is genericised, and logged so the
      // detail is not lost.
      Logger.error(
        `unhandled error: ${err.message}`,
        err.stack,
        'AnalyticsExceptionFilter',
      );
    }
    res.status(status).json({ statusCode: status, message });
  }
}
