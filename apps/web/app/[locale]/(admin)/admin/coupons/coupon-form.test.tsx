import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const createCoupon = vi.fn().mockResolvedValue({ id: 'c1' })
vi.mock('@/lib/api/admin-billing-client', () => ({
  createCoupon: (...a: unknown[]) => createCoupon(...a),
}))
vi.mock('@/lib/supabase/client', () => ({
  getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }),
}))

import { CouponForm } from './coupon-form'

const labels = {
  code: 'Code', kind: 'Type', percent: 'Percent', amountKind: 'Amount',
  percentOff: 'Percent off', amountOff: 'Amount off', appliesTo: 'Applies to',
  maxRedemptions: 'Max', validUntil: 'Valid until', createCoupon: 'Create coupon',
  couponOk: 'Created', error: 'Error',
}

describe('CouponForm', () => {
  beforeEach(() => createCoupon.mockClear())

  it('creates a percent coupon', async () => {
    render(<CouponForm labels={labels} />)
    await userEvent.type(screen.getByLabelText('Code'), 'FAMILY20')
    await userEvent.type(screen.getByLabelText('Percent off'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }))
    expect(createCoupon).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ code: 'FAMILY20', kind: 'percent', percentOff: 20, appliesTo: 'processing_fee' }),
    )
  })

  it('creates an amount coupon (cents)', async () => {
    render(<CouponForm labels={labels} />)
    await userEvent.type(screen.getByLabelText('Code'), 'FLAT10')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'amount')
    await userEvent.type(screen.getByLabelText('Amount off'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Create coupon' }))
    expect(createCoupon).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ code: 'FLAT10', kind: 'amount', amountOffCents: 1000 }),
    )
  })
})
