import { Inject, Injectable } from '@nestjs/common';
import { PRICING_REPOSITORY } from './pricing.repository';
import type {
  CountryFactorPatch,
  IPricingRepository,
  VisaTierPatch,
} from './pricing.repository';
import { PricingRecomputeService } from './pricing-recompute.service';

/**
 * PRICE-4 — admin config edits. Each write updates a config table then rebuilds
 * the materialized quote cache (PRICE-3) so the public quote reflects the change
 * with no deploy. Config is public-read/admin-write; these run behind
 * JwtGuard + RolesGuard('admin') at the controller.
 */
@Injectable()
export class PricingAdminService {
  constructor(
    @Inject(PRICING_REPOSITORY) private readonly repo: IPricingRepository,
    private readonly recompute: PricingRecomputeService,
  ) {}

  async updateConstant(key: string, value: number) {
    await this.repo.updateConstant(key, value);
    return this.afterChange();
  }

  async updateVisaTier(visaType: string, patch: VisaTierPatch) {
    await this.repo.updateVisaTier(visaType, patch);
    return this.afterChange();
  }

  async updateCountryFactor(countryCode: string, patch: CountryFactorPatch) {
    await this.repo.updateCountryFactor(countryCode, patch);
    return this.afterChange();
  }

  private async afterChange() {
    const { quotes } = await this.recompute.recomputeAll();
    return { recomputed: quotes };
  }
}
