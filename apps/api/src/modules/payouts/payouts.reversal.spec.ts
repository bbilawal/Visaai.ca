import { PayoutsService } from './payouts.service';
import { ConfigService } from '@nestjs/config';

it('handleTransferReversed marks the payout reversed', async () => {
  const markPayoutReversed = jest
    .fn()
    .mockResolvedValue({ reversed: true, consultantId: 'c1' });
  const repo: any = {
    listSweepableOrders: jest.fn(),
    recordPayout: jest.fn(),
    getProfileByUserId: jest.fn(),
    getEarnings: jest.fn(),
    getProfileById: jest.fn(),
    setConnectAccountId: jest.fn(),
    syncKycByAccountId: jest.fn(),
    markPayoutReversed,
  };
  const svc = new PayoutsService(
    repo,
    {} as any,
    new ConfigService({ MIN_PAYOUT_CENTS: 1000 }),
  );
  await svc.handleTransferReversed('tr_1');
  expect(markPayoutReversed).toHaveBeenCalledWith('tr_1');
});
