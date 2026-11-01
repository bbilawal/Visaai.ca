'use client'

import { useEffect, useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { ExternalLinkIcon } from '@/components/ui/icons'
import { getOfficialSearchUrl } from '@/lib/official-forms'
import { DownloadButton } from '@/components/forms/download-button'



type DocumentTemplateKind =
  | 'checklist'
  | 'guide'
  | 'declaration'
  | 'specification'
  | 'instructions'

type DeliveredDocumentTemplate = {
  templateCode: string
  templateName: string
  kind: DocumentTemplateKind
  documentCode: string | null
  versionLabel: string | null
  downloadPath: string | null
  officialUrl: string
  source: 'cache' | 'official-link'
  freshness: 'fresh' | 'aging' | 'unverified'
  verifiedAt: string | null
}

/**
 * "Checked <date>" — reassurance, not a warning: a date, not a caveat telling
 * the applicant to go and verify it themselves.
 *
 * No date, no line: the "checked daily" fallback and the "checked today"
 * same-day wording are both gone, so this either states a real verification
 * date or renders nothing at all.
 */
function checkedLabel(verifiedAt: string | null): string | null {
  if (!verifiedAt) return null
  const date = new Date(verifiedAt)
  if (Number.isNaN(date.getTime())) return null
  return `checked ${date.toLocaleDateString()}`
}

/**
 * Plain-English labels. The API's `kind` is the authority's own category, and
 * "specification" or "instructions" means nothing to an applicant staring at a
 * list of things to gather.
 */
const KIND_LABEL: Record<DocumentTemplateKind, string> = {
  checklist: 'Document checklist',
  guide: 'Official guidance',
  declaration: 'Form to complete',
  specification: 'Official requirements',
  instructions: 'Filing instructions',
}

interface OfficialDocumentsProps {
  applicationId: string
  country?: string | null
  /**
   * Gates the whole section, fetch included — see OfficialForms. Defaults true
   * so any other caller behaves exactly as before.
   */
  enabled?: boolean
}

/**
 * The official DOCUMENT artifacts for this application — checklists, photo
 * specifications, declaration templates and route guidance — with a one-click
 * download when we hold a cached copy, falling back to the authority's own page
 * when we don't.
 *
 * Additive, exactly like OfficialForms above it: it must never block or break
 * the upload flow rendered below. A failed load is SHOWN rather than swallowed
 * — rendering null on error is the pattern that once hid a production billing
 * outage — and only "nothing to show" or "still loading" render nothing.
 */
export function OfficialDocuments({ applicationId, country, enabled = true }: OfficialDocumentsProps) {
  const [templates, setTemplates] = useState<DeliveredDocumentTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: { session } } = await getSession()
        if (!session || cancelled) return

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/document-templates/${applicationId}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        )
        if (cancelled) return

        if (!res.ok) {
          const requestId = res.headers.get('x-request-id')
          setError(`${res.status}${requestId ? ` · ${requestId}` : ''}`)
          return
        }

        // Guard the shape before trusting it. A 200 whose body is not an array
        // must not reach `.map(...)`: without a local error boundary that throw
        // propagates to the route segment and blanks the WHOLE documents page,
        // including the upload flow — exactly what "additive" forbids.
        const body: unknown = await res.json()
        if (!Array.isArray(body)) {
          const requestId = res.headers.get('x-request-id')
          setError(`${res.status} · unexpected response${requestId ? ` · ${requestId}` : ''}`)
          return
        }
        if (!cancelled) setTemplates(body as DeliveredDocumentTemplate[])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'network error')
      }
    }

    if (enabled) void load()
    return () => { cancelled = true }
  }, [applicationId, enabled])

  // Not unlocked yet: render nothing and spend no request on it.
  if (!enabled) return null

  if (error) {
    return (
      <Card className="mb-4" variant="tight">
        <p className="text-[13px] font-medium text-midtone-gray uppercase tracking-[0.5px] mb-2">
          Official document checklists &amp; guides
        </p>
        <p className="text-[13px] text-callout-red mb-2">
          Couldn&apos;t load your official documents ({error}). You can still get them from the government site.
        </p>
        <a
          href={getOfficialSearchUrl({ country })}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1d4ed8] hover:text-[#1e40af] underline underline-offset-2"
        >
          <ExternalLinkIcon size={12} />
          Open the official page
        </a>
      </Card>
    )
  }

  if (!templates || templates.length === 0) return null

  return (
    <Card className="mb-4" variant="tight">
      <p className="text-[13px] font-medium text-midtone-gray uppercase tracking-[0.5px] mb-2">
        Official document checklists &amp; guides
      </p>
      <p className="text-[13px] text-rich-black mb-3">
        The current checklists, requirements and templates for the documents you need to gather, straight from the government site. You do not need to download them yourself.
      </p>

      <div className="flex flex-col gap-3">
        {templates.map(tpl => (
          <div
            key={`${tpl.templateCode}-${tpl.documentCode ?? 'all'}`}
            className="flex items-center justify-between gap-4 rounded-[10px] border border-subtle-ash px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-deep-black">
                {tpl.templateName}
              </p>
              <p className="text-[11px] text-midtone-gray">
                {KIND_LABEL[tpl.kind] ?? 'Official document'}
                {' · '}
                {tpl.templateCode}
                {tpl.versionLabel ? ` · version ${tpl.versionLabel}` : ''}
                {checkedLabel(tpl.verifiedAt) && ` · ${checkedLabel(tpl.verifiedAt)}`}
              </p>
            </div>

            {tpl.downloadPath ? (
              <DownloadButton
                path={tpl.downloadPath}
                filename={`${tpl.templateCode.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`}
                fallbackUrl={tpl.officialUrl}
              />
            ) : (
              <a
                href={tpl.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1d4ed8] hover:text-[#1e40af] underline underline-offset-2 shrink-0"
              >
                <ExternalLinkIcon size={12} />
                Open official page
              </a>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
