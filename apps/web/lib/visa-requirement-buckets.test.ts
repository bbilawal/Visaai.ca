import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bucketOf, type Bucket } from './visa-requirement-buckets'

/**
 * Every requirement must render somewhere.
 *
 * The visa page filtered inline — officially_required split by kind, plus
 * `recommended` — and anything that matched neither rendered nowhere. 31
 * requirements across 18 of 34 published pages were being dropped silently,
 * including all four eligibility routes of the Dutch orientation year, whose
 * page therefore never said who qualifies.
 *
 * A dropped row is invisible: it looks identical to a row that was never
 * extracted. So the guarantee needs a test rather than a careful reader.
 */

const DIR = join(__dirname, '../../../data/requirements')

interface Req {
  requirement_code: string
  kind: string
  officially_required: boolean
}

function everyRequirement(): Array<{ file: string; req: Req }> {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as { requirements?: Req[] }
      return (doc.requirements ?? []).map((req) => ({ file, req }))
    })
}

describe('bucketOf', () => {
  it('finds extraction files to check', () => {
    // Guards the guard: a wrong path makes every assertion below vacuous.
    expect(everyRequirement().length).toBeGreaterThan(100)
  })

  it('places every requirement in the real extraction files into a bucket', () => {
    const buckets = new Set<Bucket>([
      'condition', 'form', 'evidence', 'step', 'fee', 'suggestion', 'alsoStated',
    ])
    const orphans: string[] = []
    for (const { file, req } of everyRequirement()) {
      if (!buckets.has(bucketOf(req))) orphans.push(`${file}: ${req.requirement_code}`)
    }
    expect(orphans).toEqual([])
  })

  it('routes authority-stated non-requirements to alsoStated, not into the void', () => {
    // THE REGRESSION. Each of these is officially_required = false on purpose,
    // and each vanished from its live page.
    //
    // A Dutch orientation-year route: one of four ALTERNATIVES, marked
    // not-required individually so the page cannot imply all four are needed.
    expect(bucketOf({ kind: 'condition', officially_required: false })).toBe('alsoStated')
    // An exemption that switches the hardest requirement off entirely.
    expect(bucketOf({ kind: 'condition', officially_required: false })).not.toBe('condition')
  })

  it('keeps VisaAI suggestions out of every government list', () => {
    // `recommended` is a separate kind precisely so a template cannot render
    // VisaAI's advice where a reader is looking for a government rule.
    expect(bucketOf({ kind: 'recommended', officially_required: false })).toBe('suggestion')
  })

  it('never hides an officially-required row behind an unrecognised kind', () => {
    // If a new kind is added without a section, the safe failure is showing it
    // under the authority's heading — not dropping a government requirement.
    expect(bucketOf({ kind: 'some_future_kind', officially_required: true })).toBe('alsoStated')
  })

  it('sorts the known kinds into their own sections', () => {
    expect(bucketOf({ kind: 'condition', officially_required: true })).toBe('condition')
    expect(bucketOf({ kind: 'form', officially_required: true })).toBe('form')
    expect(bucketOf({ kind: 'evidence', officially_required: true })).toBe('evidence')
    expect(bucketOf({ kind: 'step', officially_required: true })).toBe('step')
    expect(bucketOf({ kind: 'fee', officially_required: true })).toBe('fee')
  })

  it('reports how many real requirements rely on the alsoStated bucket', () => {
    // Not an assertion about a number — a canary. If this ever reads 0, either
    // the extractions stopped using the category or the filter silently changed.
    const n = everyRequirement().filter(({ req }) => bucketOf(req) === 'alsoStated').length
    expect(n).toBeGreaterThan(0)
  })
})
