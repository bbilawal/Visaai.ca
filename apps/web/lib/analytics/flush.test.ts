import { describe, it, expect } from 'vitest';
import { EventBuffer, type ClientEvent } from './flush';

function makeEvent(name: string): ClientEvent {
  return {
    event_id: name,
    name,
    occurred_at: new Date().toISOString(),
    anonymous_id: null,
    session_id: null,
    props: {},
  };
}

describe('EventBuffer', () => {
  it('caps size and drains', () => {
    const buf = new EventBuffer(2);
    buf.add(makeEvent('a'));
    buf.add(makeEvent('b'));
    buf.add(makeEvent('c')); // over cap → oldest dropped
    const out = buf.drain();
    expect(out.length).toBe(2);
    expect(out.map((e) => e.name)).toEqual(['b', 'c']);
    expect(buf.drain().length).toBe(0);
  });
});
