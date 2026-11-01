import { MessagingService } from '../src/modules/messaging/messaging.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { IMessagingRepository } from '../src/modules/messaging/messaging.repository';

function repoMock(parties: {
  ownerId: string | null;
  consultantIds: string[];
}): IMessagingRepository {
  return {
    getApplicationParties: jest.fn().mockResolvedValue(parties),
  } as unknown as IMessagingRepository;
}
const supabase = { admin: {}, forUser: () => ({}) } as never;

describe('MessagingService.recipientIds (multi-consultant)', () => {
  it('returns owner + all active consultants, minus excludeId', async () => {
    const svc = new MessagingService(
      repoMock({ ownerId: 'owner', consultantIds: ['c1', 'c2'] }),
      new MessagingEventBus(),
      supabase,
    );
    const out = await svc.recipientIds('app', 'c1');
    expect(out.sort()).toEqual(['c2', 'owner']);
  });

  it('owner-only when no consultants', async () => {
    const svc = new MessagingService(
      repoMock({ ownerId: 'owner', consultantIds: [] }),
      new MessagingEventBus(),
      supabase,
    );
    expect(await svc.recipientIds('app', null)).toEqual(['owner']);
  });
});
