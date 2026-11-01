/**
 * "Last verified" on a public visa page.
 *
 * This is the single most load-bearing trust signal on these pages, so it is a
 * component rather than an inline date: every surface that shows a verification
 * date must show the same thing, and must degrade the same way when there
 * isn't one.
 *
 * A null date renders "not yet verified" rather than today's date or nothing at
 * all. Rendering nothing would let a stale page look as current as a fresh one;
 * rendering today's date would be a lie. The sitemap's `lastmod` has the mirror
 * problem — it used `new Date()` on every build, which resets freshness on all
 * 90 URLs whenever anyone deploys, and is why that file now reads real dates.
 */
export function VerifiedStamp({
  verifiedAt,
  className = '',
}: {
  verifiedAt: string | null
  className?: string
}) {
  if (!verifiedAt) {
    return (
      <p className={`text-[13px] text-midtone-gray ${className}`}>
        Not yet verified against the official source.
      </p>
    )
  }
  const date = verifiedAt.slice(0, 10)
  return (
    <p className={`text-[13px] text-midtone-gray ${className}`}>
      Last verified against the official source on{' '}
      {/* A machine-readable date, so an answer engine can state the age of the claim. */}
      <time dateTime={date}>{date}</time>.
    </p>
  )
}
