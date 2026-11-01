import { MessagingSseController } from '../src/modules/messaging/messaging-sse.controller';
import {
  MessagingPresenceService,
  MAX_SSE_CONNECTIONS_PER_USER,
} from '../src/modules/messaging/messaging-presence.service';
import { MessagingEventBus } from '../src/modules/messaging/messaging-event-bus';
import type { MessagingService } from '../src/modules/messaging/messaging.service';

function makeCtrl() {
  const presence = new MessagingPresenceService();
  const bus = new MessagingEventBus();
  // Stub the service — the controller fires markDeliveredOnConnect on subscribe.
  const svc = {
    markDeliveredOnConnect: jest.fn().mockResolvedValue(undefined),
  } as unknown as MessagingService;
  return { ctrl: new MessagingSseController(bus, presence, svc), presence };
}

describe('MessagingSseController presence wiring', () => {
  it('connects on subscribe and disconnects on teardown', () => {
    const { ctrl, presence } = makeCtrl();
    const obs = ctrl.stream({ id: 'u1' } as never);
    expect(presence.isOnline('u1')).toBe(false); // cold until subscribed
    const sub = obs.subscribe();
    expect(presence.isOnline('u1')).toBe(true);
    sub.unsubscribe();
    expect(presence.isOnline('u1')).toBe(false);
  });

  it('rejects the (cap+1)-th concurrent stream with an error and takes no extra slot', () => {
    const { ctrl, presence } = makeCtrl();
    const subs = [];
    for (let i = 0; i < MAX_SSE_CONNECTIONS_PER_USER; i++) {
      subs.push(ctrl.stream({ id: 'u1' } as never).subscribe());
    }
    let errored = false;
    const over = ctrl.stream({ id: 'u1' } as never).subscribe({
      error: () => {
        errored = true;
      },
    });
    expect(errored).toBe(true);
    // The rejected attempt took no slot — tryConnect is now at the cap, still refusing.
    expect(presence.tryConnect('u1')).toBe(false);
    over.unsubscribe();
    subs.forEach((s) => s.unsubscribe());
    expect(presence.isOnline('u1')).toBe(false);
  });
});
