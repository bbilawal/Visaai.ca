/**
 * Environment isolation.
 *
 * Task 13 §1: "Do not allow staging or test workloads to access production
 * data." That is a property of configuration, and configuration is the thing
 * most likely to be copied between environments — a staging box provisioned by
 * copying production's `.env` and editing two lines is the normal way this
 * fails, and it fails silently: everything works, against real applicants'
 * files.
 *
 * So it is enforced at boot. A non-production process configured against a
 * production resource refuses to start rather than quietly serving.
 *
 * Pure functions: no I/O, no process.env reads. The caller supplies the
 * config, which keeps this testable and keeps the rule in one place.
 */

/** Deployment environments, ordered by blast radius. */
export type DeploymentEnv =
  | 'development'
  | 'test'
  | 'ci'
  | 'staging'
  | 'production';

export const NON_PRODUCTION: readonly DeploymentEnv[] = [
  'development',
  'test',
  'ci',
  'staging',
] as const;

/**
 * The production Supabase project reference.
 *
 * Not a secret — it appears in every client-side URL — but it is the single
 * identifier that distinguishes the real database from every other one, which
 * makes it exactly the right thing to assert against.
 */
export const PRODUCTION_SUPABASE_REF = 'ujxzxefvtaoxiydbdrhb';

/** Hostname of the production VPS. */
export const PRODUCTION_HOST = 'srv1584195.hstgr.cloud';

export interface IsolationInput {
  env: string;
  supabaseUrl?: string;
  redisUrl?: string;
  webUrl?: string;
  /** Stripe key — `sk_live_` must never appear outside production. */
  stripeSecretKey?: string;
  /** Any additional URL that should be checked for production identifiers. */
  extraUrls?: (string | undefined)[];
}

export interface IsolationViolation {
  field: string;
  reason: string;
}

/** Extract a Supabase project ref from a URL, if it is one. */
export function supabaseRef(url: string | undefined): string | null {
  if (!url) return null;
  const match = /^https?:\/\/([a-z0-9]{20})\.supabase\.(co|in)/i.exec(
    url.trim(),
  );
  return match ? match[1].toLowerCase() : null;
}

function isProductionEnv(env: string): boolean {
  return env === 'production';
}

/**
 * Every way a non-production process could be pointed at production.
 *
 * Returns violations rather than throwing so the caller can report all of them
 * at once — an operator fixing one variable at a time across four boot
 * attempts is how people end up disabling the check.
 */
export function findIsolationViolations(
  input: IsolationInput,
): IsolationViolation[] {
  const violations: IsolationViolation[] = [];
  if (isProductionEnv(input.env)) return violations;

  if (supabaseRef(input.supabaseUrl) === PRODUCTION_SUPABASE_REF) {
    violations.push({
      field: 'SUPABASE_URL',
      reason: `points at the production Supabase project (${PRODUCTION_SUPABASE_REF}) while NODE_ENV=${input.env}`,
    });
  }

  // A shared Redis means a staging worker can claim a production job off the
  // queue and act on it.
  if (input.redisUrl?.includes(PRODUCTION_HOST)) {
    violations.push({
      field: 'REDIS_URL',
      reason: `points at the production host (${PRODUCTION_HOST}) while NODE_ENV=${input.env}`,
    });
  }

  if (input.webUrl?.includes(PRODUCTION_HOST)) {
    violations.push({
      field: 'WEB_URL',
      reason: `points at the production host (${PRODUCTION_HOST}) while NODE_ENV=${input.env}`,
    });
  }

  // A live Stripe key outside production charges real cards from a test run.
  if (input.stripeSecretKey?.startsWith('sk_live_')) {
    violations.push({
      field: 'STRIPE_SECRET_KEY',
      reason: `is a LIVE key while NODE_ENV=${input.env}; test runs would charge real cards`,
    });
  }

  for (const [index, url] of (input.extraUrls ?? []).entries()) {
    if (!url) continue;
    if (
      supabaseRef(url) === PRODUCTION_SUPABASE_REF ||
      url.includes(PRODUCTION_HOST)
    ) {
      violations.push({
        field: `extraUrls[${index}]`,
        reason: `references a production resource while NODE_ENV=${input.env}`,
      });
    }
  }

  return violations;
}

/** Human-readable refusal, listing every violation. */
export function formatIsolationError(violations: IsolationViolation[]): string {
  const lines = violations.map((v) => `  - ${v.field} ${v.reason}`);
  return [
    'Environment isolation violation — refusing to start.',
    '',
    ...lines,
    '',
    'A non-production process must never be configured against production',
    'resources. Point these at the staging project, or set NODE_ENV=production',
    'if this really is the production box.',
  ].join('\n');
}

/** Throws unless the configuration is isolated. Called from `validateEnv`. */
export function assertEnvironmentIsolation(input: IsolationInput): void {
  const violations = findIsolationViolations(input);
  if (violations.length > 0) {
    throw new Error(formatIsolationError(violations));
  }
}
