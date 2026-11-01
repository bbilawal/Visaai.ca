import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ConsultantActiveStatus, ConsultantProfile } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  MARKETPLACE_REPOSITORY,
  type IMarketplaceRepository,
} from './marketplace.repository';

/** A profile awaiting review, plus the display name so the queue is readable. */
export interface ReviewableConsultant extends ConsultantProfile {
  full_name: string | null;
}

/**
 * Admin review of consultant marketplace profiles.
 *
 * A consultant can self-serve their profile only as far as `pending_review`;
 * `active` (listed and bookable) and `suspended` are deliberately admin-only.
 * Nothing consumed that, so a submitted profile sat in a queue with no way to
 * process it — self-onboarding led nowhere.
 *
 * Reads and writes go through the service-role client on purpose: reviewing
 * means acting on rows the reviewer does not own, which the owner-scoped RLS
 * policies correctly forbid. The route is admin-gated; that is the boundary.
 */
@Injectable()
export class MarketplaceAdminService {
  private readonly log = new Logger(MarketplaceAdminService.name);

  constructor(
    @Inject(MARKETPLACE_REPOSITORY)
    private readonly repo: IMarketplaceRepository,
    private readonly supabase: SupabaseService,
  ) {}

  async listByStatus(
    status: ConsultantActiveStatus,
  ): Promise<ReviewableConsultant[]> {
    const profiles = await this.repo.listProfilesByStatus(
      this.supabase.admin,
      status,
    );
    const names = await this.repo.getFullNames(
      this.supabase.admin,
      profiles.map((p) => p.user_id),
    );
    return profiles.map((p) => ({
      ...p,
      full_name: names.get(p.user_id) ?? null,
    }));
  }

  /**
   * Approve (`active`), suspend, or send a profile back to `draft` for changes.
   * `pending_review` is not settable here — that transition belongs to the
   * consultant submitting, not to a reviewer.
   */
  async setStatus(
    profileId: string,
    status: Extract<ConsultantActiveStatus, 'active' | 'suspended' | 'draft'>,
  ): Promise<ConsultantProfile> {
    const updated = await this.repo.setProfileStatus(
      this.supabase.admin,
      profileId,
      status,
    );
    if (!updated) throw new BadRequestException('Consultant profile not found');
    this.log.log(`consultant ${profileId} -> ${status}`);
    return updated;
  }
}
