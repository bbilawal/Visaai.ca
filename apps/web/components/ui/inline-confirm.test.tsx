import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { InlineConfirm } from './inline-confirm'

function setup(onConfirm = vi.fn()) {
  render(
    <InlineConfirm
      label="Approve application"
      question="Approve this application?"
      confirmLabel="Yes, approve"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
    />,
  )
  return onConfirm
}

describe('InlineConfirm', () => {
  afterEach(() => vi.restoreAllMocks())

  it('asks in the page, never with window.confirm, and acts only on confirm', () => {
    const native = vi.spyOn(window, 'confirm')
    const onConfirm = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Approve application' }))
    expect(native).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    const group = screen.getByRole('group', { name: 'Approve this application?' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes, approve' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, approve' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve application' })).toHaveFocus()
  })

  it('Cancel puts the trigger back, focused, without acting', () => {
    const onConfirm = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Approve application' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Approve application' })).toHaveFocus()
  })

  it('Escape cancels too', () => {
    const onConfirm = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Approve application' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Yes, approve' }), { key: 'Escape' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve application' })).toHaveFocus()
  })

  it('when confirm makes the action busy, focus parks on the component (not <body>) and returns after', () => {
    let finish: () => void = () => {}
    function Harness() {
      const [busy, setBusy] = useState(false)
      return (
        <InlineConfirm
          label={busy ? 'Approving…' : 'Approve application'}
          question="Approve this application?"
          confirmLabel="Yes, approve"
          cancelLabel="Cancel"
          busy={busy}
          onConfirm={() => {
            setBusy(true)
            finish = () => setBusy(false)
          }}
        />
      )
    }
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve application' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, approve' }))
    const wrapper = container.querySelector('[data-inline-confirm]')
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(document.activeElement).toBe(wrapper)
    expect(document.activeElement).not.toBe(document.body)
    act(() => finish())
    expect(screen.getByRole('button', { name: 'Approve application' })).toHaveFocus()
  })

  it('a disabled or busy trigger cannot be pressed', () => {
    render(
      <InlineConfirm label="Approving…" question="q" confirmLabel="c" cancelLabel="x" onConfirm={vi.fn()} busy />,
    )
    const btn = screen.getByRole('button', { name: 'Approving…' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })
})
