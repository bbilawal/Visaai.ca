import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiError, apiFetch } from './client'

function respond(status: number, body: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('apiFetch error detail', () => {
  /**
   * A guard that refuses an action for a specific reason was being flattened
   * into a bare "failed" in the UI, because the response body was dropped.
   */
  it('carries the API reason on the thrown error', async () => {
    respond(403, JSON.stringify({ message: 'cannot remove the last platform admin' }))
    await expect(apiFetch('/admin/users/u1/role', 't', { method: 'POST' })).rejects.toMatchObject(
      { status: 403, detail: 'cannot remove the last platform admin' },
    )
  })

  it('keeps the terse message every existing caller matches on', async () => {
    respond(403, JSON.stringify({ message: 'nope' }))
    await expect(
      apiFetch('/admin/users/u1/role', 't', { method: 'POST' }),
    ).rejects.toThrow('POST /admin/users/u1/role -> 403')
  })

  it('joins a validation message list', async () => {
    respond(400, JSON.stringify({ message: ['role is required', 'id must be a uuid'] }))
    await expect(apiFetch('/x', 't')).rejects.toMatchObject({
      detail: 'role is required; id must be a uuid',
    })
  })

  it('leaves detail undefined for a non-JSON body', async () => {
    respond(502, '<html>bad gateway</html>')
    const err = await apiFetch('/x', 't').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).detail).toBeUndefined()
  })

  it('leaves detail undefined for an empty body', async () => {
    respond(500, '')
    const err = await apiFetch('/x', 't').catch((e: unknown) => e)
    expect((err as ApiError).detail).toBeUndefined()
  })

  it('still parses a successful response', async () => {
    respond(200, JSON.stringify({ ok: true }))
    await expect(apiFetch('/x', 't')).resolves.toEqual({ ok: true })
  })
})
