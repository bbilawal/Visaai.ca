/**
 * PR profile dependants: the reviewed dependant (the signed value of its
 * dependant_open / dependant_save steps) against the saved cards under
 * "Saved dependants". Pure, read-only; outside content.ts because a content
 * script may not export (see row-match.ts).
 *
 * Exact, field by field — never word overlap: "ALI KHAN" and "ALI REZA KHAN"
 * born the same day are two different children (review S2, PR #285).
 */

/** The reviewed dependant, from "Name: …; Family name: …; Date of birth: …; Relationship: …; Accompanying: …". */
export interface ReviewedDependant {
  name: string
  family: string
  dob: string
  relationship: string
  accompanying: string
}

/** One saved card's h5 → p pairs, keys and values normalised. */
export type DependantCard = Record<string, string>

const squash = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim()
/** Case and spacing do not count. */
export const normText = (t: string | null | undefined) => squash(t).toLowerCase()
/** 2015-03-04, 2015/03/04 and 2015.03.04 are one date. */
export const normDate = (t: string | null | undefined) => normText(t).replace(/\s*[-./]\s*/g, '/')

const FIELDS: ReadonlyArray<[keyof ReviewedDependant, string]> = [
  ['name', 'name'],
  ['family', 'family name'],
  ['dob', 'date of birth'],
  ['relationship', 'relationship'],
  ['accompanying', 'accompanying'],
]

export function parseReviewedDependant(value: string): ReviewedDependant | null {
  const parts = new Map<string, string>()
  for (const part of value.split(';')) {
    const m = /^\s*([^:]+):\s*(.*?)\s*$/.exec(part)
    if (!m) return null
    parts.set(normText(m[1]), squash(m[2]))
  }
  const out: Partial<ReviewedDependant> = {}
  for (const [k, label] of FIELDS) {
    const v = parts.get(label)
    if (!v) return null
    out[k] = v
  }
  return out as ReviewedDependant
}

/** Each pra-dependant-card as { heading → value } (h5 and the element after it). READ-ONLY. */
export function readDependantCards(doc: Document = document): DependantCard[] {
  return Array.from(doc.querySelectorAll('pra-dependant-card')).map((card) => {
    const out: DependantCard = {}
    for (const h of Array.from(card.querySelectorAll('h5'))) {
      const key = normText(h.textContent)
      const value = h.nextElementSibling
      if (key && value && value.tagName !== 'H5' && !(key in out)) out[key] = squash(value.textContent)
    }
    return out
  })
}

const sameName = (c: DependantCard, d: ReviewedDependant) => normText(c['name']) === normText(d.name)
const sameDob = (c: DependantCard, d: ReviewedDependant) => !!c['date of birth'] && normDate(c['date of birth']) === normDate(d.dob)

/** The card is this dependant: name, date of birth, relationship and accompanying all as reviewed. */
export function cardIsDependant(c: DependantCard, d: ReviewedDependant): boolean {
  return (
    sameName(c, d) &&
    sameDob(c, d) &&
    normText(c['relationship']) === normText(d.relationship) &&
    normText(c['accompanying']) === normText(d.accompanying)
  )
}

export type CardVerdict =
  /** No card is this dependant or could be: add it. */
  | 'absent'
  /** A card is exactly this dependant: nothing to add. */
  | 'present'
  /** A card has this name and date of birth but another relationship or accompanying answer. */
  | 'differs'
  /**
   * A card has this date of birth under another name (a twin, a different
   * spelling, or IRCC showing the name in another order): not a guess either way.
   */
  | 'conflict'

export function dependantCardVerdict(cards: DependantCard[], d: ReviewedDependant): CardVerdict {
  if (cards.some((c) => cardIsDependant(c, d))) return 'present'
  if (cards.some((c) => sameName(c, d) && sameDob(c, d))) return 'differs'
  return cards.some((c) => sameDob(c, d)) ? 'conflict' : 'absent'
}
