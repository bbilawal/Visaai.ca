/**
 * Prod 2026-10-14: an application whose auto-fill had no address or
 * employment fields could never be locked. The panel hid categories with no
 * fields, but both the panel (`allChecked`) and the API (`allChecksPass`)
 * require every category's check — so two checkboxes the consultant could not
 * see stayed false and "Complete & lock" stayed disabled forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getPreflightMappings = vi.fn()
const getActivePreflight = vi.fn()
const editPreflightField = vi.fn()
const startPreflight = vi.fn()
const validatePreflightLock = vi.fn()
const refresh = vi.fn()
const completePreflight = vi.fn()
const recordPreflightCheck = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
// The real English copy, so the assertions read like the page.
vi.mock('next-intl', async () => {
  const en = (await import('@/messages/en.json')).default as { consultant: Record<string, string> }
  // One translator for every render, as next-intl gives: it is an effect dependency.
  const t = (key: string) => en.consultant[key] ?? key
  return { useTranslations: () => t }
})

vi.mock('@/lib/supabase/client', () => ({
  getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }),
}))
vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ toast: () => {} }),
}))
vi.mock('@/lib/api/preflight-client', () => ({
  getPreflightMappings: (...a: unknown[]) => getPreflightMappings(...a),
  getActivePreflight: (...a: unknown[]) => getActivePreflight(...a),
  startPreflight: (...a: unknown[]) => startPreflight(...a),
  recordPreflightCheck: (...a: unknown[]) => recordPreflightCheck(...a),
  completePreflight: (...a: unknown[]) => completePreflight(...a),
  validatePreflightLock: (...a: unknown[]) => validatePreflightLock(...a),
  editPreflightField: (...a: unknown[]) => editPreflightField(...a),
}))

import PreflightPanel from './preflight-panel'

const MAPPINGS = [
  { fieldKey: 'given_name', category: 'passport', mappedValue: 'MUZAFFAR' },
  { fieldKey: 'duration_of_stay_days', category: 'dates', mappedValue: '62' },
  { fieldKey: 'purpose_of_visit', category: 'travel_history', mappedValue: 'family visit' },
]

const REVIEW = {
  id: 'r-1',
  status: 'in_review',
  locked_diff_hash: null,
  passport_reviewed: false,
  dates_reviewed: false,
  travel_history_reviewed: false,
  addresses_reviewed: false,
  employment_reviewed: false,
  final_approval: false,
}

describe('PreflightPanel — categories with nothing to fill', () => {
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue(MAPPINGS)
    getActivePreflight.mockReset().mockResolvedValue(REVIEW)
  })

  it('still offers every required check, so the review can be completed', async () => {
    render(<PreflightPanel applicationId="app-1" />)

    expect(await screen.findByRole('checkbox', { name: /Addresses/ })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Employment/ })).toBeInTheDocument()
    // and says why there is nothing listed under them
    expect(screen.getAllByText(/nothing to fill/i)).toHaveLength(2)
  })

  it('enables Complete & lock once every check (including empty ones) is ticked', async () => {
    getActivePreflight.mockResolvedValue({
      ...REVIEW,
      passport_reviewed: true,
      dates_reviewed: true,
      travel_history_reviewed: true,
      addresses_reviewed: true,
      employment_reviewed: true,
      final_approval: true,
    })
    render(<PreflightPanel applicationId="app-1" />)

    const button = await screen.findByRole('button', { name: /Complete & lock/ })
    expect(button).toBeEnabled()
  })

  // Live 2026-10-19: an admin who opened the review saw an enabled button the
  // server refused; the reason was small red text after the click.
  it('disables Complete & lock and says why when this viewer cannot lock', async () => {
    getActivePreflight.mockResolvedValue({
      ...REVIEW,
      passport_reviewed: true,
      dates_reviewed: true,
      travel_history_reviewed: true,
      addresses_reviewed: true,
      employment_reviewed: true,
      final_approval: true,
      can_lock: false,
    })
    render(<PreflightPanel applicationId="app-1" />)

    expect(await screen.findByRole('button', { name: /Complete & lock/ })).toBeDisabled()
    expect(screen.getByText(/Only the assigned consultant can lock this review/)).toBeInTheDocument()
  })

  it('still cannot lock after a tick: the check response does not carry can_lock', async () => {
    const ticked = {
      ...REVIEW,
      passport_reviewed: true,
      dates_reviewed: true,
      travel_history_reviewed: true,
      addresses_reviewed: true,
      employment_reviewed: true,
    }
    getActivePreflight.mockResolvedValue({ ...ticked, can_lock: false })
    recordPreflightCheck.mockReset().mockResolvedValue({ ...ticked, final_approval: true })
    render(<PreflightPanel applicationId="app-1" />)

    fireEvent.click(await screen.findByRole('checkbox', { name: /I have reviewed every field above/ }))
    await waitFor(() => expect(recordPreflightCheck).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /I have reviewed every field above/ })).toBeChecked(),
    )
    expect(screen.getByRole('button', { name: /Complete & lock/ })).toBeDisabled()
    expect(screen.getByText(/Only the assigned consultant can lock this review/)).toBeInTheDocument()
  })
})

/**
 * Owner, 2026-10-15: "the fields should be editable because some information
 * showing is incorrect." The consultant corrects a value in place; the server
 * persists it to the saved form, re-derives the mappings and un-ticks the
 * category, so the consultant must re-confirm before locking.
 */
