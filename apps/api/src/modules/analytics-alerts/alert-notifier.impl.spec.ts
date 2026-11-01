import { SpineAlertNotifier } from './alert-notifier.impl';

describe('SpineAlertNotifier', () => {
  it('emits a system.broadcast per user id', async () => {
    const notifications = {
      emit: jest.fn().mockResolvedValue(undefined),
    } as any;
    const n = new SpineAlertNotifier(notifications);
    await n.fire({
      ruleId: 'a1',
      title: 'Alert',
      message: 'breached',
      userIds: ['u1', 'u2'],
    });
    expect(notifications.emit).toHaveBeenCalledTimes(2);
    expect(notifications.emit.mock.calls[0][0]).toMatchObject({
      type: 'system.broadcast',
      userId: 'u1',
      data: expect.objectContaining({
        link: '/analytics/alerts/a1',
        category: 'system',
      }),
    });
  });
  it('never throws when emit fails', async () => {
    const notifications = {
      emit: jest.fn().mockRejectedValue(new Error('down')),
    } as any;
    const n = new SpineAlertNotifier(notifications);
    await expect(
      n.fire({ ruleId: 'a1', title: 'A', message: 'm', userIds: ['u1'] }),
    ).resolves.toBeUndefined();
  });
});
