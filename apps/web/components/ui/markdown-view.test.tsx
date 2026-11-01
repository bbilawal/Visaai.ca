/**
 * Generated letters are markdown. The consultant review showed them raw, so a
 * reviewer read "**To: Visa Officer**" with the asterisks.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownView } from './markdown-view'

describe('MarkdownView', () => {
  it('renders bold, italics, headings, lists and hard line breaks without the markup', () => {
    const md = [
      '# Proposed Itinerary',
      '',
      '**To: Visa Officer**  ',
      '**Subject:** TRV for *Muzaffar*',
      '',
      '- Day 1: arrive',
      '- Day 2: visit family',
      '',
      '1. First',
      '2. Second',
    ].join('\n')
    const { container } = render(<MarkdownView source={md} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Proposed Itinerary' })).toBeInTheDocument()
    expect(container.querySelector('strong')?.textContent).toBe('To: Visa Officer')
    expect(container.querySelector('em')?.textContent).toBe('Muzaffar')
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.textContent).not.toContain('**')
  })

  it('never injects HTML from the source', () => {
    const { container } = render(<MarkdownView source={'<img src=x onerror="alert(1)"> **hi**'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x')
  })

  // Dry run 2026-10-14 (#7): the itinerary came back as a markdown table and
  // the Generate page showed the pipes and dashes.
  it('renders a pipe table as a real table, with no pipes or dash rows left', () => {
    const md = [
      'Proposed plan:',
      '',
      '| Day | Date | Plan |',
      '|-----|:----:|------|',
      '| 1 | 2026-12-01 | Arrive in **Toronto** |',
      '| 2 | 2026-12-02 | Visit family |',
      '',
      'Return home on 2027-01-31.',
    ].join('\n')
    const { container } = render(<MarkdownView source={md} />)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect([...container.querySelectorAll('th')].map(th => th.textContent)).toEqual(['Day', 'Date', 'Plan'])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector('td strong')?.textContent).toBe('Toronto')
    expect(container.textContent).not.toContain('|')
    expect(container.textContent).not.toContain('---')
    expect(container.textContent).toContain('Return home on 2027-01-31.')
  })

  it('shows link text (not the markdown) and inline code as text', () => {
    const { container } = render(<MarkdownView source={'See [IRCC](https://example.com) and `IMM 5257`.'} />)
    expect(container.textContent).toBe('See IRCC and IMM 5257.')
    expect(container.querySelector('a')).toBeNull()
  })
})

