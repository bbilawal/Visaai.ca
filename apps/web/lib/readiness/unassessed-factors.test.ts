import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * FAKE-003 regression cover.
 *
 * The `*_pct` columns on `vri_scores` are `int not null`, so a factor that was
 * never assessed still has to store a number. It stores 0, and the readiness
 * page rendered that as "0% · Weak" — a failure the applicant never actually
 * had. That is the same defect as the original FAKE-002 bug inverted: 100
 * claimed a pass that never happened, 0 claims a failure that never happened.
 * Neither number is true; only `unassessed_factors` is.
 *
 * This is asserted against the component SOURCE rather than by rendering it.
 * The component is a server-data-driven client component whose props come from
 * a Supabase query; standing that up in jsdom would test the harness more than
 * the behaviour. What must not regress is narrow and structural:
 *
 *   1. the unassessed set is read from the row,
 *   2. it is tolerant of the column being absent (the migration is not applied
 *      in production yet — see BLK-1),
 *   3. a flagged factor renders the "not assessed" string instead of a
 *      percentage and a score band,
 *   4. the accessible name matches what is shown.
 *
 * If someone deletes the branch, every one of these fails.
 */
const CLIENT = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'app',
    '[locale]',
    '(dashboard)',
    'readiness',
    '[applicationId]',
    'readiness-client.tsx',
  ),
  'utf8',
)

describe('FAKE-003 — an unassessed factor is never shown as a percentage', () => {
  it('reads the unassessed set from the score row', () => {
    expect(CLIENT).toMatch(/unassessed\s*=\s*new Set<string>\(/)
    expect(CLIENT).toContain('score?.unassessed_factors')
  })

  it('tolerates the column being absent, since production has not run the migration', () => {
    // `?? []` is what keeps this deployable ahead of the migration: no array
    // means nothing is flagged, and every factor renders as it did before.
    expect(CLIENT).toMatch(/score\?\.unassessed_factors\s*\?\?\s*\[\]/)
  })

  it('branches on the flag before rendering a number', () => {
    expect(CLIENT).toMatch(/const notAssessed = unassessed\.has\(/)
    expect(CLIENT).toMatch(/if \(notAssessed\)/)
  })

  it('renders the translated "not assessed" label instead of a percentage band', () => {
    const branch = CLIENT.slice(CLIENT.indexOf('if (notAssessed)'))
    const untilReturn = branch.slice(0, branch.indexOf('return (\n                  <div key={key}>'))
    expect(untilReturn).toContain("t('factorNotAssessed')")
    // The percentage + band pairing must NOT appear inside the branch.
    expect(untilReturn).not.toMatch(/\{pct\}% · \{scoreBand/)
  })

  it('gives the progress bar an accessible name that matches what is displayed', () => {
    // A bar labelled "0 percent, Weak" while the text says "Not assessed"
    // would tell a screen-reader user the opposite of the truth.
    const branch = CLIENT.slice(CLIENT.indexOf('if (notAssessed)'))
    expect(branch.slice(0, 900)).toMatch(
      /aria-label=\{`\$\{FACTOR_LABELS\[key\]\}: \$\{t\('factorNotAssessed'\)\}`\}/,
    )
  })
})

describe('FAKE-003 — the label exists in every locale', () => {
  it('defines readiness.factorNotAssessed in all shipped catalogues', () => {
    const dir = join(__dirname, '..', '..', 'messages')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const files = (require('node:fs') as typeof import('node:fs'))
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(15)
    const missing = files.filter((f) => {
      const cat = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        readiness?: Record<string, string>
      }
      return !cat.readiness?.factorNotAssessed
    })
    // A missing key renders as the key path — the exact class of defect
    // WEB-007 was about.
    expect(missing, `missing in: ${missing.join(', ')}`).toEqual([])
  })
})
