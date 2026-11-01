import { describe, it, expect } from 'vitest'
import { refreshStayMentions, refreshChecklistStay } from './stay-mentions'

describe('refreshStayMentions', () => {
  it('rewrites a stale stay length to the date-derived one', () => {
    expect(refreshStayMentions('Clarify the short 56-day holiday, confirm no childcare', 61))
      .toBe('Clarify the short 61-day holiday, confirm no childcare')
    expect(refreshStayMentions('temporary nature of the 56-day visit credible', 61))
      .toBe('temporary nature of the 61-day visit credible')
    expect(refreshStayMentions('a stay of 62 days in Canada', 61)).toBe('a stay of 61 days in Canada')
    expect(refreshStayMentions('the planned 62 day trip', 61)).toBe('the planned 61 day trip')
  })

  it('leaves other day counts alone', () => {
    const t = 'Bank statements for the last 90 days; apply 30 days before travel; a 6-month history'
    expect(refreshStayMentions(t, 61)).toBe(t)
  })

  it('does nothing without a date-derived length', () => {
    expect(refreshStayMentions('the 56-day visit', null)).toBe('the 56-day visit')
  })
})

describe('refreshChecklistStay', () => {
  it('refreshes added_reason and every string in meta.specs, leaving the rest', () => {
    const item = {
      id: '1',
      added_reason: 'strengthening:Makes the temporary nature of the 56-day visit credible',
      meta: { kind: 'document', specs: { notes: 'Clarify the short 56-day holiday', format: 'Signed letter' } },
    }
    const [out] = refreshChecklistStay([item], 61)
    expect(out.added_reason).toBe('strengthening:Makes the temporary nature of the 61-day visit credible')
    expect(out.meta.specs.notes).toBe('Clarify the short 61-day holiday')
    expect(out.meta.specs.format).toBe('Signed letter')
    expect(item.meta.specs.notes).toBe('Clarify the short 56-day holiday')
  })
})
