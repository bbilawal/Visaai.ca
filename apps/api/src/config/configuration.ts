import { z } from 'zod';
import { assertEnvironmentIsolation } from './environment-isolation';

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    SUPABASE_URL: z.string().url(),
    /**
     * The base a BROWSER must use to reach Supabase Storage.
     *
     * Distinct from SUPABASE_URL because on the self-hosted VPS that value is
     * `http://127.0.0.1:54421` — Kong listens on loopback. Server-side calls
     * are happy with that; a signed URL handed to a customer is not, and every
     * upload and download link the API returned was silently unreachable
     * (MEASURED 2026-08-13: document uploads had been broken since the domain
     * cutover). Optional, and falls back to SUPABASE_URL, which is correct for
     * hosted Supabase and for local development where the two are the same.
     */
    SUPABASE_PUBLIC_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    // Anon key powers the per-request, RLS-enforcing client (see SupabaseService.forUser).
    // Request-path queries MUST use that client so Row-Level Security applies; the
    // service-role key bypasses RLS and is for background jobs / webhooks only.
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_JWT_SECRET: z.string().min(1),
    PORT: z.coerce.number().default(4000),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    // Separate signing secret if Connect events use a dedicated webhook endpoint.
    // Falls back to STRIPE_WEBHOOK_SECRET when unset (single-endpoint setups).
    STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1).optional(),
    // SP3: enable Stripe Tax (automatic_tax) on checkouts. Default off so
    // environments without Stripe Tax configured still create sessions.
    STRIPE_TAX_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // SP4: minimum consultant payout per sweep (cents). Below this, the balance
    // rolls to the next sweep to avoid fee-wasting micro-transfers.
    MIN_PAYOUT_CENTS: z.coerce.number().int().nonnegative().default(1000),
    // SP5: dunning reminder attempts before a past_due subscription is canceled.
    DUNNING_MAX_ATTEMPTS: z.coerce.number().int().positive().default(4),
    // Payment provider selection (SP1 abstraction). Only 'stripe' is implemented;
    // present so future providers are a config switch, not a code change.
    PAYMENT_PROVIDER_NAME: z.string().default('stripe'),
    // SP2 subscriptions. Default OFF; when on, SUBSCRIPTION_PRICES is required
    // (enforced in superRefine below).
    SUBSCRIPTIONS_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /**
     * User ids that bypass plan gates, comma-separated. EMPTY IN NORMAL
     * OPERATION.
     *
     * For staff and persona testing: walking the applicant journey end to end
     * otherwise means paying at the copilot gate on every new application,
     * because entitlement is per-application and a fresh one starts at `none`.
     *
     * Deliberately NOT a fake `subscriptions` row, which was the other obvious
     * route. That table requires a stripe_subscription_id and a
     * stripe_customer_id, so faking entitlement there means inventing Stripe
     * identifiers and leaving them for reconciliation to trip over later. An
     * explicit allowlist says what it is.
     *
     * Runtime, not build-time: it is removed by editing the api `.env` and
     * restarting — no rebuild — which is what makes it safe to grant for an
     * afternoon of testing and revoke before testing billing itself.
     *
     * The service logs the granted ids at boot, on purpose. A silent
     * entitlement bypass is how one outlives the test it was added for.
     */
    FREE_ACCESS_USER_IDS: z.string().optional().default(''),
    // SEC-1004: when true, @RequireMfa routes enforce aal2 step-up. Default
    // false so wiring the guard onto admin mutations cannot lock out an admin
    // who has not yet enrolled TOTP. Flip to 'true' only after every
    // platform/super admin has enrolled MFA via /profile.
    MFA_ENFORCE_ADMIN: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // JSON: { base:{month,year}, pro:{month,year}, premium:{month,year} } of Stripe Price ids.
    SUBSCRIPTION_PRICES: z.string().optional(),
    SUBSCRIPTION_TRIAL_DAYS: z.coerce.number().int().nonnegative().default(0),
    // Stripe Connect (consultant payouts, M4). Onboarding Account Link redirects;
    // default to the web consultant payouts page when unset.
    STRIPE_CONNECT_REFRESH_URL: z.string().url().optional(),
    STRIPE_CONNECT_RETURN_URL: z.string().url().optional(),
    WEB_URL: z.string().url().default('http://localhost:3000'),
    API_URL: z.string().url().default('http://localhost:4000'),
    SITE_MODE: z.enum(['global', 'canada']).default('global'),
    OPENAI_API_KEY: z.string().min(1),
    // F4: ordered AI provider fallback chain. Providers beyond openai activate
    // when their SDK + key are added. e.g. "openai,anthropic,gemini".
    AI_PROVIDERS: z.string().default('openai'),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    // Data-residency mode (global platform). Region-aware document processing:
    //  - regional: keep each user's data in their region; block cross-region egress
    //  - jurisdiction-specific: per-jurisdiction rules (strictest; e.g. EU + CA pinned)
    //  - global: no residency pinning (dev / non-regulated only)
    DATA_RESIDENCY_MODE: z
      .enum(['regional', 'global', 'jurisdiction-specific'])
      .default('global'),
    // OCR provider (vendor-agnostic). mock/openai are non-regional (dev only);
    // azure-di / aws-textract / google-docai are regional managed services.
    OCR_PROVIDER: z
      .enum(['mock', 'openai', 'azure-di', 'aws-textract', 'google-docai'])
      .default('mock'),
    // Processing region for OCR/storage routing (e.g. ca-central-1, eu, global).
    OCR_REGION: z.string().default('global'),
    AZURE_DOC_INTEL_ENDPOINT: z.string().url().optional(),
    AZURE_DOC_INTEL_KEY: z.string().min(1).optional(),
    // Analysis model. LEAVE UNSET to let the adapter route per document type:
    // prebuilt-idDocument for identity documents, prebuilt-layout + the
    // queryFields add-on for everything else (a bank statement or an admission
    // letter returns NO fields from idDocument). Setting this PINS one model
    // for every upload and disables query fields — which also means no add-on
    // billing, and no extracted fields for non-identity documents.
    AZURE_DOC_INTEL_MODEL: z.string().min(1).optional(),
    // derive_fields: a second, vendor-agnostic extraction pass over the OCR
    // TEXT, used to read the fields a provider's own document model does not
    // return (an admission letter's tuition, a deed's title number). It runs on
    // OpenAI, which is NON-REGIONAL — it therefore ships document text out of
    // region, exactly what DATA_RESIDENCY_MODE exists to prevent.
    //   auto (default) — on under 'global' residency, OFF otherwise.
    //   on             — explicit operator opt-in; accepts the egress.
    //   off            — never run.
    // No silent default that leaks: the gate fails closed under any residency
    // mode that pins data.
    OCR_DERIVE_FIELDS: z.enum(['auto', 'on', 'off']).default('auto'),
    AWS_OCR_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_OCR_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    GOOGLE_DOCAI_PROCESSOR_ID: z.string().min(1).optional(),
    GOOGLE_DOCAI_CREDENTIALS: z.string().min(1).optional(),
    // F3: malware scanning is MANDATORY for every upload (baseline content gate
    // always runs). SCAN_PROVIDER optionally adds an external AV engine on top.
    SCAN_PROVIDER: z.enum(['none', 'clamav', 'virustotal']).default('none'),
    // Max upload size the scan gate accepts (bytes). Default 15 MB.
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 1024 * 1024),
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    // Dedicated HMAC secret for unsubscribe/reminder links. Optional: when unset
    // it falls back to SUPABASE_SERVICE_ROLE_KEY (back-compat with already-sent
    // links). Set it to stop reusing the most-powerful key across trust domains.
    UNSUBSCRIBE_SIGNING_SECRET: z.string().min(16).optional(),
    // Observability (optional). SENTRY_DSN unset → error tracking is a no-op.
    SENTRY_DSN: z.string().url().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // CONFIG-002: no longer defaults to 'change-me-inbound-secret'. Nothing
    // reads this yet — the inbound-email monitor it guards does not exist — but
    // a placeholder default meant that when a consumer IS added, boot would
    // succeed on a known, published secret instead of failing closed.
    // Optional until the monitor ships; required-and-unset beats
    // present-and-worthless.
    INBOUND_WEBHOOK_SECRET: z.string().min(1).optional(),
    // F4: 32-byte key as 64 hex chars for AES-256-GCM field encryption.
    // Optional until the inbound-email monitor ships, but when present it must be
    // valid and must NOT be all zeros (the previous insecure default is removed).
    EMAIL_ENCRYPTION_KEY: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'EMAIL_ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
      )
      .refine(
        (k) => !/^0+$/.test(k),
        'EMAIL_ENCRYPTION_KEY must not be all zeros',
      )
      .optional(),
    // ARCH-002: POSTMARK_SERVER_TOKEN / POSTMARK_FROM_EMAIL removed. They were
    // already marked deprecated, read nowhere, and the `postmark` dependency
    // has been dropped. Email sends over SMTP via nodemailer (SMTP_* below).
    // SMTP transactional email (provider-agnostic: Resend/Brevo/SES/...). When
    // SMTP_HOST/USER/PASS are set, EmailService sends; absent → email no-ops.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
    SMTP_FROM: z.string().email().optional(),
    // P3b off-platform notifications. All optional; absent VAPID → push no-ops.
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1).optional(),
    // Mobile (Task 9) native push via Expo → APNs/FCM. Both optional:
    // EXPO_ACCESS_TOKEN unset still sends (Expo-managed credentials), but
    // production should set it so push-security enforcement is active.
    // MOBILE_PUSH_ENABLED=false hard-disables the channel (ExpoPushService no-ops).
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    MOBILE_PUSH_ENABLED: z.string().optional(),
    // CONFIG-003: NOT WIRED. Intended as the deep-link base for push routing,
    // but no code reads it — every notification path resolves links from
    // WEB_URL. Setting this has no effect today. Kept because the intent is
    // real; wiring it needs a device test (blocked, no Xcode/Android SDK here).
    MOBILE_APP_SCHEME: z.string().min(1).optional(),
    // Task 10 voice assistant. Provider chains default to `mock`, so a
    // deployment must opt in to a paid vendor explicitly — nothing starts
    // billing because a key happens to be present.
    VOICE_STT_PROVIDERS: z.string().optional(),
    VOICE_TTS_PROVIDERS: z.string().optional(),
    VOICE_STT_MODEL: z.string().optional(),
    VOICE_TTS_MODEL: z.string().optional(),
    VOICE_CONSENT_POLICY_VERSION: z.string().optional(),
    // Cost + usage limits. All optional; the module falls back to
    // DEFAULT_VOICE_LIMITS. 0 disables an individual check.
    VOICE_MAX_SESSION_MS: z.coerce.number().int().nonnegative().optional(),
    VOICE_MAX_AUDIO_MS: z.coerce.number().int().nonnegative().optional(),
    VOICE_MAX_CONCURRENT: z.coerce.number().int().nonnegative().optional(),
    VOICE_MAX_TOKENS: z.coerce.number().int().nonnegative().optional(),
    VOICE_MAX_SESSION_USD: z.coerce.number().nonnegative().optional(),
    VOICE_MAX_DAILY_USD: z.coerce.number().nonnegative().optional(),
    VOICE_MAX_MONTHLY_USD: z.coerce.number().nonnegative().optional(),
    VOICE_INACTIVITY_MS: z.coerce.number().int().nonnegative().optional(),
    VOICE_STREAMING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional(),
    VOICE_FREE_TIER_USD: z.coerce.number().nonnegative().optional(),
    // Increment 3: SMS channel. All optional; absent → SMS no-ops (SmsService).
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM_NUMBER: z.string().min(1).optional(),
    NOTIFICATION_EMAIL_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(300000),
    // Phase 4B: legacy socket-fill portal-write path. DEFAULT OFF. Only the
    // literal "true" enables it; otherwise ExecutionService is the sole
    // portal-write authority and the legacy path is hard-deprecated.
    LEGACY_AUTOMATION_WRITE_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // Phase 2 RBAC: comma-separated admin emails. Safe role-resolution fallback so
    // admins resolve to appRole='admin' even before app_metadata.role is seeded.
    ADMIN_EMAILS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    // Analytics SP-A. Warehouse backend selector (only 'supabase' + 'mock' exist).
    ANALYTICS_WAREHOUSE: z.enum(['supabase', 'mock']).default('supabase'),
    // Raw analytics_event_stream partitions older than this are dropped by the retention job.
    ANALYTICS_RAW_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(90),
    // Max events per bulk-insert batch-job.
    ANALYTICS_INGEST_BATCH: z.coerce.number().int().positive().default(100),
    // Max events accepted per POST /analytics/collect request.
    ANALYTICS_COLLECT_MAX_EVENTS: z.coerce
      .number()
      .int()
      .positive()
      .default(50),
    // Global rate limit. Was hardcoded at 60/min per IP in app.module. Made
    // configurable so a test run — which drives many requests from ONE
    // address — can raise it without weakening the production default.
    // PERF-003: short-TTL cache for validated access tokens. 0 disables it
    // and restores a GoTrue round-trip per request. Raising it increases the
    // window in which a signed-out or banned session still works.
    TOKEN_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(30_000),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(60),
    // Rollup recompute window (days back) each tick.
    ANALYTICS_ROLLUP_LOOKBACK_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    // Analytics SP-B (KPI engine). Source-read backend selector.
    KPI_SOURCE: z.enum(['supabase', 'mock']).default('supabase'),
    // KPI rollup recompute window (days back) each tick — re-catches late events.
    KPI_ROLLUP_LOOKBACK_DAYS: z.coerce.number().int().positive().default(3),
    // KPI rollup tick cadence (minutes).
    KPI_ROLLUP_INTERVAL_MIN: z.coerce.number().int().positive().default(15),
    // KPI cohort recompute cadence (hours).
    KPI_COHORT_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
    // meta.stale threshold for rollup-tier metrics (minutes).
    KPI_ROLLUP_STALE_MIN: z.coerce.number().int().positive().default(15),
    // meta.stale threshold for cohort-tier metrics (hours).
    KPI_COHORT_STALE_HOURS: z.coerce.number().int().positive().default(24),
    // Analytics SP-C (metrics/reports API). Request-cache TTL for metric results.
    ANALYTICS_CACHE_TTL_SEC: z.coerce.number().int().positive().default(60),
    // Scheduled-report dispatcher tick cadence (minutes).
    ANALYTICS_REPORTS_TICK_MIN: z.coerce.number().int().positive().default(5),
    // SP-E alert evaluator tick cadence (minutes).
    ANALYTICS_ALERTS_TICK_MIN: z.coerce.number().int().positive().default(5),

    // --- Task 15: feature flags -------------------------------------------
    // Deployment environment for flag targeting. Distinct from NODE_ENV, which
    // has no 'staging' member and never will: the closed-beta box runs a real
    // production build (NODE_ENV=production) against beta infrastructure, so
    // NODE_ENV cannot distinguish it from production. Defaults are derived in
    // `deployEnv()` below rather than here, so an unset value follows NODE_ENV.
    DEPLOY_ENV: z.enum(['development', 'staging', 'production']).optional(),
    // Comma-separated flag keys forced OFF / ON without touching the database.
    // This is the incident escape hatch: it works when Supabase is the thing
    // that is broken, and it survives a restart because it lives in the api
    // `.env` (runtime, no rebuild — see CLAUDE.md "Deployment").
    // FORCE_OFF beats FORCE_ON. When an operator has written a key into both
    // lists, they are mid-incident and the safe reading of the ambiguity is
    // "off".
    FEATURE_FLAGS_FORCE_OFF: z.string().optional(),
    FEATURE_FLAGS_FORCE_ON: z.string().optional(),
    // How long an evaluated flag row is cached in-process. This is the upper
    // bound on how long a flip takes to take effect on an already-running
    // instance, and it is what the rollback runbook quotes.
    FEATURE_FLAGS_CACHE_TTL_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(30_000),
  })
  .superRefine((cfg, ctx) => {
    // ── Selecting an unimplemented provider must fail at BOOT ────────────
    //
    // Both of these used to be accepted by config and then throw from deep
    // inside a request or a queue job: AI_PROVIDERS could name `anthropic` or
    // `gemini` (UnconfiguredProvider — throws on every call), and SCAN_PROVIDER
    // could name `clamav` or `virustotal` (scan-document has a TODO where the
    // engine call belongs, so every document fails closed).
    //
    // Failing closed is right; failing closed at 3am on a per-document basis
    // when the config could have refused to start is not. Same lesson as
    // OCR-001 — the enum advertised capability the code did not have.
    const IMPLEMENTED_AI_PROVIDERS = ['openai'];
    const namedAi = (cfg.AI_PROVIDERS ?? 'openai')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unimplementedAi = namedAi.filter(
      (n) => !IMPLEMENTED_AI_PROVIDERS.includes(n),
    );
    if (unimplementedAi.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_PROVIDERS'],
        message:
          `AI_PROVIDERS names provider(s) that are not implemented: ` +
          `${unimplementedAi.join(', ')}. They are declared slots with no SDK ` +
          `wired, so every call would throw. Implemented: ` +
          `${IMPLEMENTED_AI_PROVIDERS.join(', ')}.`,
      });
    }

    const IMPLEMENTED_SCAN_PROVIDERS = ['none'];
    if (!IMPLEMENTED_SCAN_PROVIDERS.includes(cfg.SCAN_PROVIDER)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCAN_PROVIDER'],
        message:
          `SCAN_PROVIDER "${cfg.SCAN_PROVIDER}" is not wired — scan-document ` +
          `has a TODO where the engine call belongs, so EVERY document would ` +
          `fail closed. Use 'none' (the built-in allowlist + magic-byte check ` +
          `still runs) until an engine is implemented.`,
      });
    }

    // In production, data-residency must be enforced (not global) and OCR must run
    // on a regional managed provider. Refuse to boot otherwise so raw identity/
    // financial documents can never silently egress to a non-regional service.
    if (cfg.NODE_ENV === 'production') {
      if (cfg.DATA_RESIDENCY_MODE === 'global') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATA_RESIDENCY_MODE'],
          message:
            'DATA_RESIDENCY_MODE must be regional or jurisdiction-specific in production',
        });
      }
      const REGIONAL_OCR = ['azure-di', 'aws-textract', 'google-docai'];
      if (!REGIONAL_OCR.includes(cfg.OCR_PROVIDER)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OCR_PROVIDER'],
          message: `OCR_PROVIDER must be a regional managed provider (${REGIONAL_OCR.join(', ')}) in production`,
        });
      }

      // ── No fabricated data may reach a real user ──────────────────────────
      //
      // Every mock provider in this codebase invents output: MockOcrProvider
      // returns `full_name: 'Test User'`, MockSttProvider returns
      // `mock-transcript: <lang> <hash>`, MockTtsProvider returns a synthetic
      // buffer instead of speech. In production that is not "degraded" — it is
      // wrong data written against a real person's immigration application.
      //
      // OCR was already covered above by an allowlist. These were not, and two
      // of them DEFAULT to mock when the variable is unset, so a production
      // deploy that simply forgot to set them would have shipped invented
      // transcripts to users.
      //
      // Deny-by-name is deliberate here rather than trusting a provider's own
      // `regional`/`available` flag: MockOcrProvider self-declares
      // `regional = true`, so any check that trusted self-attestation would
      // have passed it straight through.
      const mockVoice = (
        [
          ['VOICE_STT_PROVIDERS', cfg.VOICE_STT_PROVIDERS],
          ['VOICE_TTS_PROVIDERS', cfg.VOICE_TTS_PROVIDERS],
        ] as const
      ).filter(([, chain]) => {
        // Unset means the factory falls back to 'mock' — that is the dangerous
        // case, so treat absent exactly like an explicit 'mock'.
        const names = (chain ?? 'mock').split(',').map((s) => s.trim());
        return names.includes('mock');
      });
      for (const [key] of mockVoice) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must not use the 'mock' provider in production (it returns invented transcripts/audio). Set a real provider chain.`,
        });
      }

      if (cfg.ANALYTICS_WAREHOUSE === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ANALYTICS_WAREHOUSE'],
          message:
            "ANALYTICS_WAREHOUSE must not be 'mock' in production — events would be discarded while reporting success",
        });
      }
      if (cfg.KPI_SOURCE === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['KPI_SOURCE'],
          message:
            "KPI_SOURCE must not be 'mock' in production — dashboards would render seeded numbers as if they were real",
        });
      }
    }

    // SP2: enabling subscriptions requires a valid price catalog (base/pro/premium × month/year).
    if (cfg.SUBSCRIPTIONS_ENABLED) {
      let ok = false;
      if (cfg.SUBSCRIPTION_PRICES) {
        try {
          const p = JSON.parse(cfg.SUBSCRIPTION_PRICES);
          ok = ['base', 'pro', 'premium'].every(
            (t) => p[t]?.month && p[t]?.year,
          );
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUBSCRIPTION_PRICES'],
          message:
            'SUBSCRIPTION_PRICES (JSON with base/pro/premium × month/year) is required when SUBSCRIPTIONS_ENABLED=true',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid env: ${result.error.message}`);
  }

  // Task 13 §1: a non-production process must never be configured against
  // production resources. Checked after schema validation so the message is
  // about isolation rather than a missing variable, and enforced at boot
  // because the usual way this fails is a copied `.env` that works perfectly —
  // against real applicants' data.
  assertEnvironmentIsolation({
    env: result.data.NODE_ENV,
    supabaseUrl: result.data.SUPABASE_URL,
    redisUrl: result.data.REDIS_URL,
    webUrl: result.data.WEB_URL,
    stripeSecretKey: result.data.STRIPE_SECRET_KEY,
  });

  return result.data;
}
