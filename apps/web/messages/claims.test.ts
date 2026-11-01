import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the claims VisaAI makes to users.
 *
 * The product cannot decide a visa, cannot approve one, and cannot verify that
 * a consultant is licensed — `consultant_profiles.license_verified` exists
 * (supabase/migrations/20260626000000_consultant_marketplace.sql:40-43) and is
 * never written `true` by any code path in the repository. Copy that says
 * otherwise is not a wording problem, it is a false statement to a person
 * deciding whether to pay.
 *
 * The specific string this replaces, live on /pricing in all 15 locales:
 *
 *   "Every application is checked and approved by a licensed immigration
 *    consultant before you submit."
 *
 * Three untruths in one sentence: consultant review is a paid Expert-plan
 * feature rather than something every application gets; nobody "approves"
 * anything, because approval is a government act; and "licensed" was never
 * verified.
 *
 * These assertions run over every locale file, because a claim removed in
 * English and left standing in Spanish is still a claim.
 */

const MESSAGES_DIR = __dirname

function localeFiles(): Array<[string, string]> {
  return readdirSync(MESSAGES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f, readFileSync(join(MESSAGES_DIR, f), 'utf8')])
}

/**
 * Phrases that assert VisaAI or a consultant approves, guarantees or decides
 * an application. Deliberately narrow: they must catch the real claim without
 * flagging honest copy that uses the same words to DENY the claim, e.g.
 * "no one can approve or guarantee a government decision".
 */
const FORBIDDEN: Array<[RegExp, string]> = [
  [
    /every application is (checked and )?approved/i,
    'claims every application is approved — approval is a government act, and consultant review is a paid-plan feature',
  ],
  [
    /guarantee(d|s)? (your |the )?(visa|approval|application|outcome|success)/i,
    'guarantees a government outcome',
  ],
  [
    /\bapproval is guaranteed\b/i,
    'guarantees approval',
  ],
  [
    /we (will )?(approve|decide) your (visa|application)/i,
    'claims VisaAI approves or decides an application',
  ],
  [
    /\b100% (approval|success)\b/i,
    'claims a 100% approval or success rate',
  ],
  [
    /most likely to be approved/i,
    'predicts a government decision — VisaAI can neither predict nor influence one, ' +
      'and the honest claim is about FIT to the applicant\u2019s answers',
  ],
  [
    /\bapproval (odds|chance|probability|likelihood)\b/i,
    'presents a score as a probability of approval',
  ],
  [
    /auto-?submit/i,
    'claims the product submits to a government portal. The extension cannot: ' +
      'safety-guards.ts blocks every submit control and an execution-path invariant ' +
      'enforces the absence of any submit, click or navigation call. A paying user ' +
      'who believes this may never submit their application at all',
  ],
]

describe('user-facing claims', () => {
  it('reads every locale file', () => {
    // If this drops the assertions below pass vacuously.
    expect(localeFiles().length).toBeGreaterThanOrEqual(15)
  })

  it.each(localeFiles())('%s makes no approval or guarantee claim', (_name, raw) => {
    for (const [pattern, why] of FORBIDDEN) {
      const match = raw.match(pattern)
      expect(
        match,
        `Found copy that ${why}: ${JSON.stringify(match?.[0])}`,
      ).toBeNull()
    }
  })

  it.each(localeFiles())(
    '%s does not assert consultant licensure as verified fact',
    (_name, raw) => {
      // `license_verified` is never set true anywhere in the codebase, so
      // "licensed consultant" stated as fact is unverifiable. The honest forms
      // are "immigration consultant", or an explicit statement about what
      // verification VisaAI actually performs.
      const match = raw.match(/licen[cs]ed (immigration )?consultant/i)
      expect(
        match,
        'Copy asserts a consultant is licensed, but consultant_profiles.license_verified ' +
          'is never written true by any code path — the claim cannot be substantiated. ' +
          `Found: ${JSON.stringify(match?.[0])}`,
      ).toBeNull()
    },
  )

  it.each(localeFiles())(
    '%s does not present optional evidence as improving approval odds',
    (_name, raw) => {
      const hints = [...raw.matchAll(/"strengthenHint"\s*:\s*"([^"]+)"/g)].map(
        (match) => match[1],
      )
      expect(hints.length).toBeGreaterThanOrEqual(2)
      // These were the exact outcome-prediction terms left in translations
      // after English was corrected. Keep this multilingual test alongside the
      // generic English claim checks so a locale cannot silently regress.
      const outcomeTerms =
        /approval|aprobaci[oó]n|approbation|Genehmigung|approvazione|goedkeur|onay|منظور|موافقة|स्वीकृति|承認|通过率|승인/i
      for (const hint of hints) expect(hint).not.toMatch(outcomeTerms)
    },
  )
})
