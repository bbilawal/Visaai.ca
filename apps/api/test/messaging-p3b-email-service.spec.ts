import { NotificationEmailService } from '../src/modules/notifications/notification-email.service';

function deps(
  over: {
    online?: boolean;
    emailEnabled?: boolean;
    unread?: number;
    email?: string | null;
  } = {},
) {
  const presence = {
    isOnline: jest.fn().mockReturnValue(over.online ?? false),
  };
  const prefRepo = {
    getForUser: jest.fn().mockResolvedValue({
      user_id: 'r1',
      email_enabled: over.emailEnabled ?? true,
      push_enabled: true,
      updated_at: 't',
    }),
  };
  const messaging = {
    unreadCountForRecipient: jest.fn().mockResolvedValue(over.unread ?? 2),
  };
  const email = { send: jest.fn().mockResolvedValue(true) };
  // admin client: users + applications maybeSingle reads
  const adminFrom = (table: string) => {
    const data =
      table === 'users'
        ? {
            email: over.email === undefined ? 'r@e.com' : over.email,
            preferred_language: 'en',
          }
        : { destination_country: 'Canada' };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      maybeSingle: () => Promise.resolve({ data, error: null }),
    };
    return api;
  };
  const supabase = { admin: { from: jest.fn(adminFrom) } };
  const config = {
    get: (k: string) =>
      k === 'WEB_URL'
        ? 'https://web'
        : k === 'API_URL'
          ? 'https://api'
          : 'secret',
  };
  return { presence, prefRepo, messaging, email, supabase, config };
}

const job = { conversationId: 'c1', applicationId: 'app-1', recipientId: 'r1' };

describe('NotificationEmailService.sendIfStillUnread', () => {
  it('sends when away + unread + email enabled', async () => {
    const d = deps();
    const svc = new NotificationEmailService(
      d.presence as never,
      d.prefRepo as never,
      d.messaging as never,
      d.email as never,
      d.supabase as never,
      d.config as never,
    );
    await svc.sendIfStillUnread(job);
    expect(d.email.send).toHaveBeenCalledWith(
      'r@e.com',
      expect.stringContaining('2 new'),
      expect.stringContaining('https://web'),
    );
  });

  it('skips when recipient is online', async () => {
    const d = deps({ online: true });
    const svc = new NotificationEmailService(
      d.presence as never,
      d.prefRepo as never,
      d.messaging as never,
      d.email as never,
      d.supabase as never,
      d.config as never,
    );
    await svc.sendIfStillUnread(job);
    expect(d.email.send).not.toHaveBeenCalled();
  });

  it('skips when email disabled', async () => {
    const d = deps({ emailEnabled: false });
    const svc = new NotificationEmailService(
      d.presence as never,
      d.prefRepo as never,
      d.messaging as never,
      d.email as never,
      d.supabase as never,
      d.config as never,
    );
    await svc.sendIfStillUnread(job);
    expect(d.email.send).not.toHaveBeenCalled();
  });

  it('skips when nothing unread', async () => {
    const d = deps({ unread: 0 });
    const svc = new NotificationEmailService(
      d.presence as never,
      d.prefRepo as never,
      d.messaging as never,
      d.email as never,
      d.supabase as never,
      d.config as never,
    );
    await svc.sendIfStillUnread(job);
    expect(d.email.send).not.toHaveBeenCalled();
  });

  it('skips when recipient has no email', async () => {
    const d = deps({ email: null });
    const svc = new NotificationEmailService(
      d.presence as never,
      d.prefRepo as never,
      d.messaging as never,
      d.email as never,
      d.supabase as never,
      d.config as never,
    );
    await svc.sendIfStillUnread(job);
    expect(d.email.send).not.toHaveBeenCalled();
  });
});
