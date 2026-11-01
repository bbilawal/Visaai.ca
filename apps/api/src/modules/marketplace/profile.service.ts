import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConsultantAvailability,
  ConsultantProfile,
  ConsultantSkills,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { ConsultantProfileBundle } from './marketplace.dto';
import {
  MARKETPLACE_REPOSITORY,
  type AvailabilityWriteInput,
  type IMarketplaceRepository,
  type ProfileWriteInput,
  type SkillsWriteInput,
} from './marketplace.repository';

/**
 * ProfileService — consultant self-serve over consultant_profiles + skills +
 * availability (MKT-1, MKT-2). Every operation runs under the caller's
 * RLS-scoped client (forUser), so owner-write is enforced by Postgres, not by
 * an app-layer ownership check. skills/availability are keyed by the PROFILE id
 * (consultant_profiles.id), which is resolved from the caller's user_id first.
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(MARKETPLACE_REPOSITORY)
    private readonly repo: IMarketplaceRepository,
    private readonly supabase: SupabaseService,
  ) {}

  /** The caller's own profile bundle (profile + skills + availability). */
  async getMyProfile(
    token: string,
    userId: string,
  ): Promise<ConsultantProfileBundle> {
    const db = this.supabase.forUser(token);
    const profile = await this.repo.getProfileByUserId(db, userId);
    if (!profile) {
      throw new NotFoundException('No consultant profile for this account');
    }
    const [skills, availability] = await Promise.all([
      this.repo.getSkills(db, profile.id),
      this.repo.getAvailability(db, profile.id),
    ]);
    return { profile, skills, availability };
  }

  /** Create the caller's profile (1:1 with their user — second create is 409). */
  async createProfile(
    token: string,
    userId: string,
    input: ProfileWriteInput,
  ): Promise<ConsultantProfile> {
    const db = this.supabase.forUser(token);
    const existing = await this.repo.getProfileByUserId(db, userId);
    if (existing) {
      throw new ConflictException(
        'Consultant profile already exists; update it instead',
      );
    }
    return this.repo.insertProfile(db, userId, input);
  }

  /** Patch the caller's profile. */
  async updateProfile(
    token: string,
    userId: string,
    patch: ProfileWriteInput,
  ): Promise<ConsultantProfile> {
    const db = this.supabase.forUser(token);
    await this.requireProfile(db, userId);
    return this.repo.updateProfile(db, userId, patch);
  }

  /** Upsert the caller's visa types + languages. */
  async upsertSkills(
    token: string,
    userId: string,
    input: SkillsWriteInput,
  ): Promise<ConsultantSkills> {
    const db = this.supabase.forUser(token);
    const profile = await this.requireProfile(db, userId);
    return this.repo.upsertSkills(db, profile.id, input);
  }

  /** Upsert the caller's availability (tz + working hours + capacity). */
  async upsertAvailability(
    token: string,
    userId: string,
    input: AvailabilityWriteInput,
  ): Promise<ConsultantAvailability> {
    const db = this.supabase.forUser(token);
    const profile = await this.requireProfile(db, userId);
    return this.repo.upsertAvailability(db, profile.id, input);
  }

  /**
   * Mirror consultant_countries (source of truth) into
   * consultant_skills.countries_supported. Both reads/writes are RLS-scoped: a
   * consultant may read their own consultant_countries and write their own
   * skills row.
   */
  async syncCountries(
    token: string,
    userId: string,
  ): Promise<ConsultantSkills> {
    const db = this.supabase.forUser(token);
    const profile = await this.requireProfile(db, userId);
    const codes = await this.repo.getActiveCountryCodes(db, userId);
    return this.repo.upsertSkills(db, profile.id, {
      countries_supported: codes,
    });
  }

  private async requireProfile(
    db: SupabaseClient,
    userId: string,
  ): Promise<ConsultantProfile> {
    const profile = await this.repo.getProfileByUserId(db, userId);
    if (!profile) {
      throw new NotFoundException('Create your consultant profile first');
    }
    return profile;
  }
}
