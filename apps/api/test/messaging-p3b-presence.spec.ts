import { MessagingPresenceService } from '../src/modules/messaging/messaging-presence.service';

describe('MessagingPresenceService', () => {
  it('offline by default', () => {
    expect(new MessagingPresenceService().isOnline('u1')).toBe(false);
  });

  it('online after connect, offline after matching disconnect', () => {
    const p = new MessagingPresenceService();
    p.tryConnect('u1');
    expect(p.isOnline('u1')).toBe(true);
    p.disconnect('u1');
    expect(p.isOnline('u1')).toBe(false);
  });

  it('refcounts multiple connections (online until last disconnect)', () => {
    const p = new MessagingPresenceService();
    p.tryConnect('u1');
    p.tryConnect('u1');
    p.disconnect('u1');
    expect(p.isOnline('u1')).toBe(true);
    p.disconnect('u1');
    expect(p.isOnline('u1')).toBe(false);
  });

  it('disconnect below zero never goes negative', () => {
    const p = new MessagingPresenceService();
    p.disconnect('u1');
    expect(p.isOnline('u1')).toBe(false);
    p.tryConnect('u1');
    expect(p.isOnline('u1')).toBe(true);
  });
});
