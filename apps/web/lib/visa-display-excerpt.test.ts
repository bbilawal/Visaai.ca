import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The public page may quote the authority. It may NOT quote our normalizer.
 *
 * BUG_LOG D-11. Every requirement in this registry exists only because it is
 * bound to a verbatim government quote, and the applicant was shown none of it:
 * the web query never selected an excerpt at all, so the page rendered VisaAI's
 * label and description — the paraphrase — while the evidence sat in the
 * database.
 *
 * The tempting fix was to select `source_excerpt`. That column is LOWERCASED by
 * the monitor's normalizer, which is correct for its job (a CMS restyling
 * "Fees" to "FEES" has not changed the law) and wrong for quoting: IRCC wrote
 * "You must: have a valid travel document, like a passport" and the stored
 * matching text reads "you must: have a valid travel document , like a
 * passport", complete with a space an inline `<a>` tag left behind.
 *
 * Rendering that between quotation marks would put our processing artifacts
 * inside a quotation attributed to a government — misquoting an authority in
 * the one feature built to prove we quote them.
 *
 * So the display text is derived separately and stored separately, and these
 * tests hold the line on the properties that make it safe to publish. They read
 * the extraction files rather than mocking, because the files are what ships.
 */

const DIR = join(__dirname, '../../../data/requirements')

interface Req {
  requirement_code: string
  source_excerpt: string
  source_excerpt_display?: string
}
interface Doc {
  visaai_id?: string
  requirements?: Req[]
}

