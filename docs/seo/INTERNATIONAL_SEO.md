# International SEO

15 locales: `en fr es de it pt nl ar tr hi ur zh zh-TW ja ko`. `ar` and `ur` are
RTL. As-needed prefixing — English is unprefixed.

## Fixed

**Cross-locale canonical.** Every locale variant canonicalised to the English
URL, telling search engines to drop 42 URLs and contradicting the hreflang block
in the same `<head>`. See `TECHNICAL_SEO_IMPLEMENTATION.md` §1.

**Self-referencing alternates.** Each page now lists all 15 locales and declares
its own, which is what makes an hreflang cluster valid. Asserted per locale in
`alternates.test.ts`.

**`x-default`** now appears on both the sitemap side and the on-page side,
pointing at the unprefixed English URL — the version served to a visitor whose
language matches none of the 15, which is what `x-default` means. It was
previously on-page only for three routes, and a one-sided declaration is
discarded.

## The blocking problem, stated plainly

**The 15 locales serve English on the marketing and legal pages.**
`/fr/pricing` and `/de/pricing` return English `<title>`, description and `<h1>`
under `lang="fr"` / `lang="de"`. The *funnel* is translated —
`/fr/applications/new` genuinely renders French — but `/pricing`, `/privacy` and
`/terms` are not.

**Fixing the canonical without fixing this converts a deindexing bug into 42
duplicate English pages.** They must be sequenced together:

1. Translate the marketing and legal content, or
2. `noindex` the untranslated locale variants until translated, or
3. Reduce the indexed locale set to those actually translated.

Doing (1) is the only option that grows anything. Until one of the three is
done, the canonical fix has made those pages *eligible* to be indexed as
duplicates rather than *ineligible* as false duplicates — better, but not the
end state.

## The new visa pages have the same shape

`/fr/visas/canada` renders with a correct French-locale canonical and a valid
hreflang cluster, but its content is English. The government facts on it —
`Visitor visa (temporary resident visa)`, the authority name, the URLs — are
**correctly not translated**: translating an official visa name changes a
government's own wording, which the spec forbids. The surrounding explanatory
copy should be translated and is not.

Rule for translation work on these pages: **translate VisaAI's explanation,
never the authority's wording.** `official_name`, `official_code` and source
titles stay as published. `visa_countries.localized_names` exists for country
display names, which are safe to localize.

## RTL

`ar` and `ur` set `dir="rtl"` at the layout level. The new visa components use
Tailwind utilities that are mostly logical, but no RTL visual audit was
performed on this branch — the accessibility audit that would have covered it
did not complete. Recorded as unverified rather than assumed correct.

## Not done

- translation of marketing, legal and visa explanatory copy
- `hreflang` on `/`, `/login`, `/signup` (the sitemap declares 15 alternates for
  each; the pages emit none)
- locale-specific `lastmod`
- RTL visual verification
