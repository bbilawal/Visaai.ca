import { BadRequestException } from '@nestjs/common';
import { FinancialOpsController } from './financial-ops.controller';

const user = { id: 'admin1' } as any;
function ctl() {
  const refunds = {
    initiateRefund: jest.fn().mockResolvedValue({ id: 'ref_1' }),
  } as any;
  const disputes = {
    listDisputes: jest.fn().mockResolvedValue([{ id: 'd1' }]),
  } as any;
  const reports = {
    report: jest.fn().mockResolvedValue({ summary: { netCents: 34900 } }),
  } as any;
  return {
    c: new FinancialOpsController(refunds, disputes, reports),
    refunds,
    reports,
  };
}

describe('FinancialOpsController', () => {
  it('refund delegates with admin id', async () => {
    const { c, refunds } = ctl();
    await c.refund('pay_1', user, { amountCents: 5000, reason: 'x' });
    expect(refunds.initiateRefund).toHaveBeenCalledWith(
      'pay_1',
      'admin1',
      5000,
      'x',
    );
  });

  it('revenue requires from + to', () => {
    const { c } = ctl();
    expect(() => c.revenue('', '', undefined)).toThrow(BadRequestException);
  });

  it('revenue delegates with dimension', async () => {
    const { c, reports } = ctl();
    await c.revenue('2026-01-01', '2027-01-01', 'country');
    expect(reports.report).toHaveBeenCalledWith(
      '2026-01-01',
      '2027-01-01',
      'country',
    );
  });
});
