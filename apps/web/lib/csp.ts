// SEC-8002: the web tier shipped with no CSP and no security headers at all.
// These are defence in depth in addition to nginx (which may or may not set
// them). connect-src is kept as `https:`/`wss:` rather than hardcoding the
// Supabase/API origins because those are per-environment env vars; that still
// forbids plaintext exfiltration channels. script-src keeps 'unsafe-inline'
// because Next injects inline bootstrap scripts and this build has no nonce
// pipeline yet — tightening to nonces is tracked as a follow-up. In dev, HMR
// needs 'unsafe-eval' and ws: so the CSP is relaxed there.
//
// Dev also allows the configured API and Supabase origins by name. Locally
// they are plain http (http://localhost:4000, http://127.0.0.1:54321), which
// `https:` does not cover, so the browser refused every API call: the country
// picker sat on "Loading countries…" forever and both Playwright CI jobs
// failed on it. Production is unchanged — it never gets these origins.

export interface CspInput {
  isProd: boolean
  apiUrl?: string
  supabaseUrl?: string
}

function originOf(url: string | undefined): string[] {
  if (!url) return []
  try {
    return [new URL(url).origin]
  } catch {
    return []
  }
}

export function buildCsp({ isProd, apiUrl, supabaseUrl }: CspInput): string {
  const devOrigins = isProd ? [] : [...originOf(apiUrl), ...originOf(supabaseUrl)]
  return [
    `default-src 'self'`,
    isProd
      ? `script-src 'self' 'unsafe-inline'`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    isProd
      ? `connect-src 'self' https: wss:`
      : [`connect-src 'self' https: wss: ws:`, ...devOrigins].join(' '),
    `frame-ancestors 'none'`,
    `frame-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    ...(isProd ? [`upgrade-insecure-requests`] : []),
  ].join('; ')
}
