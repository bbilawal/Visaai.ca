import { NotificationsUnsubscribeController } from '../src/modules/notifications/notifications-unsubscribe.controller';
import { unsubToken } from '../src/modules/reminders/unsub';

const SECRET = 'service-role-secret';

function deps() {
  const prefs = { disableEmailByUser: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: (k: string) =>
      k === 'SUPABASE_SERVICE_ROLE_KEY' ? SECRET : undefined,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return { prefs, config, res };
}

describe('NotificationsUnsubscribeController', () => {
  it('valid HMAC token disables email and returns 200', async () => {
    const d = deps();
    const ctrl = new NotificationsUnsubscribeController(
      d.prefs as never,
      d.config as never,
    );
    const token = unsubToken('u1', SECRET);
    await ctrl.unsubscribe('u1', token, d.res as never);
    expect(d.prefs.disableEmailByUser).toHaveBeenCalledWith('u1');
    expect(d.res.status).toHaveBeenCalledWith(200);
  });

  it('invalid token is rejected with 400 and does not disable email', async () => {
    const d = deps();
    const ctrl = new NotificationsUnsubscribeController(
      d.prefs as never,
      d.config as never,
    );
    await ctrl.unsubscribe(
      'u1',
      'not-the-real-token-aaaaaaaaaaaaaa',
      d.res as never,
    );
    expect(d.prefs.disableEmailByUser).not.toHaveBeenCalled();
    expect(d.res.status).toHaveBeenCalledWith(400);
  });

  it('a valid-length token for a different user is rejected', async () => {
    const d = deps();
    const ctrl = new NotificationsUnsubscribeController(
      d.prefs as never,
      d.config as never,
    );
    // token computed for u2, but path userId is u1 → mismatch
    const wrong = unsubToken('u2', SECRET);
    await ctrl.unsubscribe('u1', wrong, d.res as never);
    expect(d.prefs.disableEmailByUser).not.toHaveBeenCalled();
    expect(d.res.status).toHaveBeenCalledWith(400);
  });
});
