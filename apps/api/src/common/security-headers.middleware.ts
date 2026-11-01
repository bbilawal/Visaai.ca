import type { Request, Response, NextFunction } from 'express';

/**
 * Baseline security headers (SEC — hardening). The audit found no HSTS / CSP /
 * X-Frame-Options / nosniff at any layer. This sets a sane default in-app; the
 * edge (nginx) should also set these (see docs/production/vps-hardening) so they
 * survive even if a request bypasses the app. Kept dependency-free (no helmet)
 * to avoid a mid-release install; swap for `helmet()` when convenient.
 */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  res.removeHeader('X-Powered-By');
  next();
}
