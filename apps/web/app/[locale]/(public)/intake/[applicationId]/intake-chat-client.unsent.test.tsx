/**
 * Prod 2026-10-21 / 2026-10-24: a correction typed into a completed intake
 * vanished — input cleared, no bubble, no error. An undelivered message now
 * stays in the thread, says it was not sent, and offers a retry; a session
 * that cannot take messages at all keeps the text in the box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const NOT_SENT = 'Your message was not sent. Check your connection and try again.'
const resend = vi.fn()
const retry = vi.fn()
const sendMessage = vi.fn()
let hookState: Record<string, unknown> = {}

vi.mock('@/hooks/use-application-stream', () => ({
  NOT_SENT_ERROR: 'Your message was not sent. Check your connection and try again.',
  useApplicationStream: () => hookState,
}))
vi.mock('@/components/auth/auth-gate-provider', () => ({
  useAuthGate: () => ({ status: 'permanent', isGated: false, openAuthModal: vi.fn() }),
}))
vi.mock('@/components/auth/gated-region', () => ({
  GatedRegion: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/intake/visa-type-selector', () => ({ VisaTypeSelector: () => null }))

import IntakeChatClient from './intake-chat-client'

const base = {
  streamingContent: null,
  isLoading: false,
  isComplete: true,
  needsAuth: false,
  canSend: true,
  retry,
  sendMessage,
  resend,
}

beforeEach(() => {
  resend.mockReset()
  retry.mockReset()
  sendMessage.mockReset()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

describe('IntakeChatClient — an undelivered message', () => {
  beforeEach(() => {
    hookState = {
      ...base,
      messages: [
        { msgId: 'a1', role: 'assistant', content: 'Your intake is complete.' },
        { msgId: 'u1', role: 'user', content: 'My marriage date is 2019-04-02', status: 'failed' },
      ],
      error: NOT_SENT,
    }
  })

  it('stays in the thread, marked not sent', () => {
    render(<IntakeChatClient applicationId="app-1" />)
    expect(screen.getByText('My marriage date is 2019-04-02')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('notSent')
  })

  it('the bubble retry resends that message; the banner retry reconnects', () => {
    render(<IntakeChatClient applicationId="app-1" />)
    const [bubbleRetry, bannerRetry] = screen.getAllByRole('button', { name: 'retry' })
    fireEvent.click(bubbleRetry)
    expect(resend).toHaveBeenCalledWith('u1')
    fireEvent.click(bannerRetry)
    expect(retry).toHaveBeenCalled()
  })

  it('shows the localized not-sent line instead of the raw fallback', () => {
    render(<IntakeChatClient applicationId="app-1" />)
    expect(screen.getByText('notSentDetail')).toBeInTheDocument()
    expect(screen.queryByText(NOT_SENT)).not.toBeInTheDocument()
  })
})

describe('IntakeChatClient — a session that cannot take messages', () => {
  const NO_ACCESS = 'You do not have access to this application.'

  beforeEach(() => {
    // Prod 2026-10-24: signed in (another tab) as a consultant with no access.
    hookState = { ...base, messages: [], error: NO_ACCESS, canSend: false }
    sendMessage.mockReturnValue(false)
  })

  it('closes the box, says why, and keeps the error and its retry visible', () => {
    render(<IntakeChatClient applicationId="app-1" />)
    const box = screen.getByPlaceholderText('correctionPlaceholder') as HTMLInputElement
    expect(box).toBeDisabled()
    expect(screen.getByText('sendBlocked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled()
    expect(screen.getByText(NO_ACCESS)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    expect(retry).toHaveBeenCalled()
  })

  it('a submit that still gets through keeps the typed text and sends nothing', () => {
    // canSend flips false between typing and pressing Return.
    hookState = { ...hookState, canSend: true }
    render(<IntakeChatClient applicationId="app-1" />)
    const box = screen.getByPlaceholderText('correctionPlaceholder') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'My marriage date is 2019-04-02' } })
    fireEvent.submit(box.closest('form')!)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(box.value).toBe('My marriage date is 2019-04-02')
    expect(screen.getByText(NO_ACCESS)).toBeInTheDocument()
  })

  it('clears the box only when the hook accepted the message', () => {
    sendMessage.mockReturnValue(true)
    hookState = { ...hookState, canSend: true, error: null }
    render(<IntakeChatClient applicationId="app-1" />)
    const box = screen.getByPlaceholderText('correctionPlaceholder') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'correction' } })
    fireEvent.submit(box.closest('form')!)
    expect(sendMessage).toHaveBeenCalledWith('correction')
    expect(box.value).toBe('')
  })
})
