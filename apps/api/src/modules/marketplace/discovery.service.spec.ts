import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConsultantAvailability,
  ConsultantProfile,
  ConsultantReview,
  ConsultantSkills,
} from '@visaai/types';
import { DiscoveryService } from './discovery.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import {
  DuplicateReviewError,
  type DiscoveryRow,
  type IMarketplaceRepository,
} from './marketplace.repository';

const ROW: DiscoveryRow = {
  id: 'prof-1',
  user_id: 'user-1',
  headline: 'Canada immigration expert',
  specialization: ['express_entry'],
  years_experience: 8,
  hourly_rate_usd: 120,
  rating_avg: 4.5,
  rating_count: 12,
  active_status: 'active',
  visa_types: ['express_entry'],
  languages: ['en', 'fr'],
  countries_supported: ['CA'],
};

const PROFILE: ConsultantProfile = {
  id: 'prof-1',
  user_id: 'user-1',
  headline: 'Canada immigration expert',
  bio: null,
  specialization: ['express_entry'],
  years_experience: 8,
  license_number: null,
  license_authority: null,
  license_country: null,
  license_verified: false,
  hourly_rate_usd: 120,
  rating_avg: 4.5,
  rating_count: 12,
  max_active_cases: 10,
  active_status: 'active',
  kyc_status: 'verified',
  stripe_connect_account_id: null,
  payouts_enabled: false,
  created_at: '2026-06-26T00:00:00Z',
  updated_at: '2026-06-26T00:00:00Z',
};

const SKILLS: ConsultantSkills = {
  id: 'sk-1',
  consultant_id: 'prof-1',
  visa_types: ['express_entry'],
  languages: ['en', 'fr'],
  countries_supported: ['CA'],
  updated_at: '2026-06-26T00:00:00Z',
};

const AVAILABILITY: ConsultantAvailability = {
  id: 'av-1',
  consultant_id: 'prof-1',
  timezone: 'America/Toronto',
  working_hours: { mon: [['09:00', '17:00']] },
  max_cases: 10,
  accepting_new: true,
  updated_at: '2026-06-26T00:00:00Z',
};

const REVIEW: ConsultantReview = {
  id: 'rev-1',
  consultant_id: 'prof-1',
  user_id: 'user-2',
  application_id: 'app-1',
  rating: 5,
  feedback: 'Great help',
  created_at: '2026-06-26T00:00:00Z',
};

// SEC-2001: createReview now verifies the application belongs to the caller via
// db.from('applications')... — the mock returns an owned row by default; a test
// overrides `ownedApp` to simulate a non-owned application_id.
let ownedApp: { id: string } | null = { id: 'app-1' };
const DB = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: ownedApp }) }),
      }),
    }),
  }),
} as unknown as SupabaseClient;
const ADMIN = {} as SupabaseClient;

/** Hand-rolled repo fake (pricing.service.spec style) — unexercised paths throw. */
function makeRepo(
  overrides: Partial<IMarketplaceRepository> = {},
): IMarketplaceRepository {
  const notImpl = (name: string) => () => {
    throw new Error(`unexpected repo call: ${name}`);
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
    ...overrides,
  };
}

function makeSupabase(): SupabaseService {
  return {
    forUser: jest.fn().mockReturnValue(DB),
    admin: ADMIN,
  } as unknown as SupabaseService;
}

