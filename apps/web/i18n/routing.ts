import { defineRouting } from 'next-intl/routing'
import { LOCALES, DEFAULT_LOCALE } from './config'

/**
 * Sub-path i18n routing.
 *
 * localePrefix: 'as-needed' — the default locale (English) has NO URL prefix, so
 * every existing English route (/login, /applications/new, …) keeps working
 * unchanged. Non-default locales are prefixed (/fr/login, /ar/dashboard). This
 * minimises breakage: English behaviour is identical to before; only non-English
 * users get prefixed URLs (which is what enables hreflang / per-locale indexing).
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeDetection: true,
})
