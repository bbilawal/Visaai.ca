'use client'

import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'

interface DocumentsProgressProps {
  done: number
  total: number
  /** Label of the next unsatisfied document, if any. */
  nextLabel: string | null
}

/**
 * "Where am I, and what do I do next" — the first thing on the page.
 *
 * The documents page used to open with government reference material, so the
 * applicant's own task was below the fold. This states the count, draws the
 * bar, and names the single next document to upload. One next action, not a
 * list to triage.
 *
 * The bar animates its width; `motion-reduce:transition-none` drops that for
 * anyone who has asked the OS for less motion. The number is always present in
 * text, so the bar is decoration and never the only way to read progress —
 * `aria-hidden` on the track says exactly that to a screen reader, which gets
 * the count from the sentence above it instead.
 */
export function DocumentsProgress({ done, total, nextLabel }: DocumentsProgressProps) {
  const t = useTranslations('documents')
  if (total === 0) return null

  const pct = Math.round((done / total) * 100)
  const complete = done === total

  return (
    <Card className="mb-4" variant="tight">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[14px] font-medium text-deep-black">{t('yourDocuments')}</p>
        <p className="text-[13px] text-midtone-gray tabular-nums">
          {t('progressCount', { done, total })}
        </p>
      </div>

      <div
        aria-hidden
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle-ash"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${
            complete ? 'bg-success-green' : 'bg-rich-black'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 text-[13px] text-rich-black">
        {complete ? t('allVerified') : nextLabel ? t('nextUpload', { label: nextLabel }) : t('uploadIntro')}
      </p>
    </Card>
  )
}
