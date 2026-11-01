import { describe, it, expect } from 'vitest'
import { shouldReclaimFocus } from './input-refocus'

const body = { tag: 'body' } as unknown as Element
const input = { tag: 'input' } as unknown as Element
const link = { tag: 'a' } as unknown as Element

const base = { isLoading: false, isComplete: false, body, input }

describe('shouldReclaimFocus', () => {
  it('takes focus back when the disable dropped it on <body>', () => {
    // The reported bug: after every answer the applicant had to click the box
    // before they could type.
    expect(shouldReclaimFocus({ ...base, active: body })).toBe(true)
  })

  it('takes focus back when nothing is focused at all', () => {
    expect(shouldReclaimFocus({ ...base, active: null })).toBe(true)
  })

  it('leaves focus alone while the model is still replying', () => {
    // The box is disabled here; focusing it would do nothing anyway.
    expect(
      shouldReclaimFocus({ ...base, isLoading: true, active: body }),
    ).toBe(false)
  })

  it('leaves focus alone once the interview is over', () => {
    // A finished intake must not keep stealing the caret from the page.
    expect(
      shouldReclaimFocus({ ...base, isComplete: true, active: body }),
    ).toBe(false)
  })

  it('does not yank the caret out of something the applicant chose', () => {
    // Clicking the visa-type select or a link while the model thinks is
    // deliberate. Reclaiming there would be a worse bug than the one fixed.
    expect(shouldReclaimFocus({ ...base, active: link })).toBe(false)
  })

  it('does not refocus the input it is already on', () => {
    // Refocusing resets the caret to the end, which would eat the position of
    // anyone who started typing before the answer landed.
    expect(shouldReclaimFocus({ ...base, active: input })).toBe(false)
  })

  it('does nothing before the input exists', () => {
    expect(
      shouldReclaimFocus({ ...base, input: null, active: body }),
    ).toBe(false)
  })
})
