import type { ChecklistItem } from '@visaai/types'

type GateItem = {
  label: string
  status: string
  meta?: ChecklistItem['meta'] | null
  /** Only an explicit `false` makes an item optional; only `true` can block. */
  required?: boolean | null
}

/**
 * Optional = case-strengthening evidence OR anything the checklist stores as
 * required=false (registry recommendations, "may be required" items). Optional
 * items never gate downstream actions and must never be badged "Needed".
 */
export function isOptionalItem(item: GateItem): boolean {
  return item.meta?.strength === true || item.required === false
}

/**
 * The documents that still block VRI / prefill / submit: required, not a form,
 * not optional, and not yet uploaded, verified or waived.
 */
export function blockingDocuments<T extends GateItem>(items: T[]): T[] {
  return items.filter(i => {
    if (i.meta?.kind === 'form') return false // forms are filled online, not uploaded
    if (isOptionalItem(i)) return false
    if (i.required !== true) return false
    return i.status !== 'uploaded' && i.status !== 'verified' && i.status !== 'waived'
  })
}

/** Short, human list of what is blocking, for a toast. */
export function docsGateItemsText(missing: Array<Pick<ChecklistItem, 'label'>>, max = 3): string {
  const shown = missing.slice(0, max).map(i => i.label).join(', ')
  const rest = missing.length - max
  return rest > 0 ? `${shown} +${rest}` : shown
}

/**
 * The single next document to upload: the first required, non-form,
 * non-optional slot still missing. A slot already uploaded is with the
 * pipeline, not with the applicant — naming it as "next" after they uploaded
 * it (super visa, prod app 61f16bb5) read as if the upload had failed.
 */
export function nextUploadItem<T extends GateItem & { meta?: GateItem['meta'] }>(items: T[]): T | null {
  return (
    items.find(
      i => i.meta?.kind !== 'form' && !isOptionalItem(i) && i.required === true && i.status === 'missing',
    ) ?? null
  )
}

/**
 * Whether a slot shows "Verified". A real slot follows its checklist row —
 * the same status the progress counter counts — so the badge and the count
 * can never disagree. The catch-all slot has no row and follows its files.
 */
export function slotIsVerified(item: GateItem & { id: string }, filesVerified: boolean): boolean {
  if (item.id === 'other') return filesVerified
  return item.status === 'verified' || item.status === 'waived'
}
