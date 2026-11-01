import { ConflictException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConsultantAvailability,
  ConsultantProfile,
  ConsultantSkills,
} from '@visaai/types';
import { ProfileService } from './profile.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import type { IMarketplaceRepository } from './marketplace.repository';

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

const DB = {} as SupabaseClient;
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

describe('ProfileService', () => {
  describe('getMyProfile', () => {
    it('returns the profile bundle (profile + skills + availability)', async () => {
      const svc = new ProfileService(
        makeRepo({
          getProfileByUserId: jest.fn().mockResolvedValue(PROFILE),
          getSkills: jest.fn().mockResolvedValue(SKILLS),
          getAvailability: jest.fn().mockResolvedValue(AVAILABILITY),
        }),
        makeSupabase(),
      );
      const bundle = await svc.getMyProfile('tok', 'user-1');
      expect(bundle).toEqual({
        profile: PROFILE,
        skills: SKILLS,
        availability: AVAILABILITY,
      });
    });

    it('404s when the caller has no profile', async () => {
      const svc = new ProfileService(
        makeRepo({ getProfileByUserId: jest.fn().mockResolvedValue(null) }),
        makeSupabase(),
      );
      await expect(svc.getMyProfile('tok', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createProfile', () => {
    it('inserts when none exists, with the caller as user_id owner', async () => {
      const insertProfile = jest.fn().mockResolvedValue(PROFILE);
      const svc = new ProfileService(
        makeRepo({
          getProfileByUserId: jest.fn().mockResolvedValue(null),
          insertProfile,
        }),
        makeSupabase(),
      );
      const created = await svc.createProfile('tok', 'user-1', {
        headline: 'Canada immigration expert',
      });
      expect(created).toBe(PROFILE);
      expect(insertProfile).toHaveBeenCalledWith(DB, 'user-1', {
        headline: 'Canada immigration expert',
      });
    });

    it('409s when a profile already exists (1:1 with user)', async () => {
      const svc = new ProfileService(
        makeRepo({ getProfileByUserId: jest.fn().mockResolvedValue(PROFILE) }),
        makeSupabase(),
      );
      await expect(
        svc.createProfile('tok', 'user-1', {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateProfile', () => {
    it('404s when there is no profile to update', async () => {
      const svc = new ProfileService(
        makeRepo({ getProfileByUserId: jest.fn().mockResolvedValue(null) }),
        makeSupabase(),
      );
      await expect(
        svc.updateProfile('tok', 'user-1', { headline: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('upsertSkills', () => {
    it('resolves the profile id then upserts skills against it', async () => {
      const upsertSkills = jest.fn().mockResolvedValue(SKILLS);
      const svc = new ProfileService(
        makeRepo({
          getProfileByUserId: jest.fn().mockResolvedValue(PROFILE),
          upsertSkills,
        }),
        makeSupabase(),
      );
      const out = await svc.upsertSkills('tok', 'user-1', {
        visa_types: ['express_entry'],
        languages: ['en', 'fr'],
      });
      expect(out).toBe(SKILLS);
      // keyed by the PROFILE id, not the user id
      expect(upsertSkills).toHaveBeenCalledWith(DB, 'prof-1', {
        visa_types: ['express_entry'],
        languages: ['en', 'fr'],
      });
    });

    it('404s when the caller must create a profile first', async () => {
      const svc = new ProfileService(
        makeRepo({ getProfileByUserId: jest.fn().mockResolvedValue(null) }),
        makeSupabase(),
      );
      await expect(
        svc.upsertSkills('tok', 'user-1', { visa_types: ['x'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('syncCountries', () => {
    it('mirrors active consultant_countries into countries_supported', async () => {
      const getActiveCountryCodes = jest.fn().mockResolvedValue(['CA', 'US']);
      const upsertSkills = jest
        .fn()
        .mockResolvedValue({ ...SKILLS, countries_supported: ['CA', 'US'] });
      const svc = new ProfileService(
        makeRepo({
          getProfileByUserId: jest.fn().mockResolvedValue(PROFILE),
          getActiveCountryCodes,
          upsertSkills,
        }),
        makeSupabase(),
      );
      const out = await svc.syncCountries('tok', 'user-1');
      expect(out.countries_supported).toEqual(['CA', 'US']);
      // codes read by user id; skills keyed by profile id
      expect(getActiveCountryCodes).toHaveBeenCalledWith(DB, 'user-1');
      expect(upsertSkills).toHaveBeenCalledWith(DB, 'prof-1', {
        countries_supported: ['CA', 'US'],
      });
    });
  });
});
