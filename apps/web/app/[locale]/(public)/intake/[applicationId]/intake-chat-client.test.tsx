/**
 * Dry run 2026-10-16 (super visa, application 61f16bb5): choosing "Super visa"
 * in "Which visa are you applying for?" in the middle of the interview sent the
 * applicant straight to the Documents page, abandoning the question they were
 * answering. The same happened for every route, the visitor visa included.
 * Choosing a route now stays on the interview, says the route was saved, and
 * the interview carries on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))
const push = vi.fn()
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/hooks/use-application-stream', () => ({
  useApplicationStream: () => ({
    messages: [{ msgId: 'm1', role: 'assistant', content: 'Next question: What is your marital status?' }],
    streamingContent: null,
    isLoading: false,
    isComplete: false,
    error: null,
    needsAuth: false,
    canSend: true,
    retry: vi.fn(),
    sendMessage: vi.fn(),
  }),
}))
vi.mock('@/components/auth/auth-gate-provider', () => ({
  useAuthGate: () => ({ status: 'permanent', isGated: false, openAuthModal: vi.fn() }),
}))
vi.mock('@/components/auth/gated-region', () => ({
  GatedRegion: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
const toast = vi.fn()
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ toast }) }))
// The selector itself talks to the API; here it is a plain control that
// reports a choice, which is all the page reacts to.
vi.mock('@/components/intake/visa-type-selector', () => ({
  VisaTypeSelector: ({
    onChange,
  }: {
    onChange?: (id: string | null, saved?: { visaTypeId: string; changed: boolean; intakeComplete?: boolean }) => void
  }) => (
    <>
      <button type="button" onClick={() => onChange?.('super-visa-id', { visaTypeId: 'super-visa-id', changed: true, intakeComplete: false })}>pick super visa</button>
      <button type="button" onClick={() => onChange?.('trv-id')}>pick visitor visa</button>
      <button type="button" onClick={() => onChange?.('done-id', { visaTypeId: 'done-id', changed: true, intakeComplete: true })}>pick answered route</button>
    </>
  ),
}))

import IntakeChatClient from './intake-chat-client'

beforeEach(() => {
  push.mockReset()
  toast.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

describe('IntakeChatClient — choosing a route keeps the interview open', () => {
  it.each(['pick super visa', 'pick visitor visa'])(
    '%s: stays on the interview and confirms the route was saved',
    (label) => {
      render(<IntakeChatClient applicationId="app-1" />)
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(push).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledWith('routeSaved', 'success')
      // The question being answered is still on screen, and the box still takes text.
      expect(screen.getByText('Next question: What is your marital status?')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('inputPlaceholder')).not.toBeDisabled()
    },
  )

  it('a route whose questions are all answered goes on to the documents', () => {
    render(<IntakeChatClient applicationId="app-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'pick answered route' }))
    expect(push).toHaveBeenCalledWith('/documents/app-1')
  })

  it('the documents link still goes to the documents page', () => {
    render(<IntakeChatClient applicationId="app-1" />)
    fireEvent.click(screen.getByRole('button', { name: /skipToDocuments/ }))
    expect(push).toHaveBeenCalledWith('/documents/app-1')
  })
})
