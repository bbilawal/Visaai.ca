import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardControls } from './dashboard-controls'

const labels = { r7: '7d', r30: '30d', r90: '90d', widgets: 'Widgets', rangeLabel: 'Date range' }
/** The translated card labels — the same map the cards render. */
const widgetLabels = { revenue: 'Completed orders', inProgress: 'Applications in progress' }

describe('DashboardControls', () => {
  it('renders the three range options and fires onRangeChange', async () => {
    const onRange = vi.fn()
    render(
      <DashboardControls
        range="30d"
        onRangeChange={onRange}
        widgets={{ revenue: true }}
        widgetLabels={widgetLabels}
        onToggleWidget={vi.fn()}
        labels={labels}
      />,
    )
    await userEvent.click(screen.getByText('7d'))
    expect(onRange).toHaveBeenCalledWith('7d')
  })

  it('names the range button group for assistive tech', () => {
    render(
      <DashboardControls
        range="30d"
        onRangeChange={vi.fn()}
        widgets={{ revenue: true }}
        widgetLabels={widgetLabels}
        onToggleWidget={vi.fn()}
        labels={labels}
      />,
    )
    expect(screen.getByRole('group', { name: 'Date range' })).toBeInTheDocument()
  })

  it('marks the active range with aria-pressed', () => {
    render(
      <DashboardControls
        range="90d"
        onRangeChange={vi.fn()}
        widgets={{ revenue: true }}
        widgetLabels={widgetLabels}
        onToggleWidget={vi.fn()}
        labels={labels}
      />,
    )
    expect(screen.getByText('90d')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('7d')).toHaveAttribute('aria-pressed', 'false')
  })

  it('fires onToggleWidget when a widget checkbox changes', async () => {
    const onToggle = vi.fn()
    render(
      <DashboardControls
        range="30d"
        onRangeChange={vi.fn()}
        widgets={{ revenue: true }}
        widgetLabels={widgetLabels}
        onToggleWidget={onToggle}
        labels={labels}
      />,
    )
    await userEvent.click(screen.getByLabelText('Completed orders'))
    expect(onToggle).toHaveBeenCalledWith('revenue')
  })

  it('labels each widget toggle with its translated card name, never the raw key (UI-001)', () => {
    render(
      <DashboardControls
        range="30d"
        onRangeChange={vi.fn()}
        widgets={{ revenue: true, inProgress: true }}
        widgetLabels={widgetLabels}
        onToggleWidget={vi.fn()}
        labels={labels}
      />,
    )
    expect(screen.getByLabelText('Applications in progress')).toBeInTheDocument()
    // The camelCase internals must not reach the page — this is what a
    // production admin was shown next to each checkbox.
    expect(screen.queryByText('inProgress')).not.toBeInTheDocument()
    expect(screen.queryByText('revenue')).not.toBeInTheDocument()
  })

  it('falls back to the key when a widget has no translated label', () => {
    render(
      <DashboardControls
        range="30d"
        onRangeChange={vi.fn()}
        widgets={{ unmapped: true }}
        widgetLabels={widgetLabels}
        onToggleWidget={vi.fn()}
        labels={labels}
      />,
    )
    expect(screen.getByLabelText('unmapped')).toBeInTheDocument()
  })
})
