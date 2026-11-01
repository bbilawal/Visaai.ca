import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from './routing'

/** Deep-merge so any missing key in a locale falls back to English. */
function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === 'object'
    ) {
      out[k] = deepMerge(base[k] as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Sub-path routing mode: the locale comes from the `[locale]` URL segment
 * (resolved by the middleware + routing). Messages are the locale file merged
 * over English so any missing key falls back to English.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale

  const en = (await import('../messages/en.json')).default as Record<string, unknown>
  const messages =
    locale === 'en'
      ? en
      : deepMerge(
          en,
          (await import(`../messages/${locale}.json`)).default as Record<string, unknown>,
        )

  return { locale, messages }
})
