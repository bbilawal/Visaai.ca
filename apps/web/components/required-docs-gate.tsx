'use client'

import { useEffect, useState, useCallback } from 'react'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ChecklistItem } from '@visaai/types'
import { blockingDocuments } from '@/lib/required-docs'

export interface RequiredDocsState {
  ready: boolean
  missing: ChecklistItem[]
  loading: boolean
  refresh: () => void
}

/**
 * Tracks whether every REQUIRED document (non-form, non-optional) has at least
 * been uploaded. Optional / strengthening documents and official forms don't
 * gate downstream actions (VRI, prefill, submit).
 */
export function useRequiredDocsReady(applicationId: string): RequiredDocsState {
  const [missing, setMissing] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [trigger, setTrigger] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('application_id', applicationId)
      if (cancelled) return
      const items = (data ?? []) as ChecklistItem[]
      setMissing(blockingDocuments(items))
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [applicationId, trigger])

  const refresh = useCallback(() => setTrigger(t => t + 1), [])
  return { ready: missing.length === 0, missing, loading, refresh }
}

/**
 * Inline panel listing the required documents the user still needs to upload,
 * shown on a downstream page when a gated action is attempted too early.
 */
export function MissingDocsPanel({
  applicationId,
  missing,
}: {
  applicationId: string
  missing: ChecklistItem[]
}) {
  if (missing.length === 0) return null
  return (
    <Card id="missing-docs-panel" className="mb-4 border border-deep-black" role="alert">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-deep-black">Upload your required documents first</p>
          <p className="text-[13px] text-midtone-gray mt-0.5">
            These required documents still need to be uploaded before you can continue:
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {missing.map(item => (
              <li key={item.id} className="text-[13px] text-rich-black flex items-center gap-2">
                <span className="text-midtone-gray">○</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
        <Link href={`/documents/${applicationId}`} className="shrink-0">
          <Button>Upload documents <span className="inline-block rtl:-scale-x-100" aria-hidden>→</span></Button>
        </Link>
      </div>
    </Card>
  )
}
