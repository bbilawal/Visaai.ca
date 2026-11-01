import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';

export function unsubToken(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId).digest('hex').slice(0, 32);
}

/**
 * Single source of truth for the unsubscribe HMAC secret, so generation and
 * verification never diverge. Prefers a dedicated UNSUBSCRIBE_SIGNING_SECRET;
 * falls back to SUPABASE_SERVICE_ROLE_KEY for back-compat with already-sent
 * links. All four call sites (2 generate, 2 verify) must use this.
 */
export function resolveUnsubSecret(config: ConfigService<Env>): string {
  return (
    config.get('UNSUBSCRIBE_SIGNING_SECRET', { infer: true }) ||
    (config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }) as string) ||
    ''
  );
}
