import { Inject, Injectable, Logger } from '@nestjs/common';
import { PRICING_REPOSITORY } from './pricing.repository';
import type {
  IPricingRepository,
  PricingQuoteAuditRow,
  PricingQuoteRow,
} from './pricing.repository';
import { isSellableCatalogEntry, PricingService } from './pricing.service';
import type { PricingQuote } from './pricing.engine';

/**
 * PRICE-3 — rebuilds the materialized pricing_quotes cache over the priceable
 * visa×country matrix and appends an immutable pricing_quote_audit row per quote
 * ("why this price was shown", 07 §6.5). Runs nightly (scheduler) and is callable
 * on-config-change. Pure compute via PricingService.quoteWith; writes via the
 * service-role repo (recompute is a system path; pricing_quotes has no anon write).
 */
@Injectable()
export class PricingRecomputeService {
  private readonly log = new Logger(PricingRecomputeService.name);

  constructor(
    @Inject(PRICING_REPOSITORY) private readonly repo: IPricingRepository,
    private readonly pricing: PricingService,
  ) {}

  async recomputeAll(): Promise<{ computed: number; quotes: number }> {
    const [constants, visas, countries] = await Promise.all([
      this.repo.getConstants(),
      this.repo.listPriceableVisaTiers(),
      this.repo.listPriceableCountries(),
    ]);

    const quoteRows: PricingQuoteRow[] = [];
    const auditRows: PricingQuoteAuditRow[] = [];
    for (const v of visas) {
      for (const c of countries) {
        const q = this.pricing.quoteWith(constants, v, c);
        // The materialized cache IS the sellable catalog — same membership rule
        // the public read-path fallback applies, so the two cannot drift.
        if (!isSellableCatalogEntry(q)) continue;
        quoteRows.push(toQuoteRow(q));
        auditRows.push(toAuditRow(q));
      }
    }

    if (quoteRows.length) {
      await this.repo.upsertQuotes(quoteRows);
      await this.repo.insertQuoteAudit(auditRows);
    }

    const computed = visas.length * countries.length;
    this.log.log(
      `pricing recompute: ${quoteRows.length}/${computed} quotes materialized`,
    );
    return { computed, quotes: quoteRows.length };
  }
}

function toQuoteRow(q: PricingQuote): PricingQuoteRow {
  return {
    visa_type: q.visa_type,
    country_code: q.country_code,
    recommended_price: q.price as number,
    floor_price: q.band.floor,
    ceiling_price: q.band.ceiling,
    gross_margin: q.gross_margin as number,
    total_cogs: q.total_cogs,
    breakdown: q.breakdown as unknown as Record<string, unknown>,
    flags: q.flags,
  };
}

function toAuditRow(q: PricingQuote): PricingQuoteAuditRow {
  return {
    visa_type: q.visa_type,
    country_code: q.country_code,
    recommended_price: q.price as number,
    gross_margin: q.gross_margin as number,
    breakdown: q.breakdown as unknown as Record<string, unknown>,
    event: 'recompute',
  };
}
