import { Inject, Injectable } from '@nestjs/common';
import type { UserProfile } from '@visaai/types';
import { IAM_REPOSITORY, type IIamRepository } from './iam.repository';

export type ProfilePatch = Partial<
  Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at'>
>;

/**
 * ProfileService — the expanded user profile (name, address, timezone, avatar,
 * privacy). Distinct from `public.users` (kept lean) and from
 * `application_profiles` (intake answers). RLS scopes user_profiles to the owner.
 */
@Injectable()
export class ProfileService {
  constructor(@Inject(IAM_REPOSITORY) private readonly repo: IIamRepository) {}

  async get(userId: string): Promise<UserProfile | null> {
    return this.repo.getProfile(userId);
  }

  async update(userId: string, patch: ProfilePatch): Promise<UserProfile> {
    return this.repo.upsertProfile(userId, patch);
  }
}
