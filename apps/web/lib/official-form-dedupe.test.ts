import { describe, expect, it } from 'vitest'
import { formCodeKey, withoutOfficialDuplicates } from './official-form-dedupe'

const form = (id: string, form_code: string | null) => ({
  id,
  label: `Form ${form_code}`,
  status: 'missing',
  meta: { kind: 'form' as const, form_code },
})

describe('formCodeKey', () => {
  it('ignores case, spacing, punctuation and a leading "Form"', () => {
    expect(formCodeKey('IMM 5257')).toBe('IMM5257')
    expect(formCodeKey('imm5257')).toBe('IMM5257')
    expect(formCodeKey('Form 956')).toBe('956')
    expect(formCodeKey('956')).toBe('956')
    expect(formCodeKey('DS-160')).toBe('DS160')
  })

  it('does not strip "FORM" inside a code', () => {
    expect(formCodeKey('FORMULA-1')).toBe('FORMULA1')
  })

  it('is empty for a missing code', () => {
    expect(formCodeKey(null)).toBe('')
    expect(formCodeKey(undefined)).toBe('')
  })
})

describe('withoutOfficialDuplicates', () => {
  const none = () => false

  it('drops a form slot the official sections already list', () => {
    const forms = [form('a', 'IMM 5257'), form('b', 'IMM 5669')]
    const out = withoutOfficialDuplicates(forms, new Set(['IMM5257']), none)
    expect(out.map(f => f.id)).toEqual(['b'])
  })

  it('matches across spellings ("Form 956" vs template "956")', () => {
    const out = withoutOfficialDuplicates([form('a', 'Form 956')], new Set([formCodeKey('956')]), none)
    expect(out).toEqual([])
  })

  it('keeps a duplicate slot that already holds an upload', () => {
    const forms = [form('a', 'IMM 5257')]
    const out = withoutOfficialDuplicates(forms, new Set(['IMM5257']), () => true)
    expect(out.map(f => f.id)).toEqual(['a'])
  })

  it('keeps everything when the official sections list nothing', () => {
    const forms = [form('a', 'IMM 5257')]
    expect(withoutOfficialDuplicates(forms, new Set(), none)).toBe(forms)
  })

  it('keeps a form with no code', () => {
    const out = withoutOfficialDuplicates([form('a', null)], new Set(['IMM5257']), none)
    expect(out.map(f => f.id)).toEqual(['a'])
  })

  it('never touches a non-form item', () => {
    const doc = { id: 'd', label: 'Passport', status: 'missing', meta: { kind: 'document' as const, form_code: 'IMM 5257' } }
    const out = withoutOfficialDuplicates([doc], new Set(['IMM5257']), none)
    expect(out).toEqual([doc])
  })
})
