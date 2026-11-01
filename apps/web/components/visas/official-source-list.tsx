import type { VisaSource } from '@/lib/visa-registry'

/**
 * The official-source block that appears on every public visa page.
 *
 * Sources are rendered as ordinary crawlable <a href> links to the
 * government's own canonical URL, with `rel="nofollow"` deliberately ABSENT:
 * these are genuine citations to authoritative pages, which is exactly the
 * link a search engine should see and follow.
 *
 * They open in the same tab. A visa applicant checking a government page is
 * not doing something incidental to the task — it IS the task — and hijacking
 * their window management to keep them on VisaAI would be a dark pattern on a
 * page whose entire claim is "go and verify this yourself".
 */
export function OfficialSourceList({
  sources,
  roleLabels,
  extra = [],
}: {
  sources: VisaSource[]
  roleLabels: Record<string, string>
  extra?: VisaSource[]
}) {
  // De-duplicate by URL: a country index page and a visa landing page are
  // frequently the same URL, and listing it twice reads as sloppy sourcing.
  const seen = new Set<string>()
  const all = [...extra, ...sources].filter((s) => {
    if (seen.has(s.canonical_url)) return false
    seen.add(s.canonical_url)
    return true
  })

  if (all.length === 0) {
    return (
      <p className="text-[13px] text-midtone-gray">
        No official source is recorded for this entry yet.
      </p>
    )
  }

  return (
    <ul className="grid gap-2">
      {all.map((s) => (
        <li key={s.canonical_url} className="text-[14px]">
          <a
            href={s.canonical_url}
            className="underline"
            // Standard hardening for an outbound link; NOT nofollow — this is
            // a citation we want followed.
            rel="noopener"
          >
            {s.title ?? roleLabels[s.role] ?? s.role}
          </a>
          <span className="text-midtone-gray">
            {' — '}
            {roleLabels[s.role] ?? s.role}
            {s.authority ? `, ${s.authority}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}
