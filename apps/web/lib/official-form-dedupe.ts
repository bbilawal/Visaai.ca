import { isForm } from './checklist-grouping'
import type { GroupableItem } from './checklist-grouping'

/**
 * One comparable key for a government form code, whatever source spelled it.
 *
 * The checklist says "IMM 5257" or "Form 956"; the official-forms and
 * document-template APIs say "IMM 5257", "IMM5257" or "956". Case, spacing,
 * punctuation and a leading "Form" word are all noise for this comparison.
 */
export function formCodeKey(code: string | null | undefined): string {
  if (!code) return ''
  return code
    .toUpperCase()
    .replace(/^\s*FORM\b/, '')
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * Drop "Required Forms" upload slots for forms the official sections on the
 * same page already hand the applicant (Official forms / Official document
 * checklists & guides), so one form is never listed twice.
 *
 * A slot that already holds an upload is kept: hiding it would hide the
 * applicant's own file. Non-form items are never touched, and form slots do
 * not count toward Documents completion (`requiredDocumentItems`), so removing
 * one cannot lock or unlock any stage.
 */
export function withoutOfficialDuplicates<T extends GroupableItem>(
  forms: T[],
  officialCodes: ReadonlySet<string>,
  hasUploads: (item: T) => boolean,
): T[] {
  if (officialCodes.size === 0) return forms
  return forms.filter(item => {
    if (!isForm(item)) return true
    if (hasUploads(item)) return true
    const key = formCodeKey(item.meta?.form_code ?? null)
    return !key || !officialCodes.has(key)
  })
}
