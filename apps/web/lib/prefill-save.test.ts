/**
 * Review finding (2026-10-15): a stale Forms tab saved the whole field list and
 * silently reverted a consultant's correction (62 -> 56). Saves now carry the
 * version they were based on; the API answers 409 when the form moved on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { savePrefillFields } from './prefill-save'

afterEach(() => vi.unstubAllGlobals())

describe('savePrefillFields', () => {
  it('sends the base version and returns the new one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ payload: { fields: [] }, version: 'v2' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await savePrefillFields('http://api', 't', 'app-1', [{ key: 'a', label: 'A', value: '1' }], 'v1')
    expect(out).toEqual({ kind: 'saved', payload: { fields: [] }, version: 'v2' })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ fields: [{ key: 'a', label: 'A', value: '1' }], baseVersion: 'v1' })
    expect(init.method).toBe('PATCH')
  })

  it('reports a conflict with the server message instead of throwing a generic error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'This form changed since you opened it' }), { status: 409 }),
    ))
    const out = await savePrefillFields('http://api', 't', 'app-1', [], 'old')
    expect(out).toEqual({ kind: 'conflict', message: 'This form changed since you opened it' })
  })

  it('throws on any other failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    await expect(savePrefillFields('http://api', 't', 'app-1', [], 'v')).rejects.toThrow(/save/i)
  })
})
