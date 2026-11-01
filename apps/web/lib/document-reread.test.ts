import { describe, expect, it, vi } from 'vitest'
import { attentionOf, canReread, requestReread } from './document-reread'

describe('requestReread', () => {
  it('POSTs to the reprocess route with the bearer token', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ documentId: 'd1', queued: true, status: 'queued' }), { status: 201 }),
    )
    await expect(requestReread('https://api.test', 'tok', 'd1', fetchImpl)).resolves.toBe('queued')
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/documents/item/d1/reprocess', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('reports a re-read that was already on its way', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ documentId: 'd1', queued: false, status: 'already_queued' }), { status: 201 }),
    )
    await expect(requestReread('https://api.test', 'tok', 'd1', fetchImpl)).resolves.toBe('already_queued')
  })

  it('throws on a refusal, with the rate limit told apart', async () => {
    const limited = vi.fn(async () => new Response('', { status: 429 }))
    await expect(requestReread('https://api.test', 'tok', 'd1', limited)).rejects.toThrow('rate_limited')
    const denied = vi.fn(async () => new Response('', { status: 404 }))
    await expect(requestReread('https://api.test', 'tok', 'd1', denied)).rejects.toThrow('failed')
  })
})

describe('canReread', () => {
  it('only offers a re-read once the document is not already being read', () => {
    expect(canReread({ ocr_status: 'complete' })).toBe(true)
    expect(canReread({ ocr_status: 'failed' })).toBe(true)
    expect(canReread({ ocr_status: 'pending' })).toBe(false)
  })
})

describe('attentionOf', () => {
  it('returns the message of an item that needs attention', () => {
    expect(
      attentionOf({ meta: { needs_attention: true, attention_message: 'Check the marriage date.' } }),
    ).toBe('Check the marriage date.')
  })

  it('returns null otherwise', () => {
    expect(attentionOf({ meta: null })).toBeNull()
    expect(attentionOf({ meta: { attention_message: 'stale' } })).toBeNull()
    expect(attentionOf({ meta: { needs_attention: true, attention_message: '  ' } })).toBeNull()
  })
})
