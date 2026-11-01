import { PORTAL_FILL_PROTOCOL_VERSION } from '@visaai/types';
import type { PortalFillFieldResult, SignedWriteIntent } from '@visaai/types';
import {
  SocketExtensionTransport,
  PORTAL_FILL_WRITE_EVENT,
  type ExtensionSocket,
} from '../src/modules/portal-fill/socket-extension.transport';

const EXEC = 'exec-1';

function intent(overrides: Partial<SignedWriteIntent> = {}): SignedWriteIntent {
  return {
    executionId: EXEC,
    fieldKey: 'given_name',
    selector: '#givenName',
    mappedValue: 'Ada',
    expectedValueHash: 'vh:ada',
    category: 'identity' as SignedWriteIntent['category'],
    lockedDiffHash: 'lock-1',
    sig: 'sig-abc',
    ...overrides,
  };
}

function reply(
  overrides: Partial<PortalFillFieldResult> = {},
): PortalFillFieldResult {
  return {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'field_result',
    executionId: EXEC,
    fieldKey: 'given_name',
    outcome: 'verified',
    actualValueHash: 'vh:ada',
    selectorFound: true,
    ...overrides,
  };
}

/** Socket double that captures the emitted command and replies with `ack`. */
class FakeSocket implements ExtensionSocket {
  sent: Array<{ event: string; payload: unknown }> = [];
  constructor(
    readonly id: string,
    private ackWith: unknown = reply(),
    private mode: 'ack' | 'silent' | 'throw' = 'ack',
  ) {}
  emit(event: string, payload: unknown, ack: (raw: unknown) => void) {
    this.sent.push({ event, payload });
    if (this.mode === 'throw') throw new Error('socket closed');
    if (this.mode === 'ack') ack(this.ackWith);
    return true;
  }
}

