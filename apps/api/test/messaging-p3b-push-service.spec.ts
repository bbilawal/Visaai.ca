import { PushSubscriptionService } from '../src/modules/notifications/push-subscription.service';

function deps() {
  const repo = {
    upsert: jest.fn().mockResolvedValue({ id: 's1' }),
    listForUser: jest.fn().mockResolvedValue([]),
    deleteByEndpoint: jest.fn().mockResolvedValue(undefined),
  };
  const forUserClient = { __forUser: true };
  const supabase = { forUser: jest.fn().mockReturnValue(forUserClient) };
  return { repo, supabase, forUserClient };
}

describe('PushSubscriptionService', () => {
  it('subscribe upserts with the caller id + forUser client', async () => {
    const d = deps();
    const svc = new PushSubscriptionService(d.repo, d.supabase as never);
    await svc.subscribe(
      'tok',
      { id: 'u1' },
      { endpoint: 'https://x', p256dh: 'p', auth: 'a', userAgent: 'UA' },
    );
    expect(d.supabase.forUser).toHaveBeenCalledWith('tok');
    expect(d.repo.upsert).toHaveBeenCalledWith(
      d.forUserClient as never,
      expect.objectContaining({
        userId: 'u1',
        endpoint: 'https://x',
        userAgent: 'UA',
      }),
    );
  });

  it('unsubscribe deletes by endpoint via forUser client', async () => {
    const d = deps();
    const svc = new PushSubscriptionService(d.repo, d.supabase as never);
    await svc.unsubscribe('tok', { id: 'u1' }, 'https://x');
    expect(d.repo.deleteByEndpoint).toHaveBeenCalledWith(
      d.forUserClient as never,
      'https://x',
    );
  });
});
