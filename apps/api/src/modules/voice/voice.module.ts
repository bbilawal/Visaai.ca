import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { AiModule } from '../shared/ai/ai.module';
import { GuardrailsModule } from '../shared/guardrails/guardrails.module';
import { VoiceController } from './voice.controller';
import { VoiceGateway } from './voice.gateway';
import { VoiceSessionService } from './voice-session.service';
import { VoiceOrchestrationService } from './voice-orchestration.service';
import { VoiceContextService } from './voice-context.service';
import { VOICE_REPOSITORY } from './voice.repository';
import { VoiceRepository } from './voice.repository.impl';
import { VoiceProviderRegistry } from './providers/voice-provider.factory';
import {
  VOICE_LIMITS,
  VOICE_POLICY_VERSION,
  VOICE_PROVIDER_REGISTRY,
} from './voice.tokens';
import { DEFAULT_VOICE_LIMITS, type VoiceLimits } from './voice-cost-control';

/**
 * Voice assistant (Task 10).
 *
 * Reuses rather than rebuilds: `AiService` for orchestration and provider
 * fallback, `AiUsageMeter` for spend, `GuardrailsService` for intent and output
 * filtering, and `SupabaseService` (@Global) for RLS-scoped data access.
 *
 * Every limit is config-driven so an operator can tighten or relax spend
 * without a deploy of new code.
 */
function num(
  config: ConfigService<Env>,
  key: string,
  fallback: number,
): number {
  const raw = config.get(key as never, { infer: true });
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

@Module({
  imports: [AiModule, GuardrailsModule],
  controllers: [VoiceController],
  providers: [
    VoiceSessionService,
    VoiceOrchestrationService,
    VoiceContextService,
    VoiceGateway,
    { provide: VOICE_REPOSITORY, useClass: VoiceRepository },
    {
      provide: VOICE_PROVIDER_REGISTRY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env>): VoiceProviderRegistry =>
        new VoiceProviderRegistry({
          // Default `mock`: a deployment must opt in to a paid vendor.
          sttChain:
            (config.get('VOICE_STT_PROVIDERS', { infer: true }) as string) ??
            'mock',
          ttsChain:
            (config.get('VOICE_TTS_PROVIDERS', { infer: true }) as string) ??
            'mock',
          openaiApiKey: config.get('OPENAI_API_KEY', { infer: true }),
          sttModel: config.get('VOICE_STT_MODEL', { infer: true }),
          ttsModel: config.get('VOICE_TTS_MODEL', { infer: true }),
          timeoutMs: num(config, 'VOICE_STREAMING_TIMEOUT_MS', 20_000),
        }),
    },
    {
      provide: VOICE_LIMITS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env>): VoiceLimits => ({
        maxSessionDurationMs: num(
          config,
          'VOICE_MAX_SESSION_MS',
          DEFAULT_VOICE_LIMITS.maxSessionDurationMs,
        ),
        maxAudioMs: num(
          config,
          'VOICE_MAX_AUDIO_MS',
          DEFAULT_VOICE_LIMITS.maxAudioMs,
        ),
        maxConcurrentSessions: num(
          config,
          'VOICE_MAX_CONCURRENT',
          DEFAULT_VOICE_LIMITS.maxConcurrentSessions,
        ),
        maxTokensPerSession: num(
          config,
          'VOICE_MAX_TOKENS',
          DEFAULT_VOICE_LIMITS.maxTokensPerSession,
        ),
        maxCostPerSessionUsd: num(
          config,
          'VOICE_MAX_SESSION_USD',
          DEFAULT_VOICE_LIMITS.maxCostPerSessionUsd,
        ),
        maxDailyCostUsd: num(
          config,
          'VOICE_MAX_DAILY_USD',
          DEFAULT_VOICE_LIMITS.maxDailyCostUsd,
        ),
        maxMonthlyCostUsd: num(
          config,
          'VOICE_MAX_MONTHLY_USD',
          DEFAULT_VOICE_LIMITS.maxMonthlyCostUsd,
        ),
        inactivityTimeoutMs: num(
          config,
          'VOICE_INACTIVITY_MS',
          DEFAULT_VOICE_LIMITS.inactivityTimeoutMs,
        ),
        streamingTimeoutMs: num(
          config,
          'VOICE_STREAMING_TIMEOUT_MS',
          DEFAULT_VOICE_LIMITS.streamingTimeoutMs,
        ),
        freeTierMonthlyUsd: num(
          config,
          'VOICE_FREE_TIER_USD',
          DEFAULT_VOICE_LIMITS.freeTierMonthlyUsd,
        ),
      }),
    },
    {
      provide: VOICE_POLICY_VERSION,
      inject: [ConfigService],
      // Bumping this invalidates every existing consent, by design: the user
      // agreed to different words and must be asked again.
      useFactory: (config: ConfigService<Env>): string =>
        (config.get('VOICE_CONSENT_POLICY_VERSION', {
          infer: true,
        }) as string) ?? 'v1',
    },
  ],
  exports: [VoiceSessionService],
})
export class VoiceModule {}
