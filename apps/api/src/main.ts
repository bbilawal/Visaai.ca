// Load .env into process.env BEFORE any module imports so that decorator-time
// reads of process.env (e.g. @WebSocketGateway cors origin) get the right values.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

if (!('WebSocket' in globalThis))
  (globalThis as Record<string, unknown>).WebSocket = require('ws').WebSocket;
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { securityHeaders } from './common/security-headers.middleware';
import { initSentry } from './observability/sentry';
import { webOrigins } from './config/web-origins';

async function bootstrap() {
  // Error tracking (no-op without SENTRY_DSN). Init before the app is created.
  initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true, // hold logs until the pino logger is attached
  });
  // Route Nest's own logs through the structured pino logger.
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Behind nginx: trust the proxy so `req.ip` / X-Forwarded-For resolve to the
  // real client. Without this the per-IP throttler and login-lockout collapse
  // every caller into one bucket (self-DoS + ineffective brute-force limits).
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: webOrigins(),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  app.enableShutdownHooks();

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`API running on port ${port}`);
}

bootstrap();
