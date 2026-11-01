/**
 * How a visa page divides its requirements into rendered sections.
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE FILTER
 *
 * The visa page used to filter inline: `officially_required` split by kind,
 * plus `kind === 'recommended'`. Anything that was NEITHER — not officially
 * required, not a VisaAI suggestion — matched no filter and rendered nowhere.
 *
 * That is not a rare corner. It is a category the extractions deliberately
 * create, and it had grown to 31 entries across 18 of 34 published pages before
 * anyone noticed, because a dropped row looks exactly like a row that was never
 * extracted. The worst case was the Dutch orientation year, whose eligibility is
 * four ALTERNATIVE routes: each is officially_required = false so the page does
 * not imply an applicant needs all four, and the result was a page that never
 * said who qualifies.
 *
 * Pulling the split into one exported function makes the gap testable: the
 * exhaustiveness test asserts every requirement lands in exactly one bucket, so
 * a future kind or flag combination fails a test instead of disappearing from
 * a live page.
 */

export type Bucket =
  | 'condition'
  | 'form'
  | 'evidence'
  | 'step'
  | 'fee'
  | 'suggestion'
  | 'alsoStated'

export interface Bucketable {
  kind: string
  officially_required: boolean
}

/**
 * Which section a requirement renders in. Total by construction: every input
 * returns a bucket, and `alsoStated` is the catch-all rather than a silent drop.
 */
export function bucketOf(r: Bucketable): Bucket {
  // VisaAI's own advice, never mixed with government rules — this is why
  // `recommended` is a distinct kind rather than a boolean.
  if (r.kind === 'recommended') return 'suggestion'

  if (r.officially_required) {
    switch (r.kind) {
      case 'form':
        return 'form'
      case 'evidence':
        return 'evidence'
      case 'step':
        return 'step'
      case 'fee':
        return 'fee'
      case 'condition':
        return 'condition'
      default:
        // An officially-required row of an unexpected kind. Showing it under
        // the authority's own heading is the safe failure: a requirement the
        // government states must never vanish because a kind was added without
        // a section.
        return 'alsoStated'
    }
  }

  // Stated by the authority, but not something you must do: alternative routes,
  // exemptions, rights, optional faster paths, warnings.
  return 'alsoStated'
}