describe('PreflightPanel — editing a field before the lock', () => {
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue(MAPPINGS)
    getActivePreflight.mockReset().mockResolvedValue({ ...REVIEW, dates_reviewed: true, final_approval: true })
    editPreflightField.mockReset()
    validatePreflightLock.mockReset()
    startPreflight.mockReset()
    refresh.mockReset()
  })

  it('saves an inline edit and shows the re-derived value with the category un-ticked', async () => {
    editPreflightField.mockResolvedValue({
      mappings: MAPPINGS.map((m) => (m.fieldKey === 'duration_of_stay_days' ? { ...m, mappedValue: '30' } : m)),
      review: { ...REVIEW, dates_reviewed: false, final_approval: false },
      formUpdated: true,
      provenanceUpdated: false,
    })
    render(<PreflightPanel applicationId="app-1" />)

    expect(await screen.findByRole('checkbox', { name: /Dates/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Edit duration_of_stay_days' }))
    const input = screen.getByRole('textbox', { name: 'New value for duration_of_stay_days' })
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(editPreflightField).toHaveBeenCalledWith('t', 'app-1', 'duration_of_stay_days', '30', undefined),
    )
    expect(await screen.findByText('30')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Dates/ })).not.toBeChecked()
    expect(refresh).toHaveBeenCalled() // the extracted-fields table re-renders too
  })

  it('surfaces a refused edit and keeps the old value', async () => {
    editPreflightField.mockRejectedValue(new Error('The pre-submission review is locked'))
    render(<PreflightPanel applicationId="app-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit duration_of_stay_days' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New value for duration_of_stay_days' }), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/review is locked/)).toBeInTheDocument()
    // the draft stays open for a retry; cancelling shows the unchanged value
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('62')).toBeInTheDocument()
  })
})

