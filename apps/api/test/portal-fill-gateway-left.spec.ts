/**
 * Auto-advance (extension 0.1.57): a completed run tells the side panel what
 * the assistant leaves for the applicant on the page it filled (`left`), so
 * the panel never presses "Save and continue" past something the applicant
 * must fill. Unknown (no service, lookup failed) → `left` omitted.
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

function build(page: string | null, coverage?: unknown) {
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
    coverage === undefined ? undefined : (coverage as never),
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

const completed = (c: {
  emitted: Array<{ event: string; payload: unknown }>;
}) =>
  stages(c).find((s) => (s as { stage: string }).stage === 'completed') as
    | { left?: string[] }
    | undefined;

describe('completed stage — what is left on the page', () => {
  it('lists the labels the coverage leaves on the filled page only', async () => {
    const svc = {
      coverage: jest.fn().mockResolvedValue({
        pages: [
          {
            page: '/national-id-doc',
            title: 'x',
            filled: 2,
            left: [{ label: 'Issue date', reason: 'not_in_profile' }],
          },
          {
            page: '/finances',
            title: 'y',
            filled: 1,
            left: [{ label: 'Funds', reason: 'not_in_profile' }],
          },
        ],
      }),
    };
    const { gateway, client } = build('/national-id-doc', svc);
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(svc.coverage).toHaveBeenCalledWith('app-1');
    expect(completed(client)?.left).toEqual(['Issue date']);
  });

  it('an empty list when nothing is left', async () => {
    const svc = {
      coverage: jest.fn().mockResolvedValue({
        pages: [{ page: '/national-id-doc', title: 'x', filled: 2, left: [] }],
      }),
    };
    const { gateway, client } = build('/national-id-doc', svc);
    await gateway.handlePortalFillStart(client as never, {
      readbackToken: 't',
    });
    expect(completed(client)?.left).toEqual([]);
  });

  it('omitted when unknown: no service, a failed lookup, or the page not in the coverage', async () => {
    for (const svc of [
      undefined,
      { coverage: jest.fn().mockRejectedValue(new Error('db down')) },
      { coverage: jest.fn().mockResolvedValue(null) },
      { coverage: jest.fn().mockResolvedValue({ pages: [] }) },
    ]) {
      const { gateway, client } = build('/national-id-doc', svc);
      await gateway.handlePortalFillStart(client as never, {
        readbackToken: 't',
      });
      const c = completed(client);
      expect(c).toBeDefined();
      expect(c).not.toHaveProperty('left');
    }
  });
});
