import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConsultantCard, ConsultantReview } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { ConsultantDetail, CreateReviewDto } from './marketplace.dto';
import {
  DuplicateReviewError,
  MARKETPLACE_REPOSITORY,
  type DiscoveryFilters,
  type DiscoveryRow,
  type IMarketplaceRepository,
} from './marketplace.repository';

/**
 * DiscoveryService — public browse/compare + reviews (MKT-3, MKT-4).
 *
 * Reads run under the caller's RLS-scoped client (forUser) so the public-read
 * policy decides which profiles are visible (active only, here also pinned with
 * an explicit active filter). Display names come from public.users via the
 * service-role client — users RLS is own-row-only, but a consultant's name is
 * intentionally public on their card. Review writes are RLS author-write
 * (user_id == caller); the one-per-case unique surfaces as a 409.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(MARKETPLACE_REPOSITORY)
    private readonly repo: IMarketplaceRepository,
    private readonly supabase: SupabaseService,
  ) {}

  /** Public discovery list -> ConsultantCard[] (rating desc, filtered). */
  async listConsultants(
    token: string,
    filters: DiscoveryFilters,
  ): Promise<ConsultantCard[]> {
    const db = this.supabase.forUser(token);
    const rows = await this.repo.listConsultants(db, filters);
    const names = await this.repo.getFullNames(
      this.supabase.admin,
      rows.map((r) => r.user_id),
    );
    return rows.map((r) => this.toCard(r, names.get(r.user_id) ?? null));
  }

  /** Single consultant detail (profile + name + skills + availability). */
  async getConsultant(token: string, id: string): Promise<ConsultantDetail> {
    const db = this.supabase.forUser(token);
    const detail = await this.repo.getConsultantDetail(db, id);
    if (!detail) {
      throw new NotFoundException('Consultant not found');
    }
    const names = await this.repo.getFullNames(this.supabase.admin, [
      detail.profile.user_id,
    ]);

    // WHITELIST, never a spread of the row. This route is @AllowAnonymous, and
    // RLS is row-level — it does not filter columns — so spreading the profile
    // published stripe_connect_account_id, payouts_enabled, kyc_status and the
    // internal user_id to any visitor. Listing fields explicitly also means a
    // column added to consultant_profiles later cannot leak by default.
    const p = detail.profile;
    return {
      id: p.id,
      headline: p.headline,
      bio: p.bio,
      specialization: p.specialization,
      years_experience: p.years_experience,
      license_number: p.license_number,
      license_authority: p.license_authority,
      license_country: p.license_country,
      license_verified: p.license_verified,
      hourly_rate_usd: p.hourly_rate_usd,
      rating_avg: p.rating_avg,
      rating_count: p.rating_count,
      active_status: p.active_status,
      full_name: names.get(p.user_id) ?? null,
      skills: detail.skills,
      availability: detail.availability,
    };
  }

  /** Post a review for a consultant (one per case; author == caller). */
  async createReview(
    token: string,
    consultantId: string,
    userId: string,
    input: CreateReviewDto,
  ): Promise<ConsultantReview> {
    const db = this.supabase.forUser(token);

    // SEC-2001: a review may reference an application, but only one the caller
    // owns — otherwise a user could attach their review to someone else's case.
    let applicationId: string | null = null;
    if (input.application_id) {
      const { data: owned } = await db
        .from('applications')
        .select('id')
        .eq('id', input.application_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!owned) {
        throw new BadRequestException(
          'application_id does not belong to the reviewer',
        );
      }
      applicationId = input.application_id;
    }

    try {
      return await this.repo.insertReview(db, {
        consultant_id: consultantId,
        user_id: userId,
        application_id: applicationId,
        rating: input.rating,
        feedback: input.feedback ?? null,
      });
    } catch (err) {
      if (err instanceof DuplicateReviewError) {
        throw new ConflictException(
          'You have already reviewed this consultant for this case',
        );
      }
      throw err;
    }
  }

  /** List a consultant's reviews (newest first). */
  async listReviews(
    token: string,
    consultantId: string,
  ): Promise<ConsultantReview[]> {
    const db = this.supabase.forUser(token);
    return this.repo.listReviews(db, consultantId);
  }

  private toCard(r: DiscoveryRow, fullName: string | null): ConsultantCard {
    return {
      id: r.id,
      full_name: fullName,
      headline: r.headline,
      specialization: r.specialization,
      countries_supported: r.countries_supported,
      visa_types: r.visa_types,
      languages: r.languages,
      years_experience: r.years_experience,
      hourly_rate_usd: r.hourly_rate_usd,
      rating_avg: r.rating_avg,
      rating_count: r.rating_count,
      active_status: r.active_status,
    };
  }
}