function everyRequirement(): Array<{ file: string; req: Req }> {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Doc
      // KNOWN_FIGURE_CONFLICTS.json and friends have no visaai_id.
      if (!doc.visaai_id || !Array.isArray(doc.requirements)) return []
      return doc.requirements.map((req) => ({ file, req }))
    })
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('display excerpts', () => {
  const all = everyRequirement()

  it('reads the extraction corpus', () => {
    expect(all.length).toBeGreaterThan(500)
  })

  /**
   * The defect itself, as a corpus-level test.
   *
   * A single display excerpt equal to its matching excerpt proves nothing —
   * plenty of government bullets are genuinely all lowercase, or start
   * mid-sentence. But if someone ever "fixes" a NULL by copying
   * `source_excerpt` across, EVERY display excerpt becomes identical to its
   * matching text at once, and that is unmistakable in aggregate.
   *
   * Government prose capitalises sentences and proper nouns, so a real
   * derivation changes a large share of them. Anything approaching zero means
   * the lowercased matching text is being served as a quotation.
   */
  it('is derived, not copied from the lowercased matching text', () => {
    const withDisplay = all.filter(({ req }) => req.source_excerpt_display)
    const changed = withDisplay.filter(
      ({ req }) => flat(req.source_excerpt_display!) !== flat(req.source_excerpt),
    )
    expect(withDisplay.length).toBeGreaterThan(0)
    expect(changed.length / withDisplay.length).toBeGreaterThan(0.5)
  })

  /**
   * A quotation may not silently drop text. The extraction rules allow a cut
   * only when it is declared with " ... ", and the display text must carry
   * exactly the cuts the matching text declares — no more, no fewer.
   */
  it('declares exactly the same elisions as the matching excerpt', () => {
    const mismatched = all
      .filter(({ req }) => req.source_excerpt_display)
      .filter(({ req }) => {
        const cuts = (s: string) => (flat(s).match(/ \.\.\. /g) ?? []).length
        return cuts(req.source_excerpt_display!) !== cuts(req.source_excerpt)
      })
    expect(mismatched.map((o) => `${o.file}:${o.req.requirement_code}`)).toEqual([])
  })

  /**
   * The display text is the same words, differently cased. If lowercasing it
   * does not reproduce the matching excerpt, it is a quotation of something
   * else — the failure mode that would be invisible on the page and wrong.
   *
   * Whitespace before punctuation is repaired in the display text (an inline
   * tag left it there, not the government), so the comparison ignores spacing.
   */
  it('is the matching excerpt in the authority own casing, and nothing else', () => {
    const drifted = all
      .filter(({ req }) => req.source_excerpt_display)
      .filter(({ req }) => {
        const strip = (s: string) => flat(s).toLowerCase().replace(/\s+/g, '')
        return strip(req.source_excerpt_display!) !== strip(req.source_excerpt)
      })
    expect(drifted.map((o) => `${o.file}:${o.req.requirement_code}`)).toEqual([])
  })

  /**
   * No quotation may contain raw markup.
   *
   * ImmD writes "fiancé/fiancée" as `fianc&eacute;/fianc&eacute;e`. That entity
   * was missing from the normalizer's table, so it survived as literal text and
   * was PUBLISHED on three Hong Kong pages inside a quotation attributed to a
   * government.
   *
   * Every existing check passed it. `verify-excerpts` re-fetches the page and
   * normalizes it with the same function that produced the excerpt, so both
   * agreed on the broken spelling; the casing test compares the display excerpt
   * to the matching one, and both carried it. Each check compared our text
   * against our own text.
   *
   * This one asks a question none of them asked — is this text something a
   * government would have written? — and it is a shape check, so it catches the
   * next entity rather than only `&eacute;`.
   */
  it('publishes no quotation containing an HTML entity reference', () => {
    const withMarkup = all
      .filter(({ req }) => req.source_excerpt_display)
      .filter(({ req }) => /&[a-z][a-z0-9]*;|&#\d+;|&#x[0-9a-f]+;/i.test(req.source_excerpt_display!))
      .map((o) => `${o.file}:${o.req.requirement_code}`)
    expect(withMarkup).toEqual([])
  })

  /** The matching text must not carry it either — it is the same span. */
  it('stores no matching excerpt containing an HTML entity reference', () => {
    const withMarkup = all
      .filter(({ req }) => /&[a-z][a-z0-9]*;|&#\d+;|&#x[0-9a-f]+;/i.test(req.source_excerpt))
      .map((o) => `${o.file}:${o.req.requirement_code}`)
    expect(withMarkup).toEqual([])
  })

  /**
   * Routes that legitimately publish no quotations, and why.
   *
   * An ALLOWLIST rather than a threshold, for the same reason
   * `data/KNOWN_FIGURE_CONFLICTS.json` is one: a percentage floor cannot notice
   * a single new route shipping without quotes — 1,100 of 1,204 is still 91% —
   * so it would pass while a whole destination rendered nothing but VisaAI's
   * paraphrase. Adding an entry here is a decision somebody has to make and
   * defend in review.
   *
   * Every entry is the same cause: `immi.homeaffairs.gov.au` returns 403 to an
   * identified agent, including on `robots.txt`, so nothing can be re-fetched
   * to recover the authority's casing from. Those routes have no active
   * requirements either and publish nothing at all — see the coverage matrix,
   * BLOCKED BY OFFICIAL SOURCE, and `docs/operations/SOURCE_ACCESS.md`.
   */
  const NO_QUOTATIONS_EXPECTED = new Set([
    'au-business-innovation-and-investment-provisional-visa-subclass-188.json',
    'au-electronic-travel-authority-subclass-601.json',
    'au-partner-visa-apply-in-australia-subclass-820-and-801.json',
    'au-skills-in-demand-visa-subclass-482.json',
    'au-student-visa-subclass-500.json',
    'au-visitor-visa-subclass-600.json',
    'au-working-holiday-visa-subclass-417.json',
  ])

  const byFile = () => {
    const m = new Map<string, { have: number; total: number }>()
    for (const { file, req } of all) {
      const e = m.get(file) ?? { have: 0, total: 0 }
      e.total++
      if (req.source_excerpt_display) e.have++
      m.set(file, e)
    }
    return m
  }

  /**
   * A route either quotes its authority throughout or not at all.
   *
   * A PARTIAL file is the signature of an extraction edited after the display
   * excerpts were derived: the new requirements carry no quotation and nobody
   * notices, because the page still shows quotes under every other line. Run
   * `apps/api/scripts/derive-display-excerpts.ts` over the file.
   */
  it('has no half-quoted route', () => {
    const partial = [...byFile().entries()]
      .filter(([, { have, total }]) => have > 0 && have < total)
      .map(([file, { have, total }]) => `${file} (${have}/${total})`)
    expect(partial).toEqual([])
  })

  /**
   * And a route that quotes nothing must be one we have already decided cannot.
   */
  it('quotes the authority on every route except the ones that cannot', () => {
    const silent = [...byFile().entries()]
      .filter(([, { have }]) => have === 0)
      .map(([file]) => file)
      .filter((file) => !NO_QUOTATIONS_EXPECTED.has(file))
    expect(silent).toEqual([])
  })

  /**
   * The allowlist must not outlive its reason. If an authority becomes readable
   * again, this fails and the entry comes out — otherwise the list quietly
   * becomes a place where missing quotations go to be forgotten.
   */
  it('keeps no stale entry in the allowlist', () => {
    const files = byFile()
    const stale = [...NO_QUOTATIONS_EXPECTED].filter(
      (f) => (files.get(f)?.have ?? 0) > 0,
    )
    expect(stale).toEqual([])
  })
})
