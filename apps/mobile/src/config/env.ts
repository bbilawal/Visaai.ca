import Constants from 'expo-constants';

/**
 * Runtime configuration.
 *
 * Only `EXPO_PUBLIC_*` values are readable here, and everything in this file
 * ships inside the app binary — treat it all as public. The Supabase *anon*
 * key is designed for that (RLS is the boundary); the service-role key, Stripe
 * secret and VAPID private key must NEVER appear in this app.
 *
 * Values resolve in this order: EXPO_PUBLIC_* env → per-environment default.
 * Per-environment `.env.<name>` files are documented in VISAAIDocs/mobile/setup.md.
 */
export type AppEnv = 'development' | 'test' | 'staging' | 'production';

interface Defaults {
  apiUrl: string;
  webUrl: string;
}

const DEFAULTS: Record<AppEnv, Defaults> = {
  // Android emulators cannot reach the host via localhost — 10.0.2.2 is the
  // loopback alias. iOS simulators share the host network, so localhost works.
  development: { apiUrl: 'http://localhost:4000', webUrl: 'http://localhost:3000' },
  test: { apiUrl: 'http://localhost:4000', webUrl: 'http://localhost:3000' },
  staging: { apiUrl: 'https://staging-api.visaai.co', webUrl: 'https://staging.visaai.co' },
  production: { apiUrl: 'https://api.visaai.co', webUrl: 'https://visaai.co' },
};

function extra(): Record<string, unknown> {
  return (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
}

export const APP_ENV: AppEnv =
  (process.env.EXPO_PUBLIC_APP_ENV as AppEnv | undefined) ??
  ((extra().appEnv as AppEnv | undefined) ?? 'development');

const defaults = DEFAULTS[APP_ENV] ?? DEFAULTS.development;

export interface Env {
  appEnv: AppEnv;
  apiUrl: string;
  webUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Verified deep-link host; '' when the variant has no associated domain. */
  linkHost: string;
  analyticsEnabled: boolean;
  /** Wall-clock ceiling for a single API request. */
  requestTimeoutMs: number;
  isProduction: boolean;
}

export const env: Env = {
  appEnv: APP_ENV,
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? defaults.apiUrl).replace(/\/+$/, ''),
  webUrl: (process.env.EXPO_PUBLIC_WEB_URL ?? defaults.webUrl).replace(/\/+$/, ''),
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, ''),
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  linkHost: (extra().linkHost as string | undefined) ?? '',
  analyticsEnabled: process.env.EXPO_PUBLIC_ANALYTICS_ENABLED !== 'false',
  requestTimeoutMs: Number(process.env.EXPO_PUBLIC_REQUEST_TIMEOUT_MS ?? 20000),
  isProduction: APP_ENV === 'production',
};

/**
 * Fail loudly at startup rather than at the first mysterious 401. Returns the
 * list of missing keys so the caller can render a config error screen instead
 * of a blank app (throwing here would crash before any UI can explain why).
 */
export function missingRequiredConfig(e: Env = env): string[] {
  const missing: string[] = [];
  if (!e.supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!e.supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!e.apiUrl) missing.push('EXPO_PUBLIC_API_URL');
  return missing;
}

/**
 * Production must never talk to a cleartext origin — immigration documents and
 * bearer tokens would cross the wire unencrypted. iOS ATS blocks this at the
 * OS level too, but Android and dev-client builds would happily allow it.
 */
export function assertTransportSecurity(e: Env = env): void {
  if (!e.isProduction) return;
  for (const [key, url] of [
    ['apiUrl', e.apiUrl],
    ['webUrl', e.webUrl],
    ['supabaseUrl', e.supabaseUrl],
  ] as const) {
    if (url && !url.startsWith('https://')) {
      throw new Error(`Insecure ${key} in production build: ${url}`);
    }
  }
}
