import { NotificationPreferenceService } from '../src/modules/notifications/notification-preference.service';

function deps() {
  const repo = {
    getForUser: jest.fn().mockResolvedValue({
      user_id: 'u1',
      email_enabled: true,
      push_enabled: true,
      updated_at: 't',
    }),
    upsert: jest.fn().mockResolvedValue({
      user_id: 'u1',
      email_enabled: false,
      push_enabled: true,
      updated_at: 't',
    }),
    disableEmail: jest.fn().mockResolvedValue(undefined),
  };
  const forUserClient = { __forUser: true };
  const adminClient = { __admin: true };
  const supabase = {
    forUser: jest.fn().mockReturnValue(forUserClient),
    admin: adminClient,
  };
  return { repo, supabase, forUserClient, adminClient };
}

describe('NotificationPreferenceService', () => {
  it('get reads via forUser', async () => {
    const d = deps();
    const svc = new NotificationPreferenceService(d.repo, d.supabase as never);
    await svc.get('tok', { id: 'u1' });
    expect(d.repo.getForUser).toHaveBeenCalledWith(
      d.forUserClient as never,
      'u1',
    );
  });

  it('update upserts the caller id via forUser', async () => {
    const d = deps();
    const svc = new NotificationPreferenceService(d.repo, d.supabase as never);
    const out = await svc.update('tok', { id: 'u1' }, { email_enabled: false });
    expect(d.repo.upsert).toHaveBeenCalledWith(d.forUserClient as never, 'u1', {
      email_enabled: false,
    });
    expect(out.email_enabled).toBe(false);
  });

  it('disableEmailByUser uses the admin client (service-role, unsubscribe path)', async () => {
    const d = deps();
    const svc = new NotificationPreferenceService(d.repo, d.supabase as never);
    await svc.disableEmailByUser('u1');
    expect(d.repo.disableEmail).toHaveBeenCalledWith(
      d.adminClient as never,
      'u1',
    );
  });
});
