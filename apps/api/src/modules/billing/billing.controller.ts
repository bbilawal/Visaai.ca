import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtGuard } from '../auth/jwt.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import {
  FeatureFlagGuard,
  RequireFlag,
} from '../feature-flags/feature-flag.guard';
import { BillingService } from './billing.service';
import { PaymentWebhookService } from '../shared/payments/payment-webhook.service';
import type { AuthUser } from '../auth/jwt.guard';
import {
  AddonCheckoutBodyDto,
  CheckoutBodyDto,
  PortalBodyDto,
  PrefillCheckoutBodyDto,
  ProcessingFeeCheckoutBodyDto,
  ServiceOrderCheckoutBodyDto,
} from './billing.dto';
import type { z } from 'zod';

/** Parse an untrusted body against a zod schema or fail with a 400. */
function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

/**
 * `payments_enabled` (Task 15) gates the five routes that CREATE a charge, and
 * deliberately nothing else. What is left ungated matters more than what is:
 *
 *  - `POST /billing/webhook` and `POST /billing/webhook/connect` — Stripe must
 *    always be able to deliver events. Gating them would mean a kill switch
 *    silently dropped the state changes for charges that were already in flight
 *    when it was thrown, and reconciliation would then disagree with Stripe with
 *    no record of why.
 *  - `POST /billing/portal` — the Stripe billing portal is where a customer
 *    cancels or updates a card. Freezing new charges must not also trap someone
 *    in a subscription they are trying to leave.
 *  - `GET /billing/history` — read-only. A user is entitled to see what they
 *    have been charged during an incident, not least to decide whether to
 *    dispute it.
 *
 * The switch is therefore "stop taking new money", not "turn off billing".
 */
@Controller('billing')
export class BillingController {
  constructor(
    private billing: BillingService,
    private paymentWebhook: PaymentWebhookService,
  ) {}

  @Post('checkout')
  @UseGuards(JwtGuard, FeatureFlagGuard)
  @RequireFlag('payments_enabled')
  async createCheckout(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const dto = parse(CheckoutBodyDto, body);
    return this.billing.createCheckoutSession(db, {
      userId: user.id,
      applicationId: dto.applicationId,
      planTier: dto.planTier,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  @Post('checkout/prefill')
  @UseGuards(JwtGuard, FeatureFlagGuard)
  @RequireFlag('payments_enabled')
  async createPrefillCheckout(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const dto = parse(PrefillCheckoutBodyDto, body);
    return this.billing.createPrefillCheckoutSession(db, {
      userId: user.id,
      applicationId: dto.applicationId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  @Post('checkout/processing-fee')
  @UseGuards(JwtGuard, FeatureFlagGuard)
  @RequireFlag('payments_enabled')
  async createProcessingFeeCheckout(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const dto = parse(ProcessingFeeCheckoutBodyDto, body);
    return this.billing.createProcessingFeeCheckout(db, {
      userId: user.id,
      applicationId: dto.applicationId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      couponCode: dto.couponCode,
    });
  }

  @Post('checkout/addon')
  @UseGuards(JwtGuard, FeatureFlagGuard)
  @RequireFlag('payments_enabled')
  async createAddonCheckout(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const dto = parse(AddonCheckoutBodyDto, body);
    return this.billing.createAddonCheckout(db, {
      userId: user.id,
      applicationId: dto.applicationId,
      addonSku: dto.addonSku,
      couponCode: dto.couponCode,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  @Post('portal')
  @UseGuards(JwtGuard)
  async portal(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto = parse(PortalBodyDto, body);
    return this.billing.createPortalSession(user.id, dto.returnUrl);
  }

  @Get('history')
  @UseGuards(JwtGuard)
  async history(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.getHistory(db, user.id);
  }

  @Post('checkout/service-order')
  @UseGuards(JwtGuard, FeatureFlagGuard)
  @RequireFlag('payments_enabled')
  async createServiceOrderCheckout(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const dto = parse(ServiceOrderCheckoutBodyDto, body);
    return this.billing.createServiceOrderCheckout(db, {
      userId: user.id,
      consultantId: dto.consultantId,
      serviceType: dto.serviceType,
      applicationId: dto.applicationId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  @Post('webhook')
  @SkipThrottle()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    await this.paymentWebhook.handle(req.rawBody!, signature, 'platform');
    return { received: true };
  }

  /**
   * Connect deliveries (account.updated, transfer.reversed) land here rather than
   * on `POST /billing/webhook`. They come from a separate Stripe webhook endpoint
   * with its own signing secret, so they must be verified against
   * STRIPE_CONNECT_WEBHOOK_SECRET — which only happens when the provider is
   * handed kind:'connect'. Ungated for the same reason as the platform endpoint.
   */
  @Post('webhook/connect')
  @SkipThrottle()
  async handleConnectWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    await this.paymentWebhook.handle(req.rawBody!, signature, 'connect');
    return { received: true };
  }
}