describe('PreflightPanel — a locked review', () => {
  const LOCKED = {
    ...REVIEW,
    status: 'completed',
    locked_diff_hash: 'lh',
    passport_reviewed: true,
    dates_reviewed: true,
    travel_history_reviewed: true,
    addresses_reviewed: true,
    employment_reviewed: true,
    final_approval: true,
  }
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue(MAPPINGS)
    getActivePreflight.mockReset().mockResolvedValue(LOCKED)
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
    startPreflight.mockReset()
  })

  it('offers no field edits while locked, but a way to start a new review', async () => {
    render(<PreflightPanel applicationId="app-1" />)
    expect(await screen.findByText('Locked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start a new review/ })).toBeInTheDocument()
  })

  it('re-checks the lock on load and says when a later change broke it', async () => {
    validatePreflightLock.mockResolvedValue({ valid: false, reasons: ['provenance_or_mapping_changed'] })
    render(<PreflightPanel applicationId="app-1" />)
    expect(await screen.findByText(/changed since this review was locked/i)).toBeInTheDocument()
    expect(validatePreflightLock).toHaveBeenCalledWith('t', 'app-1', 'r-1', MAPPINGS)
    // Live 2026-10-19: the badge still read "Locked" over the new values.
    expect(screen.getByText('Lock out of date')).toBeInTheDocument()
    expect(screen.queryByText('Locked')).not.toBeInTheDocument()
  })

  // Dry run 2026-10-18: a native confirm() blocked automation and was easy to
  // miss. The question is asked in the page now.
  it('starting a new review asks in the page (no window.confirm), then opens an editable review', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    startPreflight.mockResolvedValue({ ...REVIEW, id: 'r-2' })
    render(<PreflightPanel applicationId="app-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Start a new review/ }))
    expect(startPreflight).not.toHaveBeenCalled()
    const ask = screen.getByRole('group', { name: /current lock is retired/ })
    const yes = screen.getByRole('button', { name: 'Yes, start a new review' })
    expect(ask).toContainElement(yes)
    expect(yes).toHaveFocus()
    fireEvent.click(yes)
    await waitFor(() => expect(startPreflight).toHaveBeenCalledWith('t', 'app-1', MAPPINGS))
    expect(await screen.findByRole('button', { name: 'Edit duration_of_stay_days' })).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('cancelling the new-review question keeps the lock', async () => {
    render(<PreflightPanel applicationId="app-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Start a new review/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(startPreflight).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Start a new review/ })).toHaveFocus()
  })
})


// Live 2026-10-21: an admin (not the assignee) pressed "Start a new review"
// and nothing happened. The UI now follows the API: admins and assignees may
// start; anyone else sees the buttons disabled with the reason.
describe('PreflightPanel — who may run the review', () => {
  const LOCKED = { ...REVIEW, status: 'completed', locked_diff_hash: 'lh' }
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue(MAPPINGS)
    getActivePreflight.mockReset().mockResolvedValue(LOCKED)
    validatePreflightLock.mockReset().mockResolvedValue({ valid: true, reasons: [] })
    startPreflight.mockReset()
  })

  // Review of b196f0c0: in review, the server's can_lock decides.
  it('the admin note is not shown on an open review the admin may lock', async () => {
    getActivePreflight.mockResolvedValue({ ...REVIEW, can_lock: true })
    render(<PreflightPanel applicationId="app-1" viewerIsAdmin />)
    await screen.findByRole('button', { name: /Complete & lock/ })
    expect(screen.queryByText(/only the\s+assigned consultant can lock it/)).not.toBeInTheDocument()
  })

  it('a viewer the API would refuse: Start a new review is disabled, with the reason', async () => {
    render(<PreflightPanel applicationId="app-1" canReview={false} />)
    expect(await screen.findByText(/Only the assigned consultant \(or an admin\) can run/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start a new review/ })).toBeDisabled()
  })

  it('no review yet: Start review is disabled for that viewer too', async () => {
    getActivePreflight.mockResolvedValue(null)
    render(<PreflightPanel applicationId="app-1" canReview={false} />)
    expect(await screen.findByRole('button', { name: 'Start review' })).toBeDisabled()
  })

  it('an admin who is not the assignee may start, and is told only the assignee can lock', async () => {
    startPreflight.mockResolvedValue({ ...REVIEW, id: 'r-2' })
    render(<PreflightPanel applicationId="app-1" viewerIsAdmin />)
    expect(await screen.findByText(/only the\s+assigned consultant can lock it/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Start a new review/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start a new review' }))
    await waitFor(() => expect(startPreflight).toHaveBeenCalledWith('t', 'app-1', MAPPINGS))
  })

  it('values that did not load: the panel says so (no silent Start)', async () => {
    getPreflightMappings.mockRejectedValue(new Error('down'))
    render(<PreflightPanel applicationId="app-1" />)
    expect(await screen.findByText('down')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument()
    expect(startPreflight).not.toHaveBeenCalled()
  })
})

describe('PreflightPanel — values moved before the lock', () => {
  it('shows the refusal and reloads the current values and checks', async () => {
    const ALL = {
      ...REVIEW,
      passport_reviewed: true, dates_reviewed: true, travel_history_reviewed: true,
      addresses_reviewed: true, employment_reviewed: true, final_approval: true,
    }
    getPreflightMappings.mockReset().mockResolvedValueOnce(MAPPINGS).mockResolvedValueOnce(
      MAPPINGS.map((m) => (m.fieldKey === 'duration_of_stay_days' ? { ...m, mappedValue: '70' } : m)),
    )
    getActivePreflight.mockReset().mockResolvedValueOnce(ALL).mockResolvedValueOnce({ ...ALL, dates_reviewed: false, final_approval: false })
    completePreflight.mockReset().mockRejectedValue(new Error('The values changed since you reviewed them.'))
    render(<PreflightPanel applicationId="app-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Complete & lock/ }))
    expect(await screen.findByText(/values changed since you reviewed/)).toBeInTheDocument()
    expect(await screen.findByText('70')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Dates/ })).not.toBeChecked()
  })
})

/**
 * #31 (dry run 2026-10-14): a correction in the Fields table reset a check on
 * the server, but this panel kept showing it ticked — and Complete & lock
 * stayed disabled with no explanation.
 */
describe('PreflightPanel — after a correction elsewhere on the page', () => {
  beforeEach(() => {
    getPreflightMappings.mockReset().mockResolvedValue(MAPPINGS)
    getActivePreflight.mockReset()
  })

  it('re-reads the review when another panel changes a reviewed value', async () => {
    getActivePreflight.mockResolvedValueOnce({
      ...REVIEW,
      passport_reviewed: true,
      dates_reviewed: true,
      travel_history_reviewed: true,
      addresses_reviewed: true,
      employment_reviewed: true,
      final_approval: true,
    })
    render(<PreflightPanel applicationId="app-1" />)
    const passport = await screen.findByRole('checkbox', { name: /Passport/ })
    expect(passport).toBeChecked()

    // the server reset the passport check and the final approval
    getActivePreflight.mockResolvedValue({
      ...REVIEW,
      dates_reviewed: true,
      travel_history_reviewed: true,
      addresses_reviewed: true,
      employment_reviewed: true,
    })
    window.dispatchEvent(new CustomEvent('visaai:preflight-changed', { detail: { applicationId: 'app-1' } }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Passport/ })).not.toBeChecked())
  })

  it('ignores a change to a different application', async () => {
    getActivePreflight.mockResolvedValue(REVIEW)
    render(<PreflightPanel applicationId="app-1" />)
    await screen.findByRole('checkbox', { name: /Passport/ })
    const calls = getActivePreflight.mock.calls.length
    window.dispatchEvent(new CustomEvent('visaai:preflight-changed', { detail: { applicationId: 'other' } }))
    await new Promise((r) => setTimeout(r, 20))
    expect(getActivePreflight.mock.calls.length).toBe(calls)
  })

  it('says why Complete & lock is disabled', async () => {
    getActivePreflight.mockResolvedValue({
      ...REVIEW,
      passport_reviewed: true,
      travel_history_reviewed: true,
      addresses_reviewed: true,
      employment_reviewed: true,
    })
    render(<PreflightPanel applicationId="app-1" />)
    expect(await screen.findByRole('button', { name: 'Complete & lock' })).toBeDisabled()
    const why = screen.getByText(/Complete & lock unlocks once you tick/)
    expect(why.textContent).toMatch(/Dates/)
    expect(why.textContent).toMatch(/I have reviewed every field above/)
    expect(why.textContent).not.toMatch(/Passport/)
  })
})
