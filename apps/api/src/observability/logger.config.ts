import type { Params } from 'nestjs-pino';
import { resolveRequestId } from './request-id';

/**
 * Structured JSON logging (audit P0 #2) via pino. Replaces ad-hoc console.log so
 * production has parseable, level-controlled logs. Sensitive headers/fields are
 * redacted so tokens + PII never reach the log stream (passport platform).
 */
export const loggerConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["stripe-signature"]',
        'req.body.password',
        'req.body.token',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
    // Health probes are polled constantly — don't log them.
    autoLogging: {
      ignore: (req: { url?: string }) =>
        req.url === '/health' || req.url === '/health/ready',
    },
    customProps: () => ({ service: 'visaai-api' }),
    /**
     * OPS-004: correlate every log line of a request. pino-http puts the value
     * `genReqId` returns on `req.id` and includes it in each line it emits, so
     * this is correlation for the WHOLE API rather than only partner routes.
     *
     * An inbound X-Request-Id is honoured — so a trace spans the web app and
     * the API — but only after validation, because echoing an unvalidated
     * header into a log line is log injection and into a response header is
     * header splitting. Anything unsafe is replaced with a generated id.
     */
    genReqId: (
      req: { headers?: Record<string, unknown> },
      res: { setHeader?: (k: string, v: string) => void },
    ) => {
      const id = resolveRequestId(req.headers?.['x-request-id']);
      res.setHeader?.('X-Request-Id', id);
      return id;
    },
  },
};
