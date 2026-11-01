import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';

/**
 * CONFIG-004: `KPI_ROLLUP_STALE_MIN` and `KPI_COHORT_STALE_HOURS` were declared
 * in the config schema and documented in `.env.example` as the "meta.stale
 * threshold", but every call site passed a hardcoded `slaMinutes: 15` or
 * `24 * 60`. Setting either variable did nothing.
 *
 * The hardcoded values happened to equal the schema defaults, so behaviour was
 * correct — the variables were simply inert. These helpers make them live while
 * preserving those exact defaults, so nothing changes for an environment that
 * does not set them.
 *
 * `config` is optional because several metric services are constructed directly
 * in unit tests without a ConfigService; absent config falls back to the
 * documented default.
 */

export const DEFAULT_ROLLUP_STALE_MIN = 15;
export const DEFAULT_COHORT_STALE_HOURS = 24;

export function rollupStaleMinutes(config?: ConfigService<Env>): number {
  return (
    config?.get('KPI_ROLLUP_STALE_MIN', { infer: true }) ??
    DEFAULT_ROLLUP_STALE_MIN
  );
}

export function cohortStaleMinutes(config?: ConfigService<Env>): number {
  const hours =
    config?.get('KPI_COHORT_STALE_HOURS', { infer: true }) ??
    DEFAULT_COHORT_STALE_HOURS;
  return hours * 60;
}
