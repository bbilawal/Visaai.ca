import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardCards } from './dashboard-cards'
import type { ConsultantDashboard } from '@visaai/types'

const labels = {
  assigned: 'Assigned',
  newRequests: 'New requests',
  awaitingReview: 'Awaiting review',
  highPriority: 'High priority',
  today: 'Due today',
  week: 'Due this week',
}

const data: ConsultantDashboard = {
  counts: { assigned: 4, newRequests: 2, awaitingReview: 3, highPriority: 5 },
  workload: { today: 6, week: 7 },
  highPriorityCases: [],
  awaitingReview: [],
}

describe('DashboardCards', () => {
  it('renders all six card labels', () => {
    render(<DashboardCards data={data} labels={labels} />)
    expect(screen.getByText(labels.assigned)).toBeInTheDocument()
    expect(screen.getByText(labels.newRequests)).toBeInTheDocument()
    expect(screen.getByText(labels.awaitingReview)).toBeInTheDocument()
    expect(screen.getByText(labels.highPriority)).toBeInTheDocument()
    expect(screen.getByText(labels.today)).toBeInTheDocument()
    expect(screen.getByText(labels.week)).toBeInTheDocument()
  })

  it('renders all six card values', () => {
    render(<DashboardCards data={data} labels={labels} />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})
