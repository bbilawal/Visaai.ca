import { MessagingService } from '../src/modules/messaging/messaging.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { IMessagingRepository } from '../src/modules/messaging/messaging.repository';

const conv = {
  id: 'c1',
  application_id: 'app-1',
  status: 'open',
  consultant_state: null,
  last_message_at: null,
  created_at: 't',
};

function repoMock(
  over: Partial<IMessagingRepository> = {},
): IMessagingRepository {
  return {
    getConversationByApplication: jest.fn().mockResolvedValue(conv),
    advanceLastRead: jest.fn().mockResolvedValue(undefined),
    getApplicationParties: jest
      .fn()
      .mockResolvedValue({ ownerId: 'me', consultantIds: ['other'] }),
    ...over,
  } as unknown as IMessagingRepository;
}
const supabase = { forUser: () => ({}), admin: { __admin: true } } as never;

describe('MessagingService.markRead emits message.read', () => {
  it('advances the watermark and emits message.read to the other parties', async () => {
    const bus = new MessagingEventBus();
    const events: { type: string; recipient_ids: string[] }[] = [];
    bus.events.subscribe((e) =>
      events.push({ type: e.type, recipient_ids: e.recipient_ids }),
    );
    const repo = repoMock();
    const svc = new MessagingService(repo, bus, supabase);
    await svc.markRead('tok', { id: 'me', appRole: 'user' }, 'app-1');
    expect(repo.advanceLastRead).toHaveBeenCalled();
    const read = events.find((e) => e.type === 'message.read');
    expect(read).toBeDefined();
    expect(read!.recipient_ids).toEqual(['other']);
  });

  it('no-op (no emit) when no conversation exists', async () => {
    const bus = new MessagingEventBus();
    const events: string[] = [];
    bus.events.subscribe((e) => events.push(e.type));
    const repo = repoMock({
      getConversationByApplication: jest.fn().mockResolvedValue(null),
    });
    const svc = new MessagingService(repo, bus, supabase);
    await svc.markRead('tok', { id: 'me', appRole: 'user' }, 'app-1');
    expect(events).not.toContain('message.read');
  });
});
