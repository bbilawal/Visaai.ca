import { firstValueFrom } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import {
  MessagingEventBus,
  isRecipient,
} from '../src/modules/messaging/messaging-event-bus';
import type { MessagingBusEvent } from '../src/modules/messaging/messaging.types';

const evt = (over: Partial<MessagingBusEvent> = {}): MessagingBusEvent => ({
  type: 'message.created',
  conversation_id: 'c1',
  application_id: 'a1',
  recipient_ids: ['u-consultant'],
  timestamp: '2026-06-12T00:00:00.000Z',
  ...over,
});

describe('MessagingEventBus', () => {
  it('isRecipient is true only for listed recipients', () => {
    expect(isRecipient(evt(), 'u-consultant')).toBe(true);
    expect(isRecipient(evt(), 'u-other')).toBe(false);
  });

  it('emit defaults the timestamp and forwards to subscribers', async () => {
    const bus = new MessagingEventBus();
    const collected = firstValueFrom(bus.events.pipe(take(1), toArray()));
    bus.emit({
      type: 'message.created',
      conversation_id: 'c1',
      application_id: 'a1',
      recipient_ids: ['u2'],
    });
    const [e] = await collected;
    expect(e.conversation_id).toBe('c1');
    expect(typeof e.timestamp).toBe('string');
  });
});