describe('DiscoveryService', () => {
  describe('listConsultants', () => {
    it('maps rows to cards, joining display names from the service-role client', async () => {
      const listConsultants = jest.fn().mockResolvedValue([ROW]);
      const getFullNames = jest
        .fn()
        .mockResolvedValue(new Map([['user-1', 'Jane Doe']]));
      const supabase = makeSupabase();
      const svc = new DiscoveryService(
        makeRepo({ listConsultants, getFullNames }),
        supabase,
      );

      const cards = await svc.listConsultants('tok', { country: 'CA' });

      expect(cards).toHaveLength(1);
      expect(cards[0]).toEqual({
        id: 'prof-1',
        full_name: 'Jane Doe',
        headline: 'Canada immigration expert',
        specialization: ['express_entry'],
        countries_supported: ['CA'],
        visa_types: ['express_entry'],
        languages: ['en', 'fr'],
        years_experience: 8,
        hourly_rate_usd: 120,
        rating_avg: 4.5,
        rating_count: 12,
        active_status: 'active',
      });
      // reads run under the caller's scoped client; names via admin client.
      expect(supabase.forUser).toHaveBeenCalledWith('tok');
      expect(listConsultants).toHaveBeenCalledWith(DB, { country: 'CA' });
      expect(getFullNames).toHaveBeenCalledWith(ADMIN, ['user-1']);
    });

    it('falls back to null name when the user has no display name', async () => {
      const svc = new DiscoveryService(
        makeRepo({
          listConsultants: jest.fn().mockResolvedValue([ROW]),
          getFullNames: jest.fn().mockResolvedValue(new Map()),
        }),
        makeSupabase(),
      );
      const cards = await svc.listConsultants('tok', {});
      expect(cards[0].full_name).toBeNull();
    });
  });

  describe('getConsultant', () => {
    it('merges profile + name + skills + availability', async () => {
      const svc = new DiscoveryService(
        makeRepo({
          getConsultantDetail: jest.fn().mockResolvedValue({
            profile: PROFILE,
            skills: SKILLS,
            availability: AVAILABILITY,
          }),
          getFullNames: jest
            .fn()
            .mockResolvedValue(new Map([['user-1', 'Jane Doe']])),
        }),
        makeSupabase(),
      );
      const detail = await svc.getConsultant('tok', 'prof-1');
      expect(detail.full_name).toBe('Jane Doe');
      expect(detail.skills).toBe(SKILLS);
      expect(detail.availability).toBe(AVAILABILITY);
      expect(detail.id).toBe('prof-1');
    });

    it('never exposes payout/KYC internals on the anonymous detail route', async () => {
      // This route is @AllowAnonymous and RLS filters rows, not columns, so a
      // spread of the profile row published these to any visitor. Regression
      // guard: the response is a whitelist, so a column added to
      // consultant_profiles later cannot leak by default.
      const svc = new DiscoveryService(
        makeRepo({
          getConsultantDetail: jest.fn().mockResolvedValue({
            profile: PROFILE,
            skills: SKILLS,
            availability: AVAILABILITY,
          }),
          getFullNames: jest
            .fn()
            .mockResolvedValue(new Map([['user-1', 'Jane Doe']])),
        }),
        makeSupabase(),
      );

      const detail = (await svc.getConsultant(
        'tok',
        'prof-1',
      )) as unknown as Record<string, unknown>;

      for (const leaked of [
        'stripe_connect_account_id',
        'payouts_enabled',
        'kyc_status',
        'user_id',
        'max_active_cases',
      ]) {
        expect(detail).not.toHaveProperty(leaked);
      }
      // Still serves what the profile page actually renders.
      expect(detail.license_verified).toBe(PROFILE.license_verified);
      expect(detail.rating_avg).toBe(PROFILE.rating_avg);
    });

    it('404s when the consultant does not exist', async () => {
      const svc = new DiscoveryService(
        makeRepo({ getConsultantDetail: jest.fn().mockResolvedValue(null) }),
        makeSupabase(),
      );
      await expect(svc.getConsultant('tok', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createReview', () => {
    beforeEach(() => {
      ownedApp = { id: 'app-1' };
    });

    it('rejects an application_id the caller does not own (SEC-2001)', async () => {
      ownedApp = null; // RLS-scoped lookup finds no owned row
      const insertReview = jest.fn();
      const svc = new DiscoveryService(
        makeRepo({ insertReview }),
        makeSupabase(),
      );
      await expect(
        svc.createReview('tok', 'prof-1', 'user-2', {
          rating: 5,
          application_id: 'someone-elses-app',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(insertReview).not.toHaveBeenCalled();
    });

    it('inserts a review with the caller as author', async () => {
      const insertReview = jest.fn().mockResolvedValue(REVIEW);
      const svc = new DiscoveryService(
        makeRepo({ insertReview }),
        makeSupabase(),
      );
      const out = await svc.createReview('tok', 'prof-1', 'user-2', {
        rating: 5,
        feedback: 'Great help',
        application_id: 'app-1',
      });
      expect(out).toBe(REVIEW);
      expect(insertReview).toHaveBeenCalledWith(DB, {
        consultant_id: 'prof-1',
        user_id: 'user-2',
        application_id: 'app-1',
        rating: 5,
        feedback: 'Great help',
      });
    });

    it('maps the one-per-case duplicate into a 409', async () => {
      const svc = new DiscoveryService(
        makeRepo({
          insertReview: jest.fn().mockRejectedValue(new DuplicateReviewError()),
        }),
        makeSupabase(),
      );
      await expect(
        svc.createReview('tok', 'prof-1', 'user-2', { rating: 4 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listReviews', () => {
    it('passes through to the repository under the scoped client', async () => {
      const listReviews = jest.fn().mockResolvedValue([REVIEW]);
      const supabase = makeSupabase();
      const svc = new DiscoveryService(makeRepo({ listReviews }), supabase);
      const out = await svc.listReviews('tok', 'prof-1');
      expect(out).toEqual([REVIEW]);
      expect(supabase.forUser).toHaveBeenCalledWith('tok');
      expect(listReviews).toHaveBeenCalledWith(DB, 'prof-1');
    });
  });
});
