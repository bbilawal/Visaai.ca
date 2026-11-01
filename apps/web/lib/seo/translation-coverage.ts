import { DEFAULT_LOCALE } from '@/i18n/config'

/**
 * Whether a locale variant of a page is translated enough to be indexed.
 *
 * THE PROBLEM
 *
 * Fixing the cross-locale canonical bug made 14 non-English variants of every
 * public page eligible for indexing. That is correct — they were previously
 * telling search engines to drop them — but it exposes the next problem: a page
 * whose content is still English, served under `lang="ja"` with a Japanese
 * canonical, is a duplicate. Fourteen of them per page.
 *
 * The two honest options were translate or noindex. This is the mechanism for
 * doing the second automatically, so a page is indexed in a language exactly
 * when it is actually available in that language — and starts being indexed the
 * moment someone translates it, with no separate flag to remember.
 *
 * WHY A COVERAGE CHECK RATHER THAN A HAND-MAINTAINED LIST
 *
 * A list of "which pages are translated into which locales" is wrong the day
 * after it is written. Comparing the rendered strings against the English ones
 * is self-maintaining: it cannot claim a translation exists that does not.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not judge translation QUALITY, and it must not be read as doing so.
 * It answers one narrow question — "is this string still identical to English?"
 * — which is a reliable signal for untranslated copy and no signal at all about
 * whether a translation is any good.
 */

/**
 * Strings shorter than this are excluded from the comparison.
 *
 * Short strings are legitimately identical across languages far too often to be
 * evidence of anything: "VisaAI", "OK", "PDF", "IMM 5257", a bare currency
 * amount. Including them would report a fully translated page as untranslated.
 */
const MIN_SIGNIFICANT_LENGTH = 25

export interface CoverageResult {
  locale: string
  /** Strings compared, after the length filter. */
  compared: number
  /** Of those, how many still read exactly as the English. */
  untranslated: number
  ratio: number
  indexable: boolean
}

/**
 * A page is indexable in a locale when at least this share of its significant
 * strings differ from English.
 *
 * 0.7 rather than 1.0 on purpose. A genuinely translated page still shares some
 * strings with English — brand names, official visa names that must NOT be
 * translated ("Visitor visa (temporary resident visa)"), form codes. Demanding
 * 100% would permanently noindex pages that are correctly and fully localized.
 */
export const INDEXABLE_TRANSLATION_RATIO = 0.7

function significantStrings(
  messages: Record<string, unknown>,
  section: string,
): Record<string, string> {
  const node = messages[section]
  if (!node || typeof node !== 'object') return {}
  const out: Record<string, string> = {}
  const walk = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        if (v.length >= MIN_SIGNIFICANT_LENGTH) out[prefix + k] = v
      } else if (v && typeof v === 'object') {
        walk(v as Record<string, unknown>, `${prefix}${k}.`)
      }
    }
  }
  walk(node as Record<string, unknown>, '')
  return out
}

/**
 * Compare one message section between a locale and English.
 *
 * `section` rather than the whole file: indexability is a per-PAGE question,
 * and a page reads one section. A site-wide ratio would noindex a fully
 * translated pricing page because the admin console is not translated.
 */
export function translationCoverage(
  locale: string,
  section: string,
  localeMessages: Record<string, unknown>,
  englishMessages: Record<string, unknown>,
): CoverageResult {
  if (locale === DEFAULT_LOCALE) {
    return { locale, compared: 0, untranslated: 0, ratio: 1, indexable: true }
  }

  const en = significantStrings(englishMessages, section)
  const loc = significantStrings(localeMessages, section)
  const keys = Object.keys(en).filter((k) => k in loc)

  // Nothing comparable — a section with no significant strings, or a locale
  // missing it entirely. Indexable, because there is no evidence of a problem
  // and this check must never be the reason a page disappears on a technicality.
  if (keys.length === 0) {
    return { locale, compared: 0, untranslated: 0, ratio: 1, indexable: true }
  }

  const untranslated = keys.filter((k) => loc[k] === en[k]).length
  const ratio = (keys.length - untranslated) / keys.length

  return {
    locale,
    compared: keys.length,
    untranslated,
    ratio,
    indexable: ratio >= INDEXABLE_TRANSLATION_RATIO,
  }
}

/**
 * Metadata `robots` value for a locale variant, or undefined to inherit.
 *
 * `follow` stays true on a noindex: the page is real, its links are real, and
 * the crawler should keep walking to the pages that ARE translated. Only the
 * duplicate-in-the-index problem is being solved.
 */
export function robotsForCoverage(
  coverage: CoverageResult,
): { index: false; follow: true } | undefined {
  return coverage.indexable ? undefined : { index: false, follow: true }
}
