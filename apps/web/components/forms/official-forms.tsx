'use client'

import { useEffect, useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { ExternalLinkIcon } from '@/components/ui/icons'
import { getOfficialSearchUrl } from '@/lib/official-forms'
import { DownloadButton } from './download-button'



type DeliveredForm = {
  formCode: string
  formName: string
  capability: 'acroform' | 'xfa' | 'unknown'
  versionLabel: string | null
  downloadPath: string | null
  officialUrl: string | null
  source: 'cache' | 'official-link'
  prefillable: boolean
  freshness: 'fresh' | 'aging' | 'unverified'
  verifiedAt: string | null
}

/**
 * "Checked <date>" — reassurance, not a warning.
 *
 * The earlier copy told the applicant we "couldn't re-check this recently" and
 * pushed them to the government site to verify it themselves, which is exactly
 * the work this feature exists to remove. The honest line is a date: we looked,
 * here is when.
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

interface OfficialFormsProps {
  applicationId: string
  country?: string | null
  /**
   * Gates the whole section, fetch included. The documents page keeps this
   * false until the applicant has uploaded everything and pressed Generate,
   * so the page leads with what they must DO rather than with reference
   * material. Defaults true: any other caller behaves exactly as before.
   */
  enabled?: boolean
}

/**
 * Lists the official government forms this application needs, with a
 * one-click download when we have a cached copy (falls back to the official
 * government page when we don't — that fallback is today's behaviour, not an
 * error, per Task 8's design).
 *
 * This section is ADDITIVE: it must never block or break the upload flow
 * rendered below it in documents-client.tsx. A failed load is still SHOWN,
 * not swallowed — an earlier draft rendered null on error, which is exactly
 * the pattern that hid a production billing outage. Only "no forms" or
 * "still loading" render nothing.
 */
export function OfficialForms({ applicationId, country, enabled = true }: OfficialFormsProps) {
  const [forms, setForms] = useState<DeliveredForm[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { data: { session } } = await getSession()
        if (!session || cancelled) return

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/forms/${applicationId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (cancelled) return

        if (!res.ok) {
          // Surface the status and request id rather than swallowing them —
          // a bare `catch {}` here is what hid the billing outage.
          const requestId = res.headers.get('x-request-id')
          setError(`${res.status}${requestId ? ` · ${requestId}` : ''}`)
          return
        }

        // Guard the shape before trusting it: a 200 whose body is not an array
        // must not reach `forms.map(...)` unchecked. Without this check, a
        // malformed body throws during render with no local error boundary,
        // which propagates to the route-segment boundary and blanks the
        // WHOLE documents page — including the upload flow below this
        // section. That is exactly what "additive" forbids.
        const body: unknown = await res.json()
        if (!Array.isArray(body)) {
          const requestId = res.headers.get('x-request-id')
          setError(`${res.status} · unexpected response${requestId ? ` · ${requestId}` : ''}`)
          return
        }
        if (!cancelled) setForms(body as DeliveredForm[])
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
          Official forms
        </p>
        <p className="text-[13px] text-callout-red mb-2">
          Couldn&apos;t load your official forms ({error}). You can still get them from the government site.
        </p>
        <a
          href={getOfficialSearchUrl({ country })}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1d4ed8] hover:text-[#1e40af] underline underline-offset-2"
        >
          <ExternalLinkIcon size={12} />
          Open the official forms page
        </a>
      </Card>
    )
  }

  // Still loading, or this program genuinely needs no forms: render nothing.
  // The section is additive — it must never block the upload flow below it.
  if (!forms || forms.length === 0) return null

  return (
    <Card className="mb-4" variant="tight">
      <p className="text-[13px] font-medium text-midtone-gray uppercase tracking-[0.5px] mb-2">
        Official forms
      </p>
      <p className="text-[13px] text-rich-black mb-3">
        The current blank forms for your application, straight from the government site. You do not need to download them yourself.
      </p>

      <div className="flex flex-col gap-3">
        {forms.map(form => (
          <div
            key={form.formCode}
            className="flex items-center justify-between gap-4 rounded-[10px] border border-subtle-ash px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-deep-black">
                {form.formCode} — {form.formName}
              </p>
              <p className="text-[11px] text-midtone-gray">
                {form.versionLabel ? `Version ${form.versionLabel}` : 'Current version'}
                {checkedLabel(form.verifiedAt) && ` · ${checkedLabel(form.verifiedAt)}`}
                {form.capability === 'xfa' && ' · opens in Adobe Acrobat Reader, not your browser'}
              </p>
            </div>

            {form.downloadPath ? (
              <DownloadButton
                path={form.downloadPath}
                filename={`${form.formCode.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`}
                fallbackUrl={form.officialUrl}
              />
            ) : (
              <a
                href={form.officialUrl ?? '#'}
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
