import { BadRequestException } from '@nestjs/common';
import type { ConsultantProfile } from '@visaai/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MarketplaceAdminService } from './marketplace-admin.service';
import type { IMarketplaceRepository } from './marketplace.repository';
import type { SupabaseService } from '../shared/supabase/supabase.service';

const ADMIN = {} as SupabaseClient;

const PROFILE = {
  id: 'prof-1',
  user_id: 'user-1',
  active_status: 'pending_review',
  rating_avg: 0,
  rating_count: 0,
} as unknown as ConsultantProfile;

function makeRepo(over: Partial<IMarketplaceRepository> = {}) {
  const notImpl = (n: string) => () => {
    throw new Error(`unexpected repo call: ${n}`);
  };
  return {
    getProfileByUserId: notImpl('getProfileByUserId'),
    insertProfile: notImpl('insertProfile'),
    updateProfile: notImpl('updateProfile'),
    getSkills: notImpl('getSkills'),
    upsertSkills: notImpl('upsertSkills'),
    getAvailability: notImpl('getAvailability'),
    upsertAvailability: notImpl('upsertAvailability'),
    getActiveCountryCodes: notImpl('getActiveCountryCodes'),
    listConsultants: notImpl('listConsultants'),
    getConsultantDetail: notImpl('getConsultantDetail'),
    insertReview: notImpl('insertReview'),
    listReviews: notImpl('listReviews'),
    listProfilesByStatus: notImpl('listProfilesByStatus'),
    setProfileStatus: notImpl('setProfileStatus'),
    getFullNames: notImpl('getFullNames'),
    ...over,
  };
}

const supabase = { admin: ADMIN } as unknown as SupabaseService;

describe('MarketplaceAdminService', () => {
  describe('listByStatus', () => {
    it('joins display names onto the review queue', async () => {
      const svc = new MarketplaceAdminService(
        makeRepo({
          listProfilesByStatus: jest.fn().mockResolvedValue([PROFILE]),
          getFullNames: jest
            .fn()
            .mockResolvedValue(new Map([['user-1', 'Jane Doe']])),
        }),
        supabase,
      );

      const out = await svc.listByStatus('pending_review');

      expect(out).toHaveLength(1);
      expect(out[0].full_name).toBe('Jane Doe');
      expect(out[0].id).toBe('prof-1');
    });

    it('tolerates a consultant with no display name', async () => {
      const svc = new MarketplaceAdminService(
        makeRepo({
          listProfilesByStatus: jest.fn().mockResolvedValue([PROFILE]),
          getFullNames: jest.fn().mockResolvedValue(new Map()),
        }),
        supabase,
      );
      expect(
        (await svc.listByStatus('pending_review'))[0].full_name,
      ).toBeNull();
    });
  });

  describe('setStatus', () => {
    it('approves a profile', async () => {
      const setProfileStatus = jest
        .fn()
        .mockResolvedValue({ ...PROFILE, active_status: 'active' });
      const svc = new MarketplaceAdminService(
        makeRepo({ setProfileStatus }),
        supabase,
      );

      const out = await svc.setStatus('prof-1', 'active');

      expect(out.active_status).toBe('active');
      // Service-role client on purpose: reviewing acts on rows the reviewer
      // does not own, which owner-scoped RLS forbids. The route is the gate.
      expect(setProfileStatus).toHaveBeenCalledWith(ADMIN, 'prof-1', 'active');
    });

    it('400s on an unknown profile rather than reporting success', async () => {
      const svc = new MarketplaceAdminService(
        makeRepo({ setProfileStatus: jest.fn().mockResolvedValue(null) }),
        supabase,
      );
      await expect(svc.setStatus('nope', 'active')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
