/**
 * RTL tests for TemplatesClient (Task 5 — admin notification template manager).
 *
 * RED → GREEN cycle:
 *   1. Editing the title + clicking Preview calls the mocked previewTemplate
 *   2. Clicking Save (no existing id) calls the mocked createTemplate
 *   3. Clicking Save (editing id set) calls the mocked updateTemplate
 *   4. Preview result is rendered after the call resolves
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { NotificationTemplate } from '@visaai/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRefresh = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockPreviewTemplate = vi
  .fn()
  .mockResolvedValue({ title: 'Preview Title', body: 'Preview Body' })

const mockCreateTemplate = vi.fn().mockResolvedValue({ id: 'new-id' })
const mockUpdateTemplate = vi.fn().mockResolvedValue({ id: 'existing-id' })
const mockDeactivateTemplate = vi.fn().mockResolvedValue({ id: 'existing-id' })

vi.mock('@/lib/api/admin-templates-client', () => ({
  previewTemplate: (...args: unknown[]) => mockPreviewTemplate(...args),
  createTemplate: (...args: unknown[]) => mockCreateTemplate(...args),
  updateTemplate: (...args: unknown[]) => mockUpdateTemplate(...args),
  deactivateTemplate: (...args: unknown[]) => mockDeactivateTemplate(...args),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
}))

// next-intl: return the translation key so assertions are deterministic
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const activeTemplate: NotificationTemplate = {
  id: 'tpl-1',
  event_type: 'consultant.assigned',
  locale: 'en',
  subject: 'You have been assigned',
  title: 'Consultant assigned: {{consultantName}}',
  body: 'Application {{applicationId}} assigned to {{consultantName}}',
  variables: ['consultantName', 'applicationId'],
  version: 1,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
}

const inactiveTemplate: NotificationTemplate = {
  ...activeTemplate,
  id: 'tpl-0',
  version: 0,
  is_active: false,
  created_at: '2025-12-01T00:00:00Z',
}

// ── Import after mocks ────────────────────────────────────────────────────────
// eslint-disable-next-line import/first
import { TemplatesClient } from './templates-client'

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TemplatesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the template list and the editor form', () => {
    render(<TemplatesClient initialTemplates={[activeTemplate]} />)

    // template list shows event_type (also appears in the select, so use getAllByText)
    const eventTypeEls = screen.getAllByText('consultant.assigned')
    expect(eventTypeEls.length).toBeGreaterThanOrEqual(1)

    // editor form elements
    expect(screen.getByTestId('template-title')).toBeInTheDocument()
    expect(screen.getByTestId('template-body')).toBeInTheDocument()
    expect(screen.getByTestId('preview-btn')).toBeInTheDocument()
    expect(screen.getByTestId('save-btn')).toBeInTheDocument()
  })

  it('editing title and clicking Preview calls previewTemplate with token + payload', async () => {
    render(<TemplatesClient initialTemplates={[]} />)

    // Type a title
    const titleInput = screen.getByTestId('template-title')
    fireEvent.change(titleInput, { target: { value: 'Hello {{consultantName}}' } })

    // Type a body
    const bodyInput = screen.getByTestId('template-body')
    fireEvent.change(bodyInput, { target: { value: 'Body text' } })

    // Click Preview
    await act(async () => {
      fireEvent.click(screen.getByTestId('preview-btn'))
    })

    await waitFor(() => {
      expect(mockPreviewTemplate).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          title: 'Hello {{consultantName}}',
          body: 'Body text',
          sampleVars: expect.any(Object),
        }),
      )
    })
  })

  it('preview result is shown after previewTemplate resolves', async () => {
    render(<TemplatesClient initialTemplates={[]} />)

    fireEvent.change(screen.getByTestId('template-title'), {
      target: { value: 'My title' },
    })
    fireEvent.change(screen.getByTestId('template-body'), {
      target: { value: 'My body' },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('preview-btn'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('preview-result')).toBeInTheDocument()
      expect(screen.getByText('Preview Title')).toBeInTheDocument()
      expect(screen.getByText('Preview Body')).toBeInTheDocument()
    })
  })

  it('Save calls createTemplate when no template is being edited (new mode)', async () => {
    render(<TemplatesClient initialTemplates={[]} />)

    fireEvent.change(screen.getByTestId('template-title'), {
      target: { value: 'New Template Title' },
    })
    fireEvent.change(screen.getByTestId('template-body'), {
      target: { value: 'New template body' },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-btn'))
    })

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          title: 'New Template Title',
          body: 'New template body',
          event_type: 'consultant.assigned',
          locale: 'en',
        }),
      )
      expect(mockUpdateTemplate).not.toHaveBeenCalled()
    })
  })

  it('Save calls updateTemplate when editing an existing template', async () => {
    render(<TemplatesClient initialTemplates={[activeTemplate]} />)

    // Click the template row to load it into the editor
    fireEvent.click(
      screen.getByRole('button', {
        name: /edit template consultant.assigned en v1/i,
      }),
    )

    // Update the title
    const titleInput = screen.getByTestId('template-title')
    fireEvent.change(titleInput, { target: { value: 'Updated title' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-btn'))
    })

    await waitFor(() => {
      expect(mockUpdateTemplate).toHaveBeenCalledWith(
        'test-token',
        'tpl-1',
        expect.objectContaining({ title: 'Updated title' }),
      )
      expect(mockCreateTemplate).not.toHaveBeenCalled()
    })
  })

  it('router.refresh is called after successful save', async () => {
    render(<TemplatesClient initialTemplates={[]} />)

    fireEvent.change(screen.getByTestId('template-title'), {
      target: { value: 'Title' },
    })
    fireEvent.change(screen.getByTestId('template-body'), {
      target: { value: 'Body' },
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-btn'))
    })

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('shows "noTemplates" text when the list is empty', () => {
    render(<TemplatesClient initialTemplates={[]} />)
    expect(screen.getByText('noTemplates')).toBeInTheDocument()
  })

  it('variable hints are shown for the selected event type', () => {
    render(<TemplatesClient initialTemplates={[]} />)
    // default event type = consultant.assigned → consultantName, applicationId
    expect(screen.getByText(/consultantName/)).toBeInTheDocument()
    expect(screen.getByText(/applicationId/)).toBeInTheDocument()
  })

  it('active badge is rendered for active templates', () => {
    render(<TemplatesClient initialTemplates={[activeTemplate, inactiveTemplate]} />)
    // The translation mock returns the key: 'active' and 'inactive'
    const activeBadges = screen.getAllByText('active')
    expect(activeBadges.length).toBeGreaterThanOrEqual(1)
    const inactiveBadges = screen.getAllByText('inactive')
    expect(inactiveBadges.length).toBeGreaterThanOrEqual(1)
  })
})
