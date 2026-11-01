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

export interface VisaTypeOption {
  id: string
  visaaiId: string
  name: string
  officialCode: string | null
  category: string | null
  dataQuality: string | null
  requirementCount: number
}

interface Props {
  applicationId: string
  /** Set when the application already names a route. */
  initialVisaTypeId?: string | null
  /** Lets the parent refresh the checklist once the route changes. */
  onChange?: (visaTypeId: string | null) => void
}

export function VisaTypeSelector({
  applicationId,
  initialVisaTypeId = null,
  onChange,
}: Props) {
  const t = useTranslations('visaType')
  const [options, setOptions] = useState<VisaTypeOption[] | null>(null)
  const [selected, setSelected] = useState<string | null>(initialVisaTypeId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        if (!cancelled) setOptions(data)
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
  }, [apiUrl, applicationId])

  const choose = useCallback(
    async (visaTypeId: string | null) => {
      if (saving || visaTypeId === selected) return
      setSaving(true)
      setError(null)

      // Optimistic: the list is the applicant's own click, and reverting on
      // failure is less confusing than a control that ignores them.
      const previous = selected
      setSelected(visaTypeId)

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
        if (!res.ok) throw new Error('save failed')
        onChange?.(visaTypeId)
      } catch {
        setSelected(previous)
        setError(t('errSaveFailed'))
      } finally {
        setSaving(false)
      }
    },
    [apiUrl, applicationId, onChange, saving, selected, t],
  )

  if (options === null || options.length === 0) return null

  const selectedOption = options.find((o) => o.id === selected) ?? null

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
              {option.officialCode
                ? `${option.name} (${option.officialCode})`
                : option.name}
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

      {error ? <p className="text-[12px] text-rose">{error}</p> : null}
    </div>
  )
}

export default VisaTypeSelector
