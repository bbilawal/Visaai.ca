import { Injectable } from '@nestjs/common';
import { AnalyticsEventBus } from '../analytics-event-bus';
import { makeServerEvent } from '../events/catalog';
import type {
  AiCompletedTelemetry,
  AiRequestTelemetry,
  AiTelemetrySink,
} from '../../shared/ai/ai-telemetry.port';

/**
 * ARCH-003: the adapter half of the inversion. `shared/ai` declares the
 * `AiTelemetrySink` port; this translates it into analytics events and puts
 * them on the bus.
 *
 * The dependency now runs analytics -> shared, which is the direction the
 * layering already wanted. `shared` no longer imports `analytics`, so the
 * six-module cycle is gone and the analytics event schema stays inside
 * `analytics` where it belongs.
 *
 * `emitSafe` never propagates to the producer, which satisfies the port's
 * non-throwing contract: telemetry must not fail the AI call that produced it.
 */
@Injectable()
export class AnalyticsAiTelemetryAdapter implements AiTelemetrySink {
  constructor(private readonly bus: AnalyticsEventBus) {}

  aiRequest(t: AiRequestTelemetry): void {
    this.bus.emitSafe(
      makeServerEvent('ai.request', {
        user_id: t.userId,
        application_id: t.applicationId,
        props: { provider: t.provider, operation: t.operation },
      }),
    );
  }

  aiCompleted(t: AiCompletedTelemetry): void {
    this.bus.emitSafe(
      makeServerEvent('ai.completed', {
        user_id: t.userId,
        application_id: t.applicationId,
        props: {
          provider: t.provider,
          model: t.model,
          input_tokens: t.inputTokens,
          output_tokens: t.outputTokens,
        },
      }),
    );
  }
}
