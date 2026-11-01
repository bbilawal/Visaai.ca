import {
  MessagingPresenceService,
  MAX_SSE_CONNECTIONS_PER_USER,
} from '../src/modules/messaging/messaging-presence.service';

describe('MessagingPresenceService.tryConnect cap', () => {
  it('grants slots up to the cap, then refuses without incrementing', () => {
    const p = new MessagingPresenceService();
    for (let i = 0; i < MAX_SSE_CONNECTIONS_PER_USER; i++) {
      expect(p.tryConnect('u1')).toBe(true);
    }
    expect(p.isOnline('u1')).toBe(true);
    // At cap: refused.
    expect(p.tryConnect('u1')).toBe(false);
    // Still refused — the rejected attempt took no slot.
    expect(p.tryConnect('u1')).toBe(false);
  });

  it('disconnect frees a slot so a subsequent tryConnect succeeds', () => {
    const p = new MessagingPresenceService();
    for (let i = 0; i < MAX_SSE_CONNECTIONS_PER_USER; i++) p.tryConnect('u1');
    expect(p.tryConnect('u1')).toBe(false);
    p.disconnect('u1');
    expect(p.tryConnect('u1')).toBe(true);
    expect(p.tryConnect('u1')).toBe(false);
  });

  it('isOnline is false after all slots disconnect', () => {
    const p = new MessagingPresenceService();
    p.tryConnect('u1');
    p.tryConnect('u1');
    p.disconnect('u1');
    expect(p.isOnline('u1')).toBe(true);
    p.disconnect('u1');
    expect(p.isOnline('u1')).toBe(false);
  });
});
