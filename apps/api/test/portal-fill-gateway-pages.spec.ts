/**
 * One launch fills the IRCC page that is open (by its URL path), and the side
 * panel is told which later page the assistant has values for.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers page titles + order
import type { SignedWriteIntent, WritePlan } from '@visaai/types';
import { AutomationGateway } from '../src/modules/automation/automation.gateway';
import { SocketExtensionTransport } from '../src/modules/portal-fill/socket-extension.transport';

const LOCK = 'lock-1';
const intent = (
  fieldKey: string,
  selector: string,
  page: string,
  extra: Partial<SignedWriteIntent> = {},
): SignedWriteIntent => ({
  executionId: 'x',
  fieldKey,
  page,
  selector,
  mappedValue: 'v',
  expectedValueHash: 'h',
  category: 'passport',
  lockedDiffHash: LOCK,
  sig: 's',
  ...extra,
});

const INTENTS: SignedWriteIntent[] = [
  intent('purpose_of_visit', '#visitDetails_txtArea', '/purpose'),
  intent(
    'has_national_id',
    '#hasNationality_radio-button-01-input',
    '/national-id-doc',
    { op: 'radio' },
  ),
  intent(
    'national_id_number',
    '#docNumberNationalities_input',
    '/national-id-doc',
    { reveal: true },
  ),
  intent('available_trip_funds_cad', '#moneyDetails_input', '/finances'),
];

function build(page: string | null) {
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const automation = { updateStatus: jest.fn().mockResolvedValue(undefined) };
  const plan: WritePlan = {
    applicationId: 'app-1',
    preflightReviewId: 'rev-1',
    lockedDiffHash: LOCK,
    entries: [],
    planHash: 'ph',
  };
  const orchestrator = {
    run: jest.fn().mockResolvedValue({
      executionId: 'e',
      state: 'COMPLETED',
      verified: [],
    }),
  };
  const transport = new SocketExtensionTransport();
  const probe = jest
    .spyOn(transport, 'probePage')
    .mockImplementation((_e, selectors) =>
      Promise.resolve({
        results: selectors.map((selector) => ({ selector, found: true })),
        page,
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
            fieldKey: 'has_national_id',
            targetField: '#x',
            mappedValue: 'Yes',
            category: 'passport',
            page: '/national-id-doc',
            label: 'Has a national identity document',
          },
        ],
        issuedAt: Date.now(),
      }),
    } as never,
    { build: () => Promise.resolve(plan) } as never,
    { sign: jest.fn().mockReturnValue(INTENTS) } as never,
    orchestrator as never,
    transport,
  );
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const client = {
    id: 'sock-1',
    data: { sessionId: 'sess-1', applicationId: 'app-1', userId: 'user-1' },
    emitted,
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
  return { gateway, orchestrator, probe, client };
}

const stages = (c: { emitted: Array<{ event: string; payload: unknown }> }) =>
  c.emitted
    .filter((e) => e.event === 'portal-fill:stage')
    .map((e) => e.payload);
const errors = (c: { emitted: Array<{ event: string; payload: unknown }> }) =>
  c.emitted
    .filter((e) => e.event === 'automation:error')
    .map((e) => (e.payload as { message: string }).message);

describe('portal-fill:start — the open page', () => {
  it('probes only load-time targets, with their ops', async () => {
    const { gateway, probe, client } = build('/national-id-doc');
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(probe).toHaveBeenCalledWith(
      expect.any(String),
      [
        '#visitDetails_txtArea',
        '#hasNationality_radio-button-01-input',
        '#moneyDetails_input',
      ],
      [null, 'radio', null],
    );
  });

  it('runs that page in order and names the next page with values', async () => {
    const { gateway, orchestrator, client } = build('/national-id-doc');
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    const run = orchestrator.run.mock.calls[0][2] as SignedWriteIntent[];
    expect(run.map((i) => i.fieldKey)).toEqual([
      'has_national_id',
      'national_id_number',
    ]);
    expect(stages(client)[1]).toMatchObject({
      stage: 'completed',
      filledPages: ['/national-id-doc'],
      nextPage: { page: '/finances', title: 'Finances' },
    });
  });

  it('a page without values fills nothing and says where the next one is', async () => {
    const { gateway, orchestrator, client } = build('/other-names');
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(orchestrator.run).not.toHaveBeenCalled();
    expect(errors(client)[0]).toContain('"Finances"');
  });

  it('the failed stage carries the label of the write that stopped', async () => {
    const { gateway, orchestrator, client } = build('/national-id-doc');
    orchestrator.run.mockResolvedValue({
      executionId: 'e',
      state: 'FAILED',
      verified: [],
      failedField: 'has_national_id',
      haltReason: 'selector_missing',
    });
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(stages(client)[1]).toMatchObject({
      stage: 'failed',
      failedLabel: 'Has a national identity document',
      nextPage: { page: '/finances' },
    });
  });
});
