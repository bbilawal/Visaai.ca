import type { ChecklistItemMeta, ChecklistOwner } from '@visaai/types'

/** Minimal shape every checklist consumer (DB row or streamed item) satisfies. */
export interface GroupableItem {
  id: string
  label: string
  status: string
  meta?: ChecklistItemMeta | null
}

export interface OwnerGroup<T extends GroupableItem> {
  owner: ChecklistOwner
  heading: string
  forms: T[]
  documents: T[]
  /** Optional case-strengthening documents (meta.strength). */
  strengthening: T[]
}

export const OWNER_HEADINGS: Record<ChecklistOwner, string> = {
  applicant: 'Applicant',
  sponsor: 'Sponsor',
}

export function ownerOf(item: GroupableItem): ChecklistOwner {
  return item.meta?.owner === 'sponsor' ? 'sponsor' : 'applicant'
}

export function isForm(item: GroupableItem): boolean {
  return item.meta?.kind === 'form'
}

export function isStrength(item: GroupableItem): boolean {
  return item.meta?.strength === true
}

export function specsOf(item: GroupableItem): Array<{ label: string; value: string }> {
  const specs = item.meta?.specs
  if (!specs) return []
  const order: Array<[keyof NonNullable<ChecklistItemMeta['specs']>, string]> = [
    ['source', 'Where to get'],
    ['format', 'Format'],
    ['dimensions', 'Size'],
    ['file_requirements', 'File'],
    ['validity', 'Validity'],
    ['notes', 'Notes'],
  ]
  return order
    .map(([key, label]) => ({ label, value: (specs[key] ?? '').trim() }))
    .filter(s => s.value)
}

/**
 * Split a flat checklist into Applicant / Sponsor groups, each carrying its
 * own forms and documents. Sponsor group is omitted entirely when no sponsor
 * items exist, so simple self-funded applications never show an empty section.
 */
export function groupByOwner<T extends GroupableItem>(items: T[]): OwnerGroup<T>[] {
  const groups: OwnerGroup<T>[] = []
  for (const owner of ['applicant', 'sponsor'] as ChecklistOwner[]) {
    const owned = items.filter(i => ownerOf(i) === owner)
    if (owned.length === 0) continue
    const nonForms = owned.filter(i => !isForm(i))
    groups.push({
      owner,
      heading: OWNER_HEADINGS[owner],
      forms: owned.filter(isForm),
      documents: nonForms.filter(i => !isStrength(i)),
      strengthening: nonForms.filter(isStrength),
    })
  }
  return groups
}
