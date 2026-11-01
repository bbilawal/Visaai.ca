import { describe, expect, it, vi } from 'vitest'
import {
  confirmHolder,
  holderConfirmationOf,
  holderMismatchOf,
  identityResultOf,
} from './holder-mismatch'

describe('holderMismatchOf', () => {
  it('reads the note from the identity row', () => {
    expect(
      holderMismatchOf([
        { verification_type: 'expiry', details_json: { basis: 'x' } },
        {
          verification_type: 'identity',
          details_json: {
            holder_mismatch: {
              holder: 'FOXTROT GOLF',
              applicant: 'Alpha Tester',
              message: 'This document seems to name FOXTROT GOLF, not Alpha Tester.',
            },
          },
        },
      ]),
    ).toEqual({
      holder: 'FOXTROT GOLF',
      applicant: 'Alpha Tester',
      message: 'This document seems to name FOXTROT GOLF, not Alpha Tester.',
      held: false,
      clearlyOther: false,
    })
  })

  it('marks a passport the API holds for confirmation', () => {
    expect(
      holderMismatchOf([
        {
          verification_type: 'identity',
          details_json: {
            holder_mismatch: {
              holder: 'MIKE OSCAR',
              applicant: 'Kilo Tester',
              message: 'confirm',
              needs_confirmation: true,
            },
          },
        },
      ]),
    ).toMatchObject({ holder: 'MIKE OSCAR', held: true })
  })

  it('is null without a note, or with an incomplete one', () => {
    expect(holderMismatchOf([])).toBeNull()
    expect(holderMismatchOf([{ verification_type: 'identity', details_json: {} }])).toBeNull()
    expect(
      holderMismatchOf([
        { verification_type: 'identity', details_json: { holder_mismatch: { holder: 'X', applicant: ' ' } } },
      ]),
    ).toBeNull()
  })

  it('ignores the note on any other row type', () => {
    expect(
      holderMismatchOf([
        {
          verification_type: 'duplicate',
          details_json: { holder_mismatch: { holder: 'X', applicant: 'Y', message: 'm' } },
        },
      ]),
    ).toBeNull()
  })
})

describe('holderMismatchOf — clearly someone else', () => {
  it('marks clearly_other', () => {
    expect(
      holderMismatchOf([
        {
          verification_type: 'identity',
          details_json: {
            holder_mismatch: { holder: 'Q Z', applicant: 'K T', message: 'm', clearly_other: true },
          },
        },
      ]),
    ).toMatchObject({ held: false, clearlyOther: true })
  })
})

describe('identityResultOf — the Identity badge', () => {
  const row = (result: string, details: Record<string, unknown> = {}) => ({
    verification_type: 'identity',
    result,
    details_json: details,
  })
  const mm = (extra: Record<string, unknown>) => ({
    holder_mismatch: { holder: 'Q Z', applicant: 'K T', message: 'm', ...extra },
  })

  it('a held passport is "needs confirmation", never a pass', () => {
    expect(identityResultOf(row('pass', mm({ needs_confirmation: true })))).toBe('needs_confirmation')
  })

  it("a passport that is clearly someone else's is 'not_yours'", () => {
    expect(identityResultOf(row('pass', mm({ clearly_other: true })))).toBe('not_yours')
  })

  it('otherwise the stored result, whatever the row type', () => {
    expect(identityResultOf(row('pass'))).toBe('pass')
    expect(identityResultOf(row('pass', mm({})))).toBe('pass')
    expect(identityResultOf(row('warn'))).toBe('warn')
    expect(
      identityResultOf({ verification_type: 'expiry', result: 'fail', details_json: mm({ clearly_other: true }) }),
    ).toBe('fail')
  })

  it('a passport the applicant confirmed is its stored result', () => {
    expect(
      identityResultOf(row('pass', { holder_confirmation: { confirmed_at: '2026-10-30T10:00:00Z' } })),
    ).toBe('pass')
  })
})

describe('holderConfirmationOf', () => {
  it('reads the applicant confirmation from the identity row', () => {
    expect(
      holderConfirmationOf([
        {
          verification_type: 'identity',
          details_json: {
            holder_confirmation: {
              confirmed_at: '2026-10-30T10:00:00Z',
              holder: 'QUEBEC ZULU',
              stated_name: 'Romeo Kilo',
            },
          },
        },
      ]),
    ).toEqual({ confirmedAt: '2026-10-30T10:00:00Z', holder: 'QUEBEC ZULU', statedName: 'Romeo Kilo' })
  })

  it('is null without one', () => {
    expect(holderConfirmationOf([{ verification_type: 'identity', details_json: {} }])).toBeNull()
  })
})

describe('confirmHolder', () => {
  it('POSTs to the confirm-holder endpoint with the bearer token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ confirmed: true }), { status: 200 }))
    await confirmHolder('https://api.test', 'tok', 'doc-1', fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/documents/item/doc-1/confirm-holder', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it.each([
    [429, 'rate_limited'],
    [409, 'not_confirmable'],
    [503, 'unavailable'],
    [500, 'failed'],
  ])('a %s is %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status }))
    await expect(confirmHolder('https://api.test', 'tok', 'doc-1', fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      code,
    )
  })
})
