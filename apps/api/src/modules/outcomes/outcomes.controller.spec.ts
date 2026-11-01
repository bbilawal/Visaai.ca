import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OutcomesController } from './outcomes.controller';
import type { AuthUser } from '../auth/jwt.guard';

/**
 * API-001 regression cover: the POST route accepted an interface-typed body,
 * which TypeScript erases at runtime. Invalid input travelled to the database
 * and came back as a 500 from a CHECK-constraint violation. It must now be
 * rejected as a 400 before any database call happens.
 */
describe('OutcomesController.report — input validation', () => {
  const user = { id: 'user-1' } as AuthUser;
  const db = {} as SupabaseClient;

  function make() {
    const service = {
      report: jest.fn().mockResolvedValue({ id: 'o1' }),
      get: jest.fn(),
    };
    return {
      ctrl: new OutcomesController(service),
      service,
    };
  }

  it('accepts a valid body and forwards the parsed value', async () => {
    const { ctrl, service } = make();
    await ctrl.report(db, user, 'app-1', {
      outcome: 'refused',
      decidedAt: '2026-08-06',
      refusalReasons: ['insufficient_funds'],
    });
    expect(service.report).toHaveBeenCalledWith(db, 'app-1', 'user-1', {
      outcome: 'refused',
      decidedAt: '2026-08-06',
      refusalReasons: ['insufficient_funds'],
    });
  });

  it('accepts a minimal body', async () => {
    const { ctrl, service } = make();
    await ctrl.report(db, user, 'app-1', { outcome: 'approved' });
    expect(service.report).toHaveBeenCalled();
  });

  it.each([
    ['an unknown outcome', { outcome: 'definitely-not-valid' }],
    ['a missing outcome', {}],
    ['a null body', null],
    ['a string body', 'approved'],
    [
      'an unknown refusal-reason code',
      {
        outcome: 'refused',
        refusalReasons: ['officer_did_not_like_my_shoes'],
      },
    ],
    [
      'free text as a refusal reason',
      {
        outcome: 'refused',
        refusalReasons: [
          'Ms. Jane Doe was told her bank statement looked forged',
        ],
      },
    ],
    [
      'a malformed decidedAt',
      { outcome: 'approved', decidedAt: 'last Tuesday' },
    ],
  ])(
    'rejects %s with 400 and never touches the database',
    async (_label, body) => {
      const { ctrl, service } = make();
      await expect(ctrl.report(db, user, 'app-1', body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(service.report).not.toHaveBeenCalled();
    },
  );

  it('rejects an oversized refusal-reason array', async () => {
    const { ctrl, service } = make();
    await expect(
      ctrl.report(db, user, 'app-1', {
        outcome: 'refused',
        refusalReasons: Array.from({ length: 21 }, () => 'other'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.report).not.toHaveBeenCalled();
  });
});