describe('SocketExtensionTransport', () => {
  it('fails closed when the execution has no bound socket — never broadcasts', async () => {
    const t = new SocketExtensionTransport();
    const res = await t.send(intent());
    expect(res).toEqual({
      fieldKey: 'given_name',
      outcome: 'failed',
      reason: 'transport_error',
      selectorFound: false,
    });
  });

  it('only ever emits to the socket bound to that execution', async () => {
    const t = new SocketExtensionTransport();
    const mine = new FakeSocket('s-mine');
    const other = new FakeSocket('s-other');
    t.bind(EXEC, mine);
    t.bind('exec-other', other);

    await t.send(intent());

    expect(mine.sent).toHaveLength(1);
    expect(other.sent).toHaveLength(0);
  });

  it('sends the least-authority wire shape — sig, lockedDiffHash and category never leave the server', async () => {
    const t = new SocketExtensionTransport();
    const sock = new FakeSocket('s1');
    t.bind(EXEC, sock);

    await t.send(intent());

    const { event, payload } = sock.sent[0];
    expect(event).toBe(PORTAL_FILL_WRITE_EVENT);
    expect(payload).toEqual({
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'write',
      executionId: EXEC,
      fieldKey: 'given_name',
      selector: '#givenName',
      mappedValue: 'Ada',
      expectedValueHash: 'vh:ada',
    });
    expect(payload).not.toHaveProperty('sig');
    expect(payload).not.toHaveProperty('lockedDiffHash');
    expect(payload).not.toHaveProperty('category');
  });

  it('carries how the target is operated (op / reveal / dialog) on the wire', async () => {
    const t = new SocketExtensionTransport();
    const sock = new FakeSocket('s1');
    t.bind(EXEC, sock);

    await t.send(intent({ op: 'radio', reveal: true, dialog: true }));

    expect(sock.sent[0].payload).toMatchObject({
      op: 'radio',
      reveal: true,
      dialog: true,
    });
    await t.send(intent({ fieldKey: 'other' }));
    expect(sock.sent[1].payload).not.toHaveProperty('op');
    expect(sock.sent[1].payload).not.toHaveProperty('reveal');
  });

  it('passes a well-formed verified reply through', async () => {
    const t = new SocketExtensionTransport();
    t.bind(EXEC, new FakeSocket('s1', reply()));

    await expect(t.send(intent())).resolves.toEqual({
      fieldKey: 'given_name',
      outcome: 'verified',
      reason: undefined,
      actualValueHash: 'vh:ada',
      selectorFound: true,
    });
  });

  it.each([
    ['a reply for a different execution', reply({ executionId: 'exec-999' })],
    ['a reply for a different field', reply({ fieldKey: 'surname' })],
    ['a non-field_result kind', reply({ kind: 'write' as 'field_result' })],
    ['a bogus outcome', reply({ outcome: 'ok' as 'verified' })],
    ['a non-object reply', 'nope'],
    ['a null reply', null],
  ])('rejects %s as transport_error', async (_label, ack) => {
    const t = new SocketExtensionTransport();
    t.bind(EXEC, new FakeSocket('s1', ack));

    const res = await t.send(intent());
    expect(res.outcome).toBe('failed');
    expect(res.reason).toBe('transport_error');
  });

  it('treats an incompatible protocol as dom_change, not silent success', async () => {
    const t = new SocketExtensionTransport();
    t.bind(EXEC, new FakeSocket('s1', reply({ protocol: 99 })));

    const res = await t.send(intent());
    expect(res).toMatchObject({ outcome: 'failed', reason: 'dom_change' });
  });

  it('never throws when the socket throws on emit', async () => {
    const t = new SocketExtensionTransport();
    t.bind(EXEC, new FakeSocket('s1', undefined, 'throw'));

    await expect(t.send(intent())).resolves.toMatchObject({
      outcome: 'failed',
      reason: 'transport_error',
    });
  });

  it('unbindSocket drops every execution held by that socket', async () => {
    const t = new SocketExtensionTransport();
    const sock = new FakeSocket('s1');
    t.bind(EXEC, sock);
    t.bind('exec-2', sock);
    expect(t.isBound(EXEC)).toBe(true);

    t.unbindSocket(sock);

    expect(t.isBound(EXEC)).toBe(false);
    expect(t.isBound('exec-2')).toBe(false);
  });

  it('unbindSocket leaves other sockets bound', () => {
    const t = new SocketExtensionTransport();
    t.bind(EXEC, new FakeSocket('s1'));
    t.bind('exec-2', new FakeSocket('s2'));

    t.unbindSocket(new FakeSocket('s1'));

    expect(t.isBound(EXEC)).toBe(false);
    expect(t.isBound('exec-2')).toBe(true);
  });

  it('a duplicate ack cannot re-resolve the same send', async () => {
    const t = new SocketExtensionTransport();
    let captured: ((raw: unknown) => void) | null = null;
    t.bind(EXEC, {
      id: 's1',
      emit: (_e, _p, ack) => {
        captured = ack;
        ack(reply());
        return true;
      },
    });

    const res = await t.send(intent());
    expect(res.outcome).toBe('verified');
    // A late second ack must not throw or change anything already settled.
    expect(() => captured?.(reply({ outcome: 'failed' }))).not.toThrow();
  });

  it('re-binding an execution to a new socket replaces the old one (reconnect)', async () => {
    const t = new SocketExtensionTransport();
    const first = new FakeSocket('s1');
    const second = new FakeSocket('s2');
    t.bind(EXEC, first);
    t.bind(EXEC, second);

    await t.send(intent());

    expect(first.sent).toHaveLength(0);
    expect(second.sent).toHaveLength(1);
  });

  describe('probeSelectors — read-only pre-flight', () => {
    const SEL = ['#givenName', '#surname'];

    it('returns presence for every selector asked about', async () => {
      const t = new SocketExtensionTransport();
      t.bind(
        EXEC,
        new FakeSocket('s1', {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: EXEC,
          results: [
            { selector: '#givenName', found: true },
            { selector: '#surname', found: false },
          ],
        }),
      );

      await expect(t.probeSelectors(EXEC, SEL)).resolves.toEqual([
        { selector: '#givenName', found: true },
        { selector: '#surname', found: false },
      ]);
    });

    it('probePage sends the ops and returns the open page path', async () => {
      const t = new SocketExtensionTransport();
      const sock = new FakeSocket('s1', {
        protocol: PORTAL_FILL_PROTOCOL_VERSION,
        kind: 'probe_result',
        executionId: EXEC,
        results: SEL.map((selector) => ({ selector, found: true })),
        page: '/nationality',
      });
      t.bind(EXEC, sock);

      await expect(t.probePage(EXEC, SEL, ['radio', null])).resolves.toEqual({
        results: SEL.map((selector) => ({ selector, found: true })),
        page: '/nationality',
      });
      expect(sock.sent[0].payload).toMatchObject({ ops: ['radio', null] });
    });

    it('probePage sends awaitOptions only when a target has it', async () => {
      const reply = {
        protocol: PORTAL_FILL_PROTOCOL_VERSION,
        kind: 'probe_result',
        executionId: EXEC,
        results: SEL.map((selector) => ({ selector, found: true })),
        page: '/eta/welcome',
      };
      const t = new SocketExtensionTransport();
      const sock = new FakeSocket('s1', reply);
      t.bind(EXEC, sock);
      await t.probePage(EXEC, SEL, ['select_text', null], [true, false]);
      expect(sock.sent[0].payload).toMatchObject({
        awaitOptions: [true, false],
      });
      await t.probePage(EXEC, SEL, ['select_text', null], [false, false]);
      expect(sock.sent[1].payload).not.toHaveProperty('awaitOptions');
    });

    it('a write command carries awaitOptions only for the intent that has it', async () => {
      const t = new SocketExtensionTransport();
      const sock = new FakeSocket('s1', {
        protocol: PORTAL_FILL_PROTOCOL_VERSION,
        kind: 'field_result',
        executionId: EXEC,
        fieldKey: 'job_title',
        outcome: 'verified',
        actualValueHash: 'h',
        selectorFound: true,
      });
      t.bind(EXEC, sock);
      const base = {
        executionId: EXEC,
        fieldKey: 'job_title',
        selector: '#t',
        mappedValue: 'v',
        expectedValueHash: 'h',
        category: 'employment' as const,
        op: 'select_text' as const,
        lockedDiffHash: 'l',
        sig: 's',
      };
      await t.send({ ...base, awaitOptions: true });
      await t.send(base);
      expect(sock.sent[0].payload).toMatchObject({ awaitOptions: true });
      expect(sock.sent[1].payload).not.toHaveProperty('awaitOptions');
    });

    it('keeps "its list lacks the answer" (eapp), only on a not-found row', async () => {
      const t = new SocketExtensionTransport();
      t.bind(
        EXEC,
        new FakeSocket('s1', {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: EXEC,
          results: [
            { selector: '#givenName', found: true, optionMissing: true },
            { selector: '#surname', found: false, optionMissing: true },
          ],
        }),
      );
      await expect(t.probeSelectors(EXEC, SEL)).resolves.toEqual([
        { selector: '#givenName', found: true },
        { selector: '#surname', found: false, optionMissing: true },
      ]);
    });

    it('probePage ignores a page that is not a path', async () => {
      const t = new SocketExtensionTransport();
      t.bind(
        EXEC,
        new FakeSocket('s1', {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: EXEC,
          results: SEL.map((selector) => ({ selector, found: true })),
          page: 'https://evil.example/nationality',
        }),
      );
      await expect(t.probePage(EXEC, SEL)).resolves.toMatchObject({
        page: null,
      });
    });

    it('emits on the probe channel, not the write channel', async () => {
      const t = new SocketExtensionTransport();
      const sock = new FakeSocket('s1', {
        protocol: PORTAL_FILL_PROTOCOL_VERSION,
        kind: 'probe_result',
        executionId: EXEC,
        results: SEL.map((selector) => ({ selector, found: true })),
      });
      t.bind(EXEC, sock);

      await t.probeSelectors(EXEC, SEL);

      expect(sock.sent[0].event).toBe('portal-fill:probe');
      expect(sock.sent[0].payload).toMatchObject({
        kind: 'probe',
        selectors: SEL,
      });
    });

    it.each([
      ['no bound socket', undefined, false],
      [
        'a partial answer',
        {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: EXEC,
          results: [{ selector: '#givenName', found: true }],
        },
        true,
      ],
      [
        'an empty answer',
        {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: EXEC,
          results: [],
        },
        true,
      ],
      [
        'a malformed row',
        {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: EXEC,
          results: [
            { selector: '#givenName' },
            { selector: '#surname', found: true },
          ],
        },
        true,
      ],
      [
        'another execution',
        {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: 'exec-999',
          results: [],
        },
        true,
      ],
      [
        'an incompatible protocol',
        { protocol: 99, kind: 'probe_result', executionId: EXEC, results: [] },
        true,
      ],
      ['a non-object reply', 'nope', true],
    ])(
      'returns null (unknown, never "all present") for %s',
      async (_l, ack, bindIt) => {
        const t = new SocketExtensionTransport();
        if (bindIt) t.bind(EXEC, new FakeSocket('s1', ack));
        await expect(t.probeSelectors(EXEC, SEL)).resolves.toBeNull();
      },
    );

    it('never returns the values the page currently holds', async () => {
      const t = new SocketExtensionTransport();
      t.bind(
        EXEC,
        new FakeSocket('s1', {
          protocol: PORTAL_FILL_PROTOCOL_VERSION,
          kind: 'probe_result',
          executionId: EXEC,
          // A well-meaning client that leaks values must not have them pass through.
          results: SEL.map((selector) => ({
            selector,
            found: true,
            value: 'SECRET',
          })),
        }),
      );

      const out = await t.probeSelectors(EXEC, SEL);
      expect(JSON.stringify(out)).not.toContain('SECRET');
      for (const row of out!)
        expect(Object.keys(row).sort()).toEqual(['found', 'selector']);
    });

    it('resolves null instead of hanging when the ack never comes', async () => {
      jest.useFakeTimers();
      try {
        const t = new SocketExtensionTransport();
        t.bind(EXEC, new FakeSocket('s1', undefined, 'silent'));
        const p = t.probeSelectors(EXEC, SEL);
        jest.advanceTimersByTime(10_001);
        await expect(p).resolves.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
