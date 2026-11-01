import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STAGE_ORDER } from '@visaai/types'
import en from '@/messages/en.json'

/**
 * The nav's step numbers and the progress bar's percentages are computed from
 * two different lists — STAGES here and STAGE_ORDER in @visaai/types. If they
 * drift, the nav shows "4 Readiness" while `computeProgress` calls prefill the
 * fourth stage, and the two disagree about which stage the applicant is on.
 *
 * The order is read out of the source rather than imported because STAGES is a
 * module-private const in a 'use client' component.
 */
const source = readFileSync(join(__dirname, 'stage-nav.tsx'), 'utf8')
const navSlugs = [...source.matchAll(/\{ slug: '([a-z]+)', labelKey: '([a-zA-Z]+)' \}/g)].map(
  ([, slug, labelKey]) => ({ slug, labelKey }),
)

describe('stage nav', () => {
  it('lists exactly the stages in STAGE_ORDER, in the same order', () => {
    expect(navSlugs.map(s => s.slug)).toEqual(STAGE_ORDER)
  })

  it('puts the forms stage 4th and readiness 5th', () => {
    expect(navSlugs[3].slug).toBe('prefill')
    expect(navSlugs[4].slug).toBe('readiness')
  })

  it('every label key resolves in the stages namespace', () => {
    for (const { labelKey } of navSlugs) {
      expect(en.stages, `stages.${labelKey}`).toHaveProperty(labelKey)
    }
  })

  it('the forms stage is not labelled with the internal "Prefill" wording', () => {
    expect(en.stages.prefill).toBe('Forms')
  })
})
