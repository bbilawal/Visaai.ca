import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IamModule } from '../iam/iam.module';
import { CryptoModule } from '../shared/crypto/crypto.module';
import { PARTNER_WEBHOOK_QUEUE } from '../shared/queue/queue.constants';
import { HttpWebhookSender } from './http-webhook.sender';
import { PartnerAuthGuard } from './partner-auth.guard';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerConsentService } from './partner-consent.service';
import { PartnerIdempotencyService } from './partner-idempotency.service';
import { PartnerOAuthController } from './partner-oauth.controller';
import { PartnerOAuthService } from './partner-oauth.service';
import { PartnerPortalController } from './partner-portal.controller';
import { PartnerRegistryService } from './partner-registry.service';
import { PartnerResourcesService } from './partner-resources.service';
import { PartnerResponseInterceptor } from './partner-response.interceptor';
import { PartnerSandboxService } from './partner-sandbox.service';
import { PartnerUsageService } from './partner-usage.service';
import { PartnerV1Controller } from './partner-v1.controller';
import { PartnerEventsPublisher } from './partner-events.publisher';
import {
  PartnerWebhookProcessor,
  PartnerWebhookScheduler,
} from './partner-webhook.processor';
import { PartnerWebhookService } from './partner-webhook.service';
import { PartnerRepository } from './partner.repository.impl';
import { PARTNER_REPOSITORY, PARTNER_WEBHOOK_SENDER } from './partner.tokens';

/**
 * Enterprise & Partner API Platform (Task 11).
 *
 * Reuses rather than rebuilds: `organizations` + `organization_members` as the
 * tenant model, the IAM permission catalog for portal authorization,
 * `FieldCryptoService` for webhook secrets, BullMQ for delivery, and the
 * existing `SupabaseService` (@Global).
 *
 * `PartnerEventsPublisher` is exported so other modules can emit partner
 * events without importing the whole webhook stack.
 */
@Module({
  imports: [
    CryptoModule,
    // PermissionsGuard resolves the caller's permission union via RolesService.
    IamModule,
    BullModule.registerQueue({ name: PARTNER_WEBHOOK_QUEUE }),
  ],
  controllers: [
    PartnerOAuthController,
    PartnerV1Controller,
    PartnerPortalController,
  ],
  providers: [
    { provide: PARTNER_REPOSITORY, useClass: PartnerRepository },
    { provide: PARTNER_WEBHOOK_SENDER, useClass: HttpWebhookSender },
    PartnerAuthService,
    PartnerAuthGuard,
    PartnerUsageService,
    PartnerIdempotencyService,
    PartnerOAuthService,
    PartnerConsentService,
    PartnerRegistryService,
    PartnerResourcesService,
    PartnerSandboxService,
    PartnerWebhookService,
    PartnerEventsPublisher,
    PartnerResponseInterceptor,
    PartnerWebhookProcessor,
    PartnerWebhookScheduler,
  ],
  exports: [PartnerEventsPublisher],
})
export class PartnerModule {}
