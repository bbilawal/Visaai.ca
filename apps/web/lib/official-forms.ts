/**
 * Verified official form destinations.
 *
 * Why this exists: the AI intake step suggests a `source_url` for each form, but
 * those URLs are model-generated and frequently stale or hallucinated. A
 * well-formed-but-dead canada.ca path passes a syntax check yet 404s when the
 * user clicks it. We therefore DO NOT navigate to AI `source_url`s directly.
 *
 * Instead:
 *  - Forms whose canonical URL is *verified* (proven live by a measured
 *    content-type check, not inherited from another module's behavior) get a
 *    direct link from OFFICIAL_FORM_URLS.
 *  - Everything else gets a search scoped to the destination country's official
 *    immigration domain, which always lands on real results and never 404s.
 *
 * IMPORTANT — what these entries are and are not for: this map exists purely
 * to give a HUMAN somewhere to click. It must hold a landing/guide page
 * (verified to return 200 text/html), never a direct PDF path. The entries
 * were emptied once, on the theory that the old /content/dam/.../imm5257e.pdf
 * URL didn't serve a PDF and was therefore "dead" — but that conflated two
 * unrelated uses: the API's form-cache pipeline needs a PDF to FILL, while
 * this file only ever needed a page to LINK a person to. The old PDF path
 * really was wrong for a fetcher, but the fix for a human-facing link was
 * never "link nowhere" — it was "link to the .html guide page", which
 * 200s and is exactly what a person expects to land on. Re-measured directly
 * (curl -sIL, following redirects): both imm5257.html and imm5645.html
 * return `200 text/html` with no redirect involved. Emptying this map had
 * regressed three surfaces (intake-chat-client.tsx, readiness-client.tsx,
 * documents-client.tsx) from a direct government link down to a generic
 * Google search, and left getOfficialFormUrl / getFormHref's `verified`
 * branch as dead code.
 *
 * To add a direct link here: measure the URL's response yourself (status +
 * content-type) before adding it. Do not paste model-suggested URLs, and do
 * not assume another module already verified a URL — verify it here too.
 */

function normalizeFormCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, ' ')
}

/** Canonical, verified download URLs keyed by normalized form code. */
const OFFICIAL_FORM_URLS: Record<string, string> = {
  'IMM 5257':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
  'IMM5257':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
  'IMM 5645':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
  'IMM5645':
    'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
}

/**
 * Destination country code → official immigration site host used to scope the
 * search fallback (`site:<host>`). Add entries as new destinations are supported.
 */
const OFFICIAL_DOMAINS: Record<string, string> = {
  CA: 'canada.ca',
  US: 'travel.state.gov',
  GB: 'gov.uk',
  AU: 'immi.homeaffairs.gov.au',
  NZ: 'immigration.govt.nz',
  IE: 'irishimmigration.ie',
}

/** Verified direct URL for a form code, or null if we don't have one. */
export function getOfficialFormUrl(formCode?: string | null): string | null {
  if (!formCode) return null
  return OFFICIAL_FORM_URLS[normalizeFormCode(formCode)] ?? null
}

/**
 * A search URL that lands the user on the official source for a form. Scoped to
 * the destination country's official domain when known. Never 404s.
 */
export function getOfficialSearchUrl(opts: {
  form_code?: string | null
  form_name?: string | null
  country?: string | null
}): string {
  const host = opts.country ? OFFICIAL_DOMAINS[opts.country.toUpperCase()] : undefined
  const terms = [opts.form_code ?? '', opts.form_name ?? '']
    .map(s => s.trim())
    .filter(Boolean)
  const scope = host ? `site:${host} ` : ''
  const tail = host ? '' : ' official visa application form'
  const q = `${scope}${terms.join(' ')}${tail}`.trim()
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}
