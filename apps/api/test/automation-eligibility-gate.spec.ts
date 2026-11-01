import type { ConfigService } from '@nestjs/config';
import type { EligibilityCheckInput, EligibilityResult } from '@visaai/types';
import { AutomationService } from '../src/modules/automation/automation.service';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { SessionTokenService } from '../src/modules/automation/session-token.service';
import type { ExecutionEligibilityService } from '../src/modules/eligibility/execution-eligibility.service';
import type { Env } from '../src/config/configuration';

const INPUT: EligibilityCheckInput = {
  applicationId: 'app-1',
  preflightReviewId: 'pf-1',
  mappings: [],
  token: 'tok',
  sessionId: 'sess-1',
  userId: 'u1',
};

function make(evalResult: EligibilityResult) {
  const tokens = { mint: jest.fn(), verify: jest.fn() };
  const supabase = { admin: {}, forUser: jest.fn() };
  const eligibility = {
    evaluate: jest.fn().mockResolvedValue(evalResult),
    assert: jest.fn(),
    isTokenValid: jest.fn(),
  };
  const config = { get: jest.fn().mockReturnValue(false) };
  const svc = new AutomationService(
    supabase as unknown as SupabaseService,
    tokens as unknown as SessionTokenService,
    eligibility as unknown as ExecutionEligibilityService,
    config as unknown as ConfigService<Env>,
    { mint: () => 'exec', isValid: async () => true },
  );
  return { svc, tokens, eligibility };
}

describe('AutomationService — read-only eligibility gate (Phase 3E)', () => {
  it('maps an eligible evaluation to the gate decision', async () => {
    const { svc, eligibility } = make({
      applicationId: 'app-1',
      eligible: true,
      conditions: {
        paymentCompleted: true,
        consultantApprovalValid: true,
        preflightLockValid: true,
        executionTokenValid: true,
      },
      reasons: [],
    });
    const out = await svc.evaluateExecutionGate(INPUT);
    expect(eligibility.evaluate).toHaveBeenCalledWith(INPUT);
    expect(out).toEqual({
      eligible: true,
      blockedReasons: [],
      evaluationDetails: {
        paymentCompleted: true,
        consultantApprovalValid: true,
        preflightLockValid: true,
        executionTokenValid: true,
      },
      executionAllowed: true,
    });
  });

  it('surfaces blocked reasons + executionAllowed=false when not eligible', async () => {
    const { svc } = make({
      applicationId: 'app-1',
      eligible: false,
      conditions: {
        paymentCompleted: false,
        consultantApprovalValid: true,
        preflightLockValid: false,
        executionTokenValid: true,
      },
      reasons: ['payment_missing', 'preflight_invalid'],
    });
    const out = await svc.evaluateExecutionGate(INPUT);
    expect(out.eligible).toBe(false);
    expect(out.executionAllowed).toBe(false);
    expect(out.blockedReasons).toEqual([
      'payment_missing',
      'preflight_invalid',
    ]);
    expect(out.evaluationDetails.preflightLockValid).toBe(false);
  });

  it('has NO side effects: mints no token, starts no session/execution', async () => {
    const { svc, tokens } = make({
      applicationId: 'app-1',
      eligible: true,
      conditions: {
        paymentCompleted: true,
        consultantApprovalValid: true,
        preflightLockValid: true,
        executionTokenValid: true,
      },
      reasons: [],
    });
    await svc.evaluateExecutionGate(INPUT);
    expect(tokens.mint).not.toHaveBeenCalled();
  });
});
