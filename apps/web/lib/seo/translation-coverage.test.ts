import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import fr from '@/messages/fr.json'
import ja from '@/messages/ja.json'
import {
  INDEXABLE_TRANSLATION_RATIO,
  robotsForCoverage,
  translationCoverage,
} from './translation-coverage'

const wrap = (section: string, strings: Record<string, string>) => ({
  [section]: strings,
})

// Long enough to clear MIN_SIGNIFICANT_LENGTH (25).
const LONG_EN = 'Take a free three-minute eligibility assessment before you pay'
const LONG_FR = 'Faites une évaluation gratuite de trois minutes avant de payer'
const LONG_EN_2 = 'Government fees are shown separately, always at cost price'
const LONG_FR_2 = 'Les frais gouvernementaux sont affichés séparément, au coût'

describe('translationCoverage', () => {
  it('always treats the default locale as indexable', () => {
    const r = translationCoverage('en', 'pricing', wrap('pricing', { a: LONG_EN }), wrap('pricing', { a: LONG_EN }))
    expect(r.indexable).toBe(true)
    expect(r.ratio).toBe(1)
  })

  it('marks a fully translated section indexable', () => {
    const r = translationCoverage(
      'fr',
      'pricing',
      wrap('pricing', { a: LONG_FR, b: LONG_FR_2 }),
      wrap('pricing', { a: LONG_EN, b: LONG_EN_2 }),
    )
    expect(r.untranslated).toBe(0)
    expect(r.indexable).toBe(true)
  })

  it('marks a wholly untranslated section NOT indexable', () => {
    // The case this exists for: English served under a foreign lang tag with a
    // foreign canonical is a duplicate, and there would be 14 of them per page.
    const r = translationCoverage(
      'ja',
      'pricing',
      wrap('pricing', { a: LONG_EN, b: LONG_EN_2 }),
      wrap('pricing', { a: LONG_EN, b: LONG_EN_2 }),
    )
    expect(r.ratio).toBe(0)
    expect(r.indexable).toBe(false)
  })

  it('tolerates the strings a real translation legitimately shares with English', () => {
    // Brand names, official visa names that must NOT be translated, form codes.
    // Demanding 100% would permanently noindex correctly localized pages.
    const r = translationCoverage(
      'fr',
      'pricing',
      wrap('pricing', { a: LONG_FR, b: LONG_FR_2, c: LONG_EN, d: LONG_FR }),
      wrap('pricing', { a: LONG_EN, b: LONG_EN_2, c: LONG_EN, d: LONG_EN_2 }),
    )
    expect(r.untranslated).toBe(1)
    expect(r.ratio).toBeCloseTo(0.75)
    expect(r.indexable).toBe(true)
  })

  it('ignores short strings, which match across languages for innocent reasons', () => {
    // "VisaAI", "OK", "PDF", "IMM 5257" are identical in every language and are
    // not evidence of anything.
    const r = translationCoverage(
      'fr',
      'pricing',
      wrap('pricing', { short: 'VisaAI', code: 'IMM 5257', real: LONG_FR }),
      wrap('pricing', { short: 'VisaAI', code: 'IMM 5257', real: LONG_EN }),
    )
    expect(r.compared).toBe(1)
    expect(r.indexable).toBe(true)
  })

  it('walks nested message objects', () => {
    const r = translationCoverage(
      'fr',
      'pricing',
      { pricing: { nested: { a: LONG_FR } } },
      { pricing: { nested: { a: LONG_EN } } },
    )
    expect(r.compared).toBe(1)
    expect(r.untranslated).toBe(0)
  })

  it('stays indexable when there is nothing comparable', () => {
    // This check must never be the reason a page disappears on a technicality.
    expect(translationCoverage('fr', 'missing', {}, {}).indexable).toBe(true)
    expect(translationCoverage('fr', 'pricing', wrap('pricing', {}), wrap('pricing', {})).indexable).toBe(true)
  })

  it('is scoped per section, so one untranslated area cannot noindex another', () => {
    const localeMsgs = { pricing: { a: LONG_FR }, admin: { a: LONG_EN } }
    const enMsgs = { pricing: { a: LONG_EN }, admin: { a: LONG_EN } }
    expect(translationCoverage('fr', 'pricing', localeMsgs, enMsgs).indexable).toBe(true)
    expect(translationCoverage('fr', 'admin', localeMsgs, enMsgs).indexable).toBe(false)
  })
})

describe('robotsForCoverage', () => {
  it('returns undefined for an indexable variant, so it inherits', () => {
    expect(robotsForCoverage({ locale: 'fr', compared: 2, untranslated: 0, ratio: 1, indexable: true })).toBeUndefined()
  })

  it('noindexes but keeps follow, so the crawler walks on to translated pages', () => {
    expect(robotsForCoverage({ locale: 'ja', compared: 2, untranslated: 2, ratio: 0, indexable: false })).toEqual({
      index: false,
      follow: true,
    })
  })
})

describe('against the real message files', () => {
  it('finds the French pricing page translated', () => {
    // Translated in this branch. If this fails, a regression has reverted it.
    const r = translationCoverage('fr', 'pricing', fr, en)
    expect(r.compared).toBeGreaterThan(5)
    expect(r.indexable).toBe(true)
  })

  it('reports the Japanese pricing page honestly, whatever its state', () => {
    // Not asserting a direction: this documents that the check RUNS against
    // real data and produces a coherent result. Japanese pricing copy was not
    // translated in this branch, so today it is expected to be noindex — and
    // the day someone translates it, this page starts being indexed with no
    // other change.
    const r = translationCoverage('ja', 'pricing', ja, en)
    expect(r.compared).toBeGreaterThan(0)
    expect(r.indexable).toBe(r.ratio >= INDEXABLE_TRANSLATION_RATIO)
  })
})
