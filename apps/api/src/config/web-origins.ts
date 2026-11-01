/**
 * One API can serve both independently deployed web sites. WEB_URL remains the
 * backwards-compatible primary origin; WEB_URLS adds comma-separated origins.
 */
export function webOrigins(): string[] {
  const values = [process.env.WEB_URL ?? 'http://localhost:3000', ...(process.env.WEB_URLS ?? '').split(',')]
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
