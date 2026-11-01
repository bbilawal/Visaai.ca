import type { SupportedCountry } from './use-supported-countries'

/**
 * Translate destination-country names into the reader's language.
 *
 * WHY THIS EXISTS
 *
 * `GET /countries` derives its list live from the backend strategy registry and
 * returns each country's `name` as a hardcoded English string. There is no
 * locale on that endpoint and nothing downstream localised it, so the
 * destination picker translated everything about itself EXCEPT the countries:
 * on `/ur/applications/new` the heading, the labels, the placeholder and the
 * button were all Urdu, and the options read "Australia", "United States",
 * "Canada".
 *
 * WHY Intl.DisplayNames AND NOT A TRANSLATION FILE
 *
 * Country names in 15 languages is ~500 strings that would have to be written,
 * reviewed and then maintained as the registry grows — and every one of them is
 * already in the browser and in Node, standardised, from CLDR. A message file
 * would be a worse copy of data we already have, and it would go stale the
 * first time a country is added to the registry without a matching translation.
 *
 * The English name from the API stays the FALLBACK everywhere, so a locale
 * without data, a bloc code, or an unrecognised country degrades to exactly the
 * behaviour that shipped before this file existed.
 */

/** ISO 3166-1 alpha-2. Anything else is not a region and is never translated. */
const ISO2 = /^[A-Z]{2}$/

/**
 * Translate ONE country name, falling back to the API's English name.
 *
 * Three separate things can go wrong and all of them end at the fallback:
 *
 *   - `SCHENGEN` is a real, selectable option in this picker and is not an ISO
 *     region. `Intl.DisplayNames.of` throws RangeError on a structurally
 *     invalid code, and an uncaught throw here would empty the picker.
 *   - A well-formed but UNASSIGNED code (`ZZ`) does not throw. It returns the
 *     locale's words for "unknown region" — which is worse than the English
 *     name, because it looks like an answer.
 *   - A malformed locale tag throws from the constructor.
 */
export function localizeCountryName(
  code: string,
  fallbackName: string,
  locale: string,
): string {
  if (!ISO2.test(code)) return fallbackName

  try {
    // The locale is passed through WHOLE. `zh` and `zh-TW` are different
    // languages here — 澳大利亚 vs 澳洲 — and splitting on '-' would serve
    // mainland names to Taiwan.
    const display = new Intl.DisplayNames([locale], { type: 'region' })
    const translated = display.of(code)

    // `of()` returns the code itself when it has nothing better; treat that,
    // and anything empty, as no answer.
    if (!translated || !translated.trim() || translated === code) {
      return fallbackName
    }
    // The unassigned-code case: CLDR's "unknown region" string. It is the same
    // string for every unassigned code, so comparing against `ZZ`'s output
    // identifies it in any locale without hardcoding words.
    if (translated === unknownRegionLabel(locale)) return fallbackName

    return translated
  } catch {
    return fallbackName
  }
}

/** The locale's rendering of an unassigned region, cached per locale. */
const unknownCache = new Map<string, string | null>()
function unknownRegionLabel(locale: string): string | null {
  const hit = unknownCache.get(locale)
  if (hit !== undefined) return hit
  let label: string | null = null
  try {
    label = new Intl.DisplayNames([locale], { type: 'region' }).of('ZZ') ?? null
  } catch {
    label = null
  }
  unknownCache.set(locale, label)
  return label
}

/**
 * Localise a whole list, preserving the grouping contract the API sets.
 *
 * ORDERING IS PART OF THE FIX, NOT A BONUS. The API alphabetises the Schengen
 * and "other" groups by ENGLISH name. Translate them in place and that order
 * becomes wrong for the reader — in German, Niederlande sorts before
 * Österreich. So the non-priority groups are re-sorted with the locale's own
 * collator, which also gets the accented and non-Latin cases right.
 *
 * The PRIORITY group is never reordered. Those four are pinned launch corridors
 * in a fixed order the API chose deliberately, and alphabetising them in German
 * would scatter them.
 */
export function localizeCountries(
  countries: readonly SupportedCountry[],
  locale: string,
): SupportedCountry[] {
  const translated = countries.map((c) => ({
    ...c,
    name: localizeCountryName(c.code, c.name, locale),
  }))

  // Nothing changed, so nothing needs reordering. Returning early also keeps
  // English byte-identical to the API response.
  if (translated.every((c, i) => c.name === countries[i].name)) {
    return translated
  }

  const collator = safeCollator(locale)

  // Stable partition: groups keep the order the API sent them in, and only the
  // CONTENTS of the non-priority groups are re-sorted.
  const seen: string[] = []
  const byGroup = new Map<string, SupportedCountry[]>()
  for (const c of translated) {
    const key = c.group ?? 'other'
    if (!byGroup.has(key)) {
      byGroup.set(key, [])
      seen.push(key)
    }
    byGroup.get(key)!.push(c)
  }

  return seen.flatMap((key) => {
    const items = byGroup.get(key)!
    if (key === 'priority') return items
    return [...items].sort((a, b) => collator(a.name, b.name))
  })
}

/** `Intl.Collator` for the locale, degrading to a plain compare if unavailable. */
function safeCollator(locale: string): (a: string, b: string) => number {
  try {
    return new Intl.Collator(locale).compare
  } catch {
    return (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  }
}
