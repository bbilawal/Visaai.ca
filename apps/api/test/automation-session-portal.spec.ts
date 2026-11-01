import type { ConfigService } from '@nestjs/config';
import { AutomationService } from '../src/modules/automation/automation.service';
import { AutomationGateway } from '../src/modules/automation/automation.gateway';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { SessionTokenService } from '../src/modules/automation/session-token.service';
import type { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import type { Env } from '../src/config/configuration';
import { CA_ETA_VISAAI_ID } from '../src/strategies/country/canada.strategy';

/**
 * Live 2026-10-30: a visitor-visa (tr-rt) launch with the applicant's IRCC tab
 * on the study permit's secure-account questionnaire showed the study
 * questionnaire's "The questionnaire is done" text. The panel could not tell:
 * nothing told it which portal the session's route files on. automation:ready
 * now carries the route's portalId so the panel can say "wrong portal".
 */
function svcWith(result: { data: unknown; error: unknown }) {
  const supabase = {
    admin: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: jest.fn().mockResolvedValue(result) }),
        }),
      }),
    },
  };
  return new AutomationService(
    supabase as unknown as SupabaseService,
    {} as unknown as SessionTokenService,
    {} as unknown as ExecutionEligibilityService,
    { get: jest.fn() } as unknown as ConfigService<Env>,
    { mint: () => 'exec', isValid: () => Promise.resolve(true) },
  );
}

describe('AutomationService.getApplicationPortalId', () => {
  it.each([
    ['ca-visitor-visa', 'ircc'],
    [CA_ETA_VISAAI_ID, 'ircc-eta'],
  ])('route %s files on %s', async (visaaiId, portalId) => {
    const svc = svcWith({
      data: { destination_country: 'CA', visa_types: { visaai_id: visaaiId } },
      error: null,
    });
    await expect(svc.getApplicationPortalId('a1')).resolves.toBe(portalId);
  });

  it('a read error or no row is null (unknown), never a guess', async () => {
    await expect(
      svcWith({ data: null, error: { message: 'x' } }).getApplicationPortalId(
        'a1',
      ),
    ).resolves.toBeNull();
    await expect(
      svcWith({ data: null, error: null }).getApplicationPortalId('a1'),
    ).resolves.toBeNull();
  });
});

describe('automation:ready carries the session portalId', () => {
  function connect(portalId: unknown) {
    const automation = {
      getSessionPortalUrl: jest.fn().mockResolvedValue(null),
      getApplicationPortalId:
        portalId instanceof Error
          ? jest.fn().mockRejectedValue(portalId)
          : jest.fn().mockResolvedValue(portalId),
    };
    const tokens = {
      redeem: jest.fn().mockResolvedValue({
        sessionId: 's1',
        applicationId: 'a1',
        userId: 'u1',
      }),
      mintResume: jest.fn().mockResolvedValue('r1'),
    };
    const g = new AutomationGateway(
      tokens as never,
      automation as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const emitted: { event: string; payload: any }[] = [];
    const client = {
      handshake: { auth: { token: 't' } },
      data: {} as Record<string, unknown>,
      emit: (event: string, payload: unknown) =>
        emitted.push({ event, payload }),
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    return { g, client, emitted, automation };
  }

  it("sends the application route's portalId", async () => {
    const { g, client, emitted, automation } = connect('ircc');
    await g.handleConnection(client as never);
    expect(automation.getApplicationPortalId).toHaveBeenCalledWith('a1');
    expect(
      emitted.find((e) => e.event === 'automation:ready')?.payload,
    ).toMatchObject({ portalId: 'ircc' });
  });

  it('a failed lookup still connects, with portalId null', async () => {
    const { g, client, emitted } = connect(new Error('db down'));
    await g.handleConnection(client as never);
    expect(
      emitted.find((e) => e.event === 'automation:ready')?.payload,
    ).toMatchObject({ portalId: null, sessionId: 's1' });
  });
});
