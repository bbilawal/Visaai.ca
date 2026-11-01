'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ensureSession } from '@/lib/supabase/client'

/**
 * Lets an applicant name the visa they are applying for.
 *
 * WHY THIS COMPONENT EXISTS
 *
 * VisaAI holds 293 requirements read from government pages, each quoted and
 * bound to the source version it came from. Until now none of them could reach
 * an applicant, for a mundane reason: nothing recorded WHICH visa an
 * application was for, so there was no key to look a requirement set up by. The
 * checklist came from a one-row legacy table or, far more often, a model's
 * recollection.
 *
 * Choosing here writes `applications.visa_type_id`, which is what switches the
 * checklist over to the sourced registry.
 *
 * WHY UNCOVERED ROUTES ARE STILL LISTED
 *
 * Every visa type the country publishes appears, including the ones VisaAI has
 * no requirements for. Hiding those would tell someone applying for an
 * Australian student visa that we do not handle their case — when the truth is
 * that a WAF blocks our source monitor. The badge says which is which, and
 * picking an uncovered route is harmless: the interview falls back to asking
 * country-specific questions, exactly as it does today.
 *
 * WHY A DROPDOWN AND NOT A LIST
 *
 * It used to render every route as a card in the intake sidebar. Japan
 * publishes 13 and Türkiye 15, so on those destinations the control was taller
 * than the conversation it sat beside — an applicant scrolled past the whole
 * visa system to reach the question they were being asked. A route is chosen
 * once, usually early; a collapsed control is the honest weight for it.
 */

/** Whether THIS applicant may use a route, as the API judged it from their profile. */
export interface RouteEligibility {
  status: 'eligible' | 'ineligible' | 'not_required' | 'unknown'
  /** Plain-language, safe to show. */
  reason: string
  recommendedVisaaiId?: string
  recommendedLabel?: string
}

export interface VisaTypeOption {
  id: string
  visaaiId: string
  name: string
  officialCode: string | null
  category: string | null
  dataQuality: string | null
  requirementCount: number
  /** Present only for routes a program can judge (Canada's eTA today). */
  eligibility?: RouteEligibility
}

/**
 * What to say under the selector about the chosen route's fit, or null.
 *
 * Prod 2026-10-16 (app 5d3a17a4): the eTA was accepted while nationality was
 * unknown and a Pakistani passport only surfaced later. A ruled-out route is
 * an alert naming the right one; an undecided one is a quiet note that the
 * passport decides. The route itself is never changed for the applicant.
 */
export function eligibilityNotice(
  verdict: RouteEligibility | null | undefined,
): { tone: 'alert' | 'note'; text: string } | null {
  if (!verdict || !verdict.reason) return null
  if (verdict.status === 'ineligible' || verdict.status === 'not_required') {
    const instead = verdict.recommendedLabel
      ? ` Switch to “${verdict.recommendedLabel}” above — your answers are kept.`
      : ''
    return { tone: 'alert', text: `${verdict.reason}${instead}` }
  }
  if (verdict.status === 'unknown') return { tone: 'note', text: verdict.reason }
  return null
}

/**
 * The option's display name. Appends the official code only when the name
 * does not already carry it — the registry's eTA is officially named
 * "Electronic travel authorization (eTA)" with code "eTA", and the selector
 * read "… (eTA) (eTA)" (dry run 2026-10-16).
 */
export function visaTypeOptionName(
  option: Pick<VisaTypeOption, 'name' | 'officialCode'>,
): string {
  const code = option.officialCode?.trim()
  if (!code) return option.name
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(option.name)) {
    return option.name
  }
  return `${option.name} (${code})`
}

/**
 * What to tell the applicant when the route was not saved. A 400 carrying
 * `ROUTE_INELIGIBLE` is the API refusing a route this applicant cannot use
 * (a Pakistani picking Canada's eTA) — its reason, which names the right
 * route, is the message. Anything else is the generic retry message.
 */
export function saveErrorMessage(
  status: number,
  body: unknown,
  fallback: string,
): string {
  if (status !== 400 || !body || typeof body !== 'object') return fallback
  const b = body as { code?: unknown; message?: unknown }
  if (b.code === 'ROUTE_INELIGIBLE' && typeof b.message === 'string' && b.message.trim()) {
    return b.message
  }
  return fallback
}

/** What the API answers when a route is saved. */
export interface VisaTypeSaved {
  visaTypeId: string | null
  changed: boolean
  /** False while the route still has interview questions to ask. */
  intakeComplete?: boolean
  /** The route's fit for this applicant, when a program judges it. */
  eligibility?: RouteEligibility
}

interface Props {
  applicationId: string
  /** Set when the application already names a route. */
  initialVisaTypeId?: string | null
  /** Lets the parent refresh the checklist once the route changes. */
  onChange?: (visaTypeId: string | null, saved?: VisaTypeSaved) => void
  /**
   * Changes whenever the interview may have learned something (e.g. the
   * message count). The route list — and each route's eligibility — is
   * re-read, so a route the profile has since ruled out is flagged here.
   */
  refreshKey?: string | number
}

