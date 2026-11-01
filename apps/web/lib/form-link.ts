import { getOfficialFormUrl, getOfficialSearchUrl } from './official-forms'

/**
 * Build a navigable URL for a suggested form.
 *
 * The AI-suggested `source_url` is intentionally NOT used for navigation: those
 * model-generated links are frequently stale/hallucinated and 404 even when
 * syntactically valid. Instead:
 *   1. If we have a *verified* canonical URL for this form code, use it.
 *   2. Otherwise fall back to a search scoped to the destination country's
 *      official immigration site, which always lands somewhere real (no 404).
 *
 * `isFallback` is true when we used the search fallback (no verified direct URL).
 */
export function getFormHref(opts: {
  source_url?: string | null
  form_code?: string | null
  form_name?: string | null
  country?: string | null
}): { href: string; isFallback: boolean } {
  const verified = getOfficialFormUrl(opts.form_code)
  if (verified) {
    return { href: verified, isFallback: false }
  }
  return {
    href: getOfficialSearchUrl({
      form_code: opts.form_code,
      form_name: opts.form_name,
      country: opts.country,
    }),
    isFallback: true,
  }
}
