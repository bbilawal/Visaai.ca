import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from './observability/logger.config';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/configuration';
import { SupabaseModule } from './modules/shared/supabase/supabase.module';
import { PaymentsModule } from './modules/shared/payments/payments.module';
// ARCH-003: registered explicitly now that PaymentsModule no longer imports it.
// It is @Global and binds PAYMENT_EVENT_RECORDER, which PaymentWebhookService
// resolves by token rather than by importing the ledger module.
import { LedgerModule } from './modules/ledger/ledger.module';
// ARCH-005: @Global users repository — keeps the `users` table out of controllers.
import { UserProfileModule } from './modules/shared/users/user-profile.module';
import { CryptoModule } from './modules/shared/crypto/crypto.module';
import { GuardrailsModule } from './modules/shared/guardrails/guardrails.module';
import { AiModule } from './modules/shared/ai/ai.module';
import { LangGraphModule } from './modules/shared/langgraph/langgraph.module';
import { QueueModule } from './modules/shared/queue/queue.module';
import { EmailModule } from './modules/shared/email/email.module';
import { EntitlementModule } from './modules/entitlement/entitlement.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { DiscountsModule } from './modules/discounts/discounts.module';
import { FinancialOpsModule } from './modules/financial-ops/financial-ops.module';
import { BillingAnalyticsModule } from './modules/billing-analytics/billing-analytics.module';
import { AnalyticsMetricsModule } from './modules/analytics-metrics/analytics-metrics.module';
import { AnalyticsApiModule } from './modules/analytics-api/analytics-api.module';
import { AnalyticsAlertsModule } from './modules/analytics-alerts/analytics-alerts.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { IntakeModule } from './modules/intake/intake.module';
import { CountriesModule } from './modules/countries/countries.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { VriModule } from './modules/vri/vri.module';
import { NarrativeModule } from './modules/narrative/narrative.module';
import { AutomationModule } from './modules/automation/automation.module';
import { PrefillModule } from './modules/prefill/prefill.module';
import { ProgressModule } from './modules/progress/progress.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { OutcomesModule } from './modules/outcomes/outcomes.module';
// Gate 2 / Phase 2C — registered in dependency order: Audit (leaf, @Global)
// first, then the trace/state/authority/safety/orchestration layers above it.
import { AuditModule } from './modules/audit/audit.module';
import { ProvenanceModule } from './modules/provenance/provenance.module';
import { VerificationModule } from './modules/verification/verification.module';
import { ConsultantModule } from './modules/consultant/consultant.module';
import { PreflightModule } from './modules/preflight/preflight.module';
import { ReviewItemsModule } from './modules/review-items/review-items.module';
import { EligibilityModule } from './modules/eligibility/eligibility.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { ExecutionRequestModule } from './modules/execution-request/execution-request.module';
import { PortalFillModule } from './modules/portal-fill/portal-fill.module';
import { VisaModule } from './modules/visa/visa.module';
import { MeModule } from './modules/me/me.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { AdminModule } from './modules/admin/admin.module';
import { EventBusModule } from './modules/event-bus/event-bus.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { ConsultationsModule } from './modules/consultations/consultations.module';
import { VoiceModule } from './modules/voice/voice.module';
import { CommissionModule } from './modules/commission/commission.module';
import { MatchingModule } from './modules/matching/matching.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { FormsModule } from './modules/forms/forms.module';
import { DocTemplatesModule } from './modules/doc-templates/doc-templates.module';
import { VisaSyncModule } from './modules/visa-sync/visa-sync.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { IamModule } from './modules/iam/iam.module';
import { PushModule } from './modules/shared/push/push.module';
import { SmsModule } from './modules/shared/sms/sms.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationBusModule } from './modules/notifications/notification-bus.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PartnerModule } from './modules/partner/partner.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { FeedbackModule } from './modules/feedback/feedback.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(loggerConfig),
    // Defaults stay 60 requests / minute per IP. Configurable because an e2e
    // run drives the whole suite from a single address and trips the limit —
    // pages then render their error boundary and the failure looks like a
    // product bug rather than a rate limit.
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 60),
      },
    ]),
    // @Global event bus (assignment lifecycle → SSE). Registered early so
    // emitters (Intake, Consultant) can inject it regardless of order.
    EventBusModule,
    // @Global notification event bus (producers → NotificationsService.emit).
    // Registered early so emitters (consultant, billing, vri) can inject it.
    NotificationBusModule,
    SupabaseModule,
    // @Global. Registered early so any module can consult a kill switch and so
    // @RequireFlag resolves FeatureFlagGuard without that module importing this
    // one. Depends only on SupabaseService + ConfigService.
    FeatureFlagsModule,
    LedgerModule,
    UserProfileModule,
    PaymentsModule,
    CryptoModule,
    GuardrailsModule,
    AiModule,
    LangGraphModule,
    QueueModule,
    EmailModule,
    EntitlementModule,
    AuthModule,
    BillingModule,
    SubscriptionsModule,
    PricingModule,
    DiscountsModule,
    FinancialOpsModule,
    BillingAnalyticsModule,
    AnalyticsMetricsModule,
    AnalyticsApiModule,
    AnalyticsAlertsModule,
    IntakeModule,
    CountriesModule,
    DocumentsModule,
    VriModule,
    NarrativeModule,
    AutomationModule,
    PrefillModule,
    ProgressModule,
    RemindersModule,
    OutcomesModule,
    // Phase 2C — Gate 2 services (Audit first; rest depend on it).
    AuditModule,
    ProvenanceModule,
    VerificationModule,
    ConsultantModule,
    MarketplaceModule,
    ConsultationsModule,
    VoiceModule,
    CommissionModule,
    MatchingModule,
    PayoutsModule,
    ReconciliationModule,
    FormsModule,
    DocTemplatesModule,
    VisaSyncModule,
    KnowledgeModule,
    IamModule,
    PreflightModule,
    ReviewItemsModule,
    EligibilityModule,
    ExecutionModule,
    ExecutionRequestModule,
    PortalFillModule,
    VisaModule,
    MeModule,
    PrivacyModule,
    AdminModule,
    RealtimeModule,
    MessagingModule,
    PushModule,
    SmsModule,
    NotificationsModule,
    AnalyticsModule,
    PartnerModule,
    FeedbackModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
