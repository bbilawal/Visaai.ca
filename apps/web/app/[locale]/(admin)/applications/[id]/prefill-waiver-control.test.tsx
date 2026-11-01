import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getSession = vi.fn()
const toast = vi.fn()
vi.mock('@/lib/supabase/client', () => ({ getSession: () => getSession() }))
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ toast }) }))
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${Object.values(v).join(',')}` : k,
}))

import { PrefillWaiverControl } from './prefill-waiver-control'

describe('PrefillWaiverControl', () => {
  beforeEach(() => {
    toast.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('needs a reason before it can waive', () => {
    render(<PrefillWaiverControl applicationId="app-1" />)
    expect(screen.getByRole('button', { name: 'waiverButton' })).toBeDisabled()
  })

  it('posts the reason to the admin waiver route and confirms', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ paymentId: 'p1', alreadyUnlocked: false }), { status: 201 }),
    )
    render(<PrefillWaiverControl applicationId="app-1" />)
    fireEvent.change(screen.getByLabelText('waiverReason'), { target: { value: 'dry-run test' } })
    fireEvent.click(screen.getByRole('button', { name: 'waiverButton' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('waiverDone', 'success'))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/applications\/app-1\/prefill-waiver$/)
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'dry-run test' })
    expect(screen.getByRole('button', { name: 'waiverDoneShort' })).toBeDisabled()
  })

  it('reports a failure instead of claiming success', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 403 }))
    render(<PrefillWaiverControl applicationId="app-1" />)
    fireEvent.change(screen.getByLabelText('waiverReason'), { target: { value: 'test' } })
    fireEvent.click(screen.getByRole('button', { name: 'waiverButton' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('waiverFailed:HTTP 403', 'error'))
  })
})
