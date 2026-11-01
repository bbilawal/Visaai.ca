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
    getLastRead: jest.fn().mockResolvedValue('2026-01-01T00:00:02Z'),
    countUnread: jest.fn().mockResolvedValue(2),
    ...over,
  } as unknown as IMessagingRepository;
}

const supabase = { forUser: () => ({}), admin: { __admin: true } } as never;

describe('MessagingService.unreadCountForRecipient', () => {
  it('delegates to getLastRead + countUnread with the admin client and watermark', async () => {
    const repo = repoMock();
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    const n = await svc.unreadCountForRecipient('app-1', 'me');
    expect(n).toBe(2);
    expect(repo.getLastRead).toHaveBeenCalledWith(
      { __admin: true },
      'c1',
      'me',
    );
    expect(repo.countUnread).toHaveBeenCalledWith(
      { __admin: true },
      'c1',
      'me',
      '2026-01-01T00:00:02Z',
    );
  });

  it('passes a null watermark through to countUnread', async () => {
    const repo = repoMock({ getLastRead: jest.fn().mockResolvedValue(null) });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    await svc.unreadCountForRecipient('app-1', 'me');
    expect(repo.countUnread).toHaveBeenCalledWith(
      { __admin: true },
      'c1',
      'me',
      null,
    );
  });

  it('returns 0 without counting when no conversation exists', async () => {
    const repo = repoMock({
      getConversationByApplication: jest.fn().mockResolvedValue(null),
    });
    const svc = new MessagingService(repo, new MessagingEventBus(), supabase);
    expect(await svc.unreadCountForRecipient('app-1', 'me')).toBe(0);
    expect(repo.countUnread).not.toHaveBeenCalled();
  });
});
