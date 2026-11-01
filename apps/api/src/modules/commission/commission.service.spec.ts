import { NotFoundException } from '@nestjs/common';
import type { CommissionRule } from '@visaai/types';
import { CommissionService } from './commission.service';
import type { ICommissionRepository } from './commission.repository';

const GLOBAL: CommissionRule = {
  id: 'g',
  scope: 'global',
  country_code: null,
  visa_type: null,
  consultant_id: null,
  model: 'percentage',
  platform_pct: 0.2,
  platform_fixed_usd: null,
  effective_from: '2026-01-01T00:00:00Z',
  active: true,
  note: null,
  created_at: '2026-01-01T00:00:00Z',
};

function makeRepo(
  over: Partial<ICommissionRepository> = {},
): ICommissionRepository {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected repo call: ${n}`);
  };
  return {
    listActiveRules: notImpl('listActiveRules'),
    listAllRules: notImpl('listAllRules'),
    insertRule: notImpl('insertRule'),
    deactivateRule: notImpl('deactivateRule'),
    ...over,
  };
}

describe('CommissionService', () => {
  describe('splitFor', () => {
    it('resolves the active rule and splits gross', async () => {
      const svc = new CommissionService(
        makeRepo({ listActiveRules: jest.fn().mockResolvedValue([GLOBAL]) }),
      );
      const s = await svc.splitFor({
        gross: 200,
        country: 'CA',
        visa: 'student',
      });
      expect(s).toEqual({
        gross_usd: 200,
        platform_fee_usd: 40,
        consultant_payout_usd: 160,
        rule_id: 'g',
      });
    });

    it('404s when no rule resolves (misconfiguration)', async () => {
      const svc = new CommissionService(
        makeRepo({ listActiveRules: jest.fn().mockResolvedValue([]) }),
      );
      await expect(svc.splitFor({ gross: 100 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('admin CRUD', () => {
    it('createRule delegates to the repository', async () => {
      const insertRule = jest.fn().mockResolvedValue(GLOBAL);
      const svc = new CommissionService(makeRepo({ insertRule }));
      const out = await svc.createRule({
        scope: 'global',
        model: 'percentage',
        platform_pct: 0.2,
      });
      expect(out).toBe(GLOBAL);
      expect(insertRule).toHaveBeenCalled();
    });

    it('deactivateRule 404s when the rule is missing', async () => {
      const svc = new CommissionService(
        makeRepo({ deactivateRule: jest.fn().mockResolvedValue(false) }),
      );
      await expect(svc.deactivateRule('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deactivateRule returns the deactivated id on success', async () => {
      const svc = new CommissionService(
        makeRepo({ deactivateRule: jest.fn().mockResolvedValue(true) }),
      );
      expect(await svc.deactivateRule('g')).toEqual({ id: 'g', active: false });
    });
  });
});
