import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { VisaController } from '../src/modules/visa/visa.controller';
import { VisaStageError } from '../src/modules/visa/visa-orchestration.service';
import type { VisaOrchestrationEngine } from '../src/modules/visa/visa-orchestration.service';
import type { AuthUser } from '../src/modules/auth/jwt.guard';

// Stub RLS client: getUserLanguage reads users.preferred_language; return null
// so the controller resolves to English (default) — keeps engine-input
// assertions language-agnostic.
const DB = {
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { preferred_language: null } }),
      }),
    }),
  }),
} as unknown as SupabaseClient;
const USER = {
  id: 'u1',
  email: 'u@example.com',
  role: 'authenticated',
} as AuthUser;

const RESULT = {
  research: {
    visa_class: 'Express Entry',
    mandatory_documents: ['ECA'],
    financial_threshold_usd: 13757,
    critical_immigration_rules: ['CRS cutoff varies'],
  },
  evaluation: {
    calculated_success_probability: 81,
    risk_factors: [],
    critical_gaps: [],
    mitigation_strategies: [],
  },
  report: '## Success Probability\n**81%**',
};
const BODY = {
  country: 'Canada',
  visaType: 'Express Entry',
  profile: 'NOC 21231, CLB8, MSc, 5y exp',
};

function make(run = jest.fn()) {
  const engine = { run } as unknown as VisaOrchestrationEngine;
  // ARCH-005: the `users` read moved out of the controller into
  // UserProfileRepository. These tests never exercise the language lookup, so a
  // stand-in returning null (the same value the old inline try/catch produced on
  // failure) preserves the previous behaviour exactly.
  const users = {
    getPreferredLanguage: jest.fn().mockResolvedValue(null),
  } as never;
  return { ctrl: new VisaController(engine, users), run };
}

describe('VisaController POST /visa/analyze', () => {
  it('200: returns ok + pipeline result; forwards validated input to the engine', async () => {
    const { ctrl, run } = make(jest.fn().mockResolvedValue(RESULT));
    const r = await ctrl.analyze(DB, USER, BODY);
    expect(r).toMatchObject({ ok: true, ...RESULT });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Canada', visaType: 'Express Entry' }),
    );
  });

  it('400: missing profile (invalid body, engine never called)', async () => {
    const { ctrl, run } = make();
    await expect(
      ctrl.analyze(DB, USER, { country: 'Canada', visaType: 'Express Entry' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });

  it('400: empty profile', async () => {
    const { ctrl } = make();
    await expect(
      ctrl.analyze(DB, USER, { ...BODY, profile: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400: oversized profile (>8000 chars) — token guardrail', async () => {
    const { ctrl, run } = make();
    await expect(
      ctrl.analyze(DB, USER, { ...BODY, profile: 'x'.repeat(8001) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });

  it('400: non-object body', async () => {
    const { ctrl } = make();
    await expect(
      ctrl.analyze(DB, USER, 'not-an-object'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.analyze(DB, USER, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('502: stage failure maps to BAD_GATEWAY and keeps the failing stage', async () => {
    const { ctrl } = make(
      jest
        .fn()
        .mockRejectedValue(new VisaStageError('evaluation', 'model down')),
    );
    await expect(ctrl.analyze(DB, USER, BODY)).rejects.toBeInstanceOf(
      HttpException,
    );
    try {
      await ctrl.analyze(DB, USER, BODY);
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(ex.getResponse()).toMatchObject({
        ok: false,
        stage: 'evaluation',
      });
    }
  });

  it('500: unexpected error maps to INTERNAL_SERVER_ERROR (no crash, no leak)', async () => {
    const { ctrl } = make(jest.fn().mockRejectedValue(new Error('boom')));
    await expect(ctrl.analyze(DB, USER, BODY)).rejects.toBeInstanceOf(
      HttpException,
    );
    try {
      await ctrl.analyze(DB, USER, BODY);
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(ex.getResponse()).toMatchObject({ ok: false });
    }
  });
});
