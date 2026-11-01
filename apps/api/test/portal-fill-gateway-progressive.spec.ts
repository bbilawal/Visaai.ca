/**
 * The IRCC eTA form is ONE page (/eta/welcome) whose questions appear as
 * earlier ones are answered and as the applicant presses Next. A run fills
 * what is on the page, looks again for what its writes revealed, fills that,
 * and reports what is still not on the page. It never presses Next.
 */
import '../src/modules/automation/portal-fills/canada-ircc-eta'; // registers the progressive page
import type { SignedWriteIntent, WritePlan } from '@visaai/types';
import { AutomationGateway } from '../src/modules/automation/automation.gateway';
import { SocketExtensionTransport } from '../src/modules/portal-fill/socket-extension.transport';

const LOCK = 'lock-1';
const ETA = '/eta/welcome';
const intent = (fieldKey: string, selector: string): SignedWriteIntent => ({
  executionId: 'x',
  fieldKey,
  page: ETA,
  selector,
  mappedValue: 'v',
  expectedValueHash: 'h',
  category: 'passport',
  op: 'select_text',
  lockedDiffHash: LOCK,
  sig: 's',
});

const REP = intent('is_representative', '#rep');
const DOC = intent('travel_document_type', '#doc');
const CIT = intent('nationality', '#cit');
const PASS = intent('passport_number', '#pass');
const INTENTS = [REP, DOC, CIT, PASS];

/** Writing a key reveals these selectors (as the eTA form does). */
const REVEALS: Record<string, string[]> = { '#doc': ['#cit'] };

function build(present: Set<string>, intents: SignedWriteIntent[] = INTENTS) {
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const automation = { updateStatus: jest.fn().mockResolvedValue(undefined) };
  const plan: WritePlan = {
    applicationId: 'app-1',
    preflightReviewId: 'rev-1',
    lockedDiffHash: LOCK,
    entries: [],
    planHash: 'ph',
  };
  const written: string[] = [];
  const orchestrator = {
    run: jest.fn(
      async (
        _a: string,
        executionId: string,
        intents: SignedWriteIntent[],
        _actor: unknown,
        more?: () => Promise<SignedWriteIntent[]>,
      ) => {
        let queue = intents;
        while (queue.length) {
          for (const i of queue) {
            written.push(i.selector);
            for (const s of REVEALS[i.selector] ?? []) present.add(s);
          }
          queue = more ? await more() : [];
        }
        return { executionId, state: 'COMPLETED', verified: written };
      },
    ),
  };
  const transport = new SocketExtensionTransport();
  const probe = jest
    .spyOn(transport, 'probePage')
    .mockImplementation((_e, selectors) =>
      Promise.resolve({
        results: selectors.map((selector) => ({
          selector,
          found: present.has(selector),
        })),
        page: ETA,
      }),
    );
  const gateway = new AutomationGateway(
    {} as never,
    automation as never,
    audit as never,
    {
      verify: () => ({
        applicationId: 'app-1',
        preflightReviewId: 'rev-1',
        sessionId: 'sess-1',
        userId: 'user-1',
        executionToken: 'tok',
        lockedDiffHash: LOCK,
        mappings: [
          {
            fieldKey: 'nationality',
            targetField: '#cit',
            mappedValue: 'v',
            category: 'passport',
            page: ETA,
            label: 'Country of citizenship',
          },
          {
            fieldKey: 'passport_number',
            targetField: '#pass',
            mappedValue: 'v',
            category: 'passport',
            page: ETA,
            label: 'Passport number',
          },
        ],
        issuedAt: Date.now(),
      }),
      mint: () => 'renewed',
    } as never,
    { build: () => Promise.resolve(plan) } as never,
    { sign: jest.fn().mockReturnValue(intents) } as never,
    orchestrator as never,
    transport,
  );
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const client = {
    id: 'sock-1',
    data: { sessionId: 'sess-1', applicationId: 'app-1', userId: 'user-1' },
    emit(event: string, p: unknown, ack?: (raw: unknown) => void) {
      emitted.push({ event, payload: p });
      if (event === 'portal-fill:stage' && ack)
        ack({
          bound: true,
          executionId: (p as { executionId: string }).executionId,
        });
      return true;
    },
  };
  return { gateway, orchestrator, probe, client, emitted, written };
}

const stagesOf = (emitted: Array<{ event: string; payload: unknown }>) =>
  emitted
    .filter((e) => e.event === 'portal-fill:stage')
    .map((e) => e.payload as Record<string, unknown>);

describe('portal-fill:start — a progressive single page (eTA)', () => {
  it('fills what is there, then what those answers revealed, and lists the rest', async () => {
    const present = new Set(['#rep', '#doc']);
    const { gateway, client, emitted, written } = build(present);
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });

    expect(written).toEqual(['#rep', '#doc', '#cit']);
    const done = stagesOf(emitted).find((s) => s.stage === 'completed');
    expect(done).toMatchObject({ filledPages: [ETA], nextPage: null });
    // Not on the page yet (behind the applicant's Next): reported by label.
    expect(done?.remaining).toEqual(['Passport number']);
    expect(emitted.some((e) => e.event === 'automation:error')).toBe(false);
  });

  it('a later launch, after the applicant pressed Next, fills the newly shown section', async () => {
    const present = new Set(['#pass']);
    const { gateway, client, emitted, written } = build(present);
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(written).toEqual(['#pass']);
    const done = stagesOf(emitted).find((s) => s.stage === 'completed');
    expect(done?.remaining).toEqual(
      expect.arrayContaining(['Country of citizenship']),
    );
  });

  it('every probe flags only the targets whose options load late (awaitOptions)', async () => {
    const TITLE: SignedWriteIntent = {
      ...intent('job_title', '#title'),
      category: 'employment',
      awaitOptions: true,
    };
    // #title appears (disabled while it loads) once #doc is answered.
    REVEALS['#doc'] = ['#cit', '#title'];
    try {
      const present = new Set(['#rep', '#doc']);
      const { gateway, client, probe, written } = build(present, [
        REP,
        DOC,
        CIT,
        TITLE,
      ]);
      await gateway.handlePortalFillStart(client as never, {
        readbackToken: 't',
      });
      expect(written).toEqual(['#rep', '#doc', '#cit', '#title']);
      for (const call of probe.mock.calls) {
        const selectors = call[1];
        const awaits = call[3] as boolean[];
        expect(awaits).toHaveLength(selectors.length);
        selectors.forEach((s, i) => expect(awaits[i]).toBe(s === '#title'));
      }
      expect(probe.mock.calls.some((c) => c[1].includes('#title'))).toBe(true);
    } finally {
      REVEALS['#doc'] = ['#cit'];
    }
  });

  it('no intent with the flag: every probe flag is false (other portals unchanged)', async () => {
    const { gateway, client, probe } = build(new Set(['#rep', '#doc']));
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(probe).toHaveBeenCalled();
    for (const call of probe.mock.calls)
      expect((call[3] as boolean[]).every((a) => a === false)).toBe(true);
  });

  it('nothing of the form on the page yet fills nothing', async () => {
    const { gateway, client, emitted, orchestrator } = build(new Set());
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(emitted.some((e) => e.event === 'automation:error')).toBe(true);
  });
});
