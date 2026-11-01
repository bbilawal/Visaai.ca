import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const initiateRefund = vi.fn().mockResolvedValue({ id: 'ref_1' })
const refresh = vi.fn()
vi.mock('@/lib/api/admin-billing-client', () => ({ initiateRefund: (...a: unknown[]) => initiateRefund(...a) }))
vi.mock('@/lib/supabase/client', () => ({
  getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }),
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

import { RefundForm } from './refund-form'

const labels = {
  refundTitle: 'Refund', paymentId: 'Payment ID', amountOptional: 'Amount', reason: 'Reason',
  issueRefund: 'Issue refund', refundOk: 'Done', error: 'Error',
}

describe('RefundForm', () => {
  beforeEach(() => initiateRefund.mockClear())

  it('submits with payment id + amount in cents + reason', async () => {
    render(<RefundForm labels={labels} />)
    await userEvent.type(screen.getByLabelText('Payment ID'), 'pi_1')
    await userEvent.type(screen.getByLabelText('Amount'), '349')
    await userEvent.type(screen.getByLabelText('Reason'), 'dup')
    await userEvent.click(screen.getByRole('button', { name: 'Issue refund' }))
    expect(initiateRefund).toHaveBeenCalledWith('tok', 'pi_1', 34900, 'dup')
  })

  it('blank amount → undefined (full refund)', async () => {
    render(<RefundForm labels={labels} />)
    await userEvent.type(screen.getByLabelText('Payment ID'), 'pi_2')
    await userEvent.click(screen.getByRole('button', { name: 'Issue refund' }))
    expect(initiateRefund).toHaveBeenCalledWith('tok', 'pi_2', undefined, undefined)
  })
})
