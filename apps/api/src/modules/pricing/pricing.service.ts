import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  computeQuote,
  type PricingConstants,
  type PricingCountryFactor,
  type PricingQuote,
  type PricingVisaTier,
} from './pricing.engine';
import { PRICING_REPOSITORY } from './pricing.repository';
import type { IPricingRepository } from './pricing.repository';
import { marketInputsFor } from './pricing.reference';
import {
  GOV_FEE_NOTE,
  type ExcludedQuote,
  type PublicQuote,
} from './pricing.dto';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';

// v1 sellable floor — tracks the seeded pricing_constants.min_margin. A quote may
// reach checkout only at/above this margin, non-excluded, and not a deferred high-tier.
const SELLABLE_MIN_MARGIN = 0.55;

/**
 * The server-side checkout gate (PRICE-6 security boundary). The client never
 * supplies a price; the server recomputes and this decides if it may be charged.
 * Returns a human reason when the quote must be blocked, or null when sellable.
 */
export function checkoutBlockReason(q: PricingQuote): string | null {
  if (q.price === null) return q.reason ?? 'this visa/country is not available';
  if (q.flags.includes('lawyer_flag')) {
    return 'this application needs specialist review and is not available for self-checkout yet';
  }
  if (q.gross_margin !== null && q.gross_margin < SELLABLE_MIN_MARGIN) {
    return 'price unavailable for this corridor';
  }
  return null;
}

/**
 * Membership rule for the sellable catalog (07 §5 / roadmap v1 = profit core
 * T1–T3): a corridor with no price is not sellable, and high-tier lawyer SKUs
 * stay quotable on demand for manual handling rather than being listed.
 *
 * Shared by the materializer and the public read-path fallback so the two can
 * never disagree about what the catalog contains.
 */