export function VisaTypeSelector({
  applicationId,
  initialVisaTypeId = null,
  onChange,
  refreshKey,
}: Props) {
  const t = useTranslations('visaType')
  const [options, setOptions] = useState<VisaTypeOption[] | null>(null)
  const [selected, setSelected] = useState<string | null>(initialVisaTypeId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The verdict the save itself returned, until the list is next re-read.
  const [savedVerdict, setSavedVerdict] = useState<RouteEligibility | null>(null)
  const selectId = useId()

  const apiUrl = process.env.NEXT_PUBLIC_API_URL

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const session = await ensureSession()
        if (!session) return
        const res = await fetch(
          `${apiUrl}/intake/applications/${applicationId}/visa-types`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        )
        if (!res.ok) throw new Error('load failed')
        const data = (await res.json()) as VisaTypeOption[]
        if (!cancelled) {
          setOptions(data)
          setSavedVerdict(null)
        }

        // The server render reads the chosen route under the request's cookie
        // session; when that read comes back empty (an expired access token
        // is refreshed only in the browser), the control showed "Not chosen
        // yet" for a route that IS chosen (dry run 2026-10-16). Ask the API,
        // which sees the refreshed session — never overriding a choice the
        // applicant has made in the meantime.
        if (!initialVisaTypeId) {
          const appRes = await fetch(
            `${apiUrl}/intake/applications/${applicationId}`,
            { headers: { Authorization: `Bearer ${session.access_token}` } },
          )
          if (appRes.ok) {
            const app = (await appRes.json()) as { visa_type_id?: string | null }
            if (!cancelled && app?.visa_type_id) {
              setSelected((prev) => prev ?? app.visa_type_id ?? null)
            }
          }
        }
      } catch {
        // A failed list must not block the interview — the chat is the primary
        // surface and works without a chosen route. Render nothing instead.
        if (!cancelled) setOptions([])
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [apiUrl, applicationId, initialVisaTypeId, refreshKey])

  const choose = useCallback(
    async (visaTypeId: string | null) => {
      if (saving || visaTypeId === selected) return
      setSaving(true)
      setError(null)
      setSavedVerdict(null)

      // Optimistic: the list is the applicant's own click, and reverting on
      // failure is less confusing than a control that ignores them.
      const previous = selected
      setSelected(visaTypeId)
      let failure = t('errSaveFailed')

      try {
        const session = await ensureSession()
        if (!session) throw new Error('no session')
        const res = await fetch(
          `${apiUrl}/intake/applications/${applicationId}/visa-type`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ visaTypeId }),
          },
        )
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          failure = saveErrorMessage(res.status, body, failure)
          throw new Error('save failed')
        }
        const saved = (await res.json().catch(() => null)) as VisaTypeSaved | null
        setSavedVerdict(saved?.eligibility ?? null)
        onChange?.(visaTypeId, saved ?? undefined)
      } catch {
        setSelected(previous)
        setError(failure)
      } finally {
        setSaving(false)
      }
    },
    [apiUrl, applicationId, onChange, saving, selected, t],
  )

  if (options === null || options.length === 0) return null

  const selectedOption = options.find((o) => o.id === selected) ?? null
  const notice = selectedOption
    ? eligibilityNotice(savedVerdict ?? selectedOption.eligibility)
    : null

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={selectId}
        className="text-[11px] font-semibold uppercase tracking-[0.6px] text-midtone-gray"
      >
        {t('heading')}
      </label>

      <div className="relative">
        <select
          id={selectId}
          value={selected ?? ''}
          disabled={saving}
          onChange={(e) => void choose(e.target.value || null)}
          className="w-full appearance-none rounded-[10px] border border-subtle-ash bg-canvas-white ps-3 pe-8 py-2 text-[13px] text-rich-black disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-deep-black/15"
        >
          <option value="">{t('noRouteChosen')}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {/* The sourced count rides in the label because a native option
                  cannot carry a badge, and it is the one fact that decides
                  between two routes: whether we can check this one against the
                  government's own published list. */}
              {visaTypeOptionName(option)}
              {' — '}
              {option.requirementCount > 0
                ? t('sourcedCount', { count: option.requirementCount })
                : t('notYetSourced')}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[10px] text-midtone-gray"
        >
          ▼
        </span>
      </div>

      {/* Only once a route is named — before that the label above already says
          what the control is for, and the explanation is noise in a header. */}
      {selectedOption && selectedOption.requirementCount === 0 ? (
        <p className="text-[11px] text-midtone-gray">{t('notYetSourced')}</p>
      ) : null}

      {/* The chosen route's fit for this applicant. Not shown while a save
          error is: that one is about the route they just tried to pick. */}
      {!error && notice?.tone === 'alert' ? (
        <p role="alert" className="text-[12px] text-rose">
          {notice.text}
        </p>
      ) : null}
      {!error && notice?.tone === 'note' ? (
        <p className="text-[11px] text-midtone-gray">{notice.text}</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12px] text-rose">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export default VisaTypeSelector
