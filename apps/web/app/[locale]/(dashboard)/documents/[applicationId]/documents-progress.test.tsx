/**
 * The "where am I / what next" header that now opens the documents page.
 *
 * The page used to open with government reference material, putting the
 * applicant's own task below the fold. These pin the replacement: a count, a
 * bar, and exactly ONE next action.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({
  // Echo the key plus any interpolated values, so assertions can see both.
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}))

import { DocumentsProgress } from './documents-progress'

describe('DocumentsProgress', () => {
  it('renders nothing when intake has produced no requirements yet', () => {
    const { container } = render(
      <DocumentsProgress done={0} total={0} nextLabel={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('states the count and names the single next document', () => {
    render(<DocumentsProgress done={2} total={5} nextLabel="Bank statement" />)
    expect(screen.getByText('progressCount:2,5')).toBeInTheDocument()
    expect(screen.getByText('nextUpload:Bank statement')).toBeInTheDocument()
  })

  it('confirms completion instead of naming a next step', () => {
    render(<DocumentsProgress done={3} total={3} nextLabel={null} />)
    expect(screen.getByText('allVerified')).toBeInTheDocument()
    expect(screen.queryByText(/^nextUpload/)).not.toBeInTheDocument()
  })

  it('keeps the count readable as text, not only as a bar', () => {
    // The bar is aria-hidden decoration; a screen reader must still get the
    // progress from the sentence.
    const { container } = render(
      <DocumentsProgress done={1} total={4} nextLabel="Passport" />,
    )
    expect(container.querySelector('[aria-hidden]')).toBeTruthy()
    expect(screen.getByText('progressCount:1,4')).toBeInTheDocument()
  })
})