export function isSellableCatalogEntry(
  q: PricingQuote,
): q is PricingQuote & { price: number } {
  return q.price !== null && !q.flags.includes('lawyer_flag');
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(PRICING_REPOSITORY) private readonly repo: IPricingRepository,
    @Optional() private readonly analytics?: AnalyticsEventBus,
  ) {}

  /**
   * Deterministic quote for a (visa, country) pair (07 §2). Pure given the config
   * snapshot — no writes, no clock. `demand` is the bounded surge factor (v1 = 1.0).
   */
  async quote(
    visaType: string,
    countryCode: string,
    demand = 1.0,
  ): Promise<PricingQuote> {
    const [constants, visaTier, countryFactor] = await Promise.all([
      this.repo.getConstants(),
      this.repo.getVisaTier(visaType),
      this.repo.getCountryFactor(countryCode),
    ]);

    if (!visaTier)
      throw new NotFoundException(`unknown visa type: ${visaType}`);
    if (!countryFactor)
      throw new NotFoundException(`unknown country: ${countryCode}`);

    // NOTE: no analytics emit here. quote() is the shared compute reached by the
    // PUBLIC unauthenticated GET /pricing/quote (getPublicQuote) on every cache
    // miss — and lawyer_flag SKUs are never cached, so anon/bot hits would flood
    // quote.generated with user_id:null. quote.generated is emitted ONLY from the
    // authenticated purchase-adjacent callers (getCheckoutQuote, quoteForDiscount).
    return this.quoteWith(constants, visaTier, countryFactor, demand);
  }

  /** Allowlisted non-PII quote.generated emit (ids/enums/amount — no margin/cogs/
   *  breakdown). Fired only from authenticated purchase-adjacent paths, so this is
   *  a quote-for-purchase signal, never a public price peek. */
  private emitQuoteGenerated(q: PricingQuote, userId: string | null): void {
    this.analytics?.emitSafe(
      makeServerEvent('quote.generated', {
        user_id: userId,
        props: {
          country: q.country_code,
          visa_type: q.visa_type,
          amount_cents: q.price !== null ? Math.round(q.price * 100) : null,
        },
      }),
    );
  }

  /**
   * SP3 discount guardrail input: the list price + COGS + floor for a corridor,
   * in cents. Throws for a non-sellable corridor so a coupon can never be applied
   * to an excluded price.
   */
  async quoteForDiscount(
    visaType: string,
    countryCode: string,
  ): Promise<{ listCents: number; cogsCents: number; minMargin: number }> {
    const q = await this.quote(visaType, countryCode);
    if (q.price === null) {
      throw new BadRequestException('price unavailable for this corridor');
    }
    // Purchase-adjacent (a discount is only quoted at checkout intent). No userId
    // in scope on this path — emit with user_id:null; still distinct from a public
    // price peek because getPublicQuote never reaches this method.
    this.emitQuoteGenerated(q, null);
    const constants = await this.repo.getConstants();
    return {
      listCents: Math.round(q.price * 100),
      cogsCents: Math.round(q.total_cogs * 100),
      minMargin: constants.min_margin,
    };
  }

  /** Pure compute from an already-loaded config snapshot (used by the recompute job). */
  quoteWith(
    constants: PricingConstants,
    visaTier: PricingVisaTier,
    countryFactor: PricingCountryFactor,
    demand = 1.0,
  ): PricingQuote {
    const market = marketInputsFor(visaTier, countryFactor);
    return computeQuote({ constants, visaTier, countryFactor, market, demand });
  }

  /**
   * Public quote (PRICE-4): served from the materialized cache, stripped of any
   * internal economics (margin/cogs/floor). A non-priceable visa/country or a
   * v1-deferred high-tier (lawyer) SKU returns a clear excluded response.
   */
  async getPublicQuote(
    visaType: string,
    countryCode: string,
  ): Promise<PublicQuote | ExcludedQuote> {
    const cached = await this.repo.getQuote(visaType, countryCode);
    if (cached) {
      return this.toPublic(
        cached.visa_type,
        cached.country_code,
        cached.recommended_price,
      );
    }
    // Not cached → compute on-demand to classify (also 404s unknown ids).
    const q = await this.quote(visaType, countryCode);
    if (q.price === null || q.flags.includes('lawyer_flag')) {
      return {
        visa_type: q.visa_type,
        country_code: q.country_code,
        excluded: true,
        reason: q.reason ?? 'not available in this corridor yet',
      };
    }
    return this.toPublic(q.visa_type, q.country_code, q.price);
  }

  /**
   * Authoritative quote for checkout (PRICE-6): recomputes server-side, applies
   * the floor gate, and on success records a 'shown' audit row (who saw which
   * price + breakdown). Throws BadRequest for any non-sellable combo so a
   * tampered/stale/excluded price can never reach Stripe.
   */
  async getCheckoutQuote(
    visaType: string,
    countryCode: string,
    userId: string,
  ): Promise<PublicQuote> {
    const q = await this.quote(visaType, countryCode);
    const blocked = checkoutBlockReason(q);
    if (blocked) throw new BadRequestException(blocked);

    // Authenticated quote-for-purchase — the strongest purchase-intent signal.
    this.emitQuoteGenerated(q, userId);

    await this.repo.insertQuoteAudit([
      {
        visa_type: q.visa_type,
        country_code: q.country_code,
        recommended_price: q.price as number,
        gross_margin: q.gross_margin as number,
        breakdown: q.breakdown as unknown as Record<string, unknown>,
        event: 'shown',
        shown_to_user: userId,
      },
    ]);
    return this.toPublic(q.visa_type, q.country_code, q.price as number);
  }

  /**
   * The public price catalog. Normally served straight from the materialized
   * pricing_quotes cache; when that cache is empty it is computed on demand from
   * the config inputs instead of returning nothing.
   *
   * The cache is derived data with exactly one writer (PricingRecomputeService).
   * Any window where that job has not run yet, has failed, or the table has been
   * cleared would otherwise leave /pricing — a primary conversion surface — with
   * no price at all, even though every input needed to compute one is present
   * and healthy. The fallback is read-only: it deliberately does NOT materialize
   * or audit, so a public GET can never write to pricing_quotes.
   */
  async listPublicQuotes(): Promise<PublicQuote[]> {
    const rows = await this.repo.listQuotes();
    if (rows.length) {
      return rows.map((r) =>
        this.toPublic(r.visa_type, r.country_code, r.recommended_price),
      );
    }
    return this.computeSellableCatalog();
  }

  /** Pure recompute of the sellable catalog — same engine and same selection
   *  rule as the materializer, so the fallback can never price differently. */
  private async computeSellableCatalog(): Promise<PublicQuote[]> {
    const [constants, visas, countries] = await Promise.all([
      this.repo.getConstants(),
      this.repo.listPriceableVisaTiers(),
      this.repo.listPriceableCountries(),
    ]);

    const quotes: PublicQuote[] = [];
    for (const v of visas) {
      for (const c of countries) {
        const q = this.quoteWith(constants, v, c);
        if (!isSellableCatalogEntry(q)) continue;
        quotes.push(this.toPublic(q.visa_type, q.country_code, q.price));
      }
    }
    return quotes;
  }

  listCountries() {
    return this.repo.listPriceableCountries();
  }

  listVisas() {
    return this.repo.listPriceableVisaTiers();
  }

  private toPublic(
    visa_type: string,
    country_code: string,
    price: number,
  ): PublicQuote {
    return {
      visa_type,
      country_code,
      price,
      currency: 'USD',
      gov_fee_note: GOV_FEE_NOTE,
    };
  }
}
