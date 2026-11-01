/**
 * ARCH-003: `shared` is the base layer — 43 of 51 modules depend on it — but it
 * imported *back up* into `analytics`, creating a strongly-connected group of
 * six modules (analytics, auth, entitlement, ledger, shared, subscriptions).
 * Nothing failed to build, but `shared` could not be reasoned about, tested or
 * extracted without dragging `analytics` along, and every importer of `shared`
 * transitively pulled it in.
 *
 * This is the port half of the inversion. `shared` declares the narrow shape it
 * needs; `analytics` supplies an adapter under the same token and depends on
 * `shared`, which is the direction the layering already wanted.
 *
 * Deliberately NOT a generic `emit(event)`. Passing an `AnalyticsEvent` across
 * the boundary would put the analytics schema back in `shared` and re-create the
 * coupling under a different name. These two methods are the entire AI surface.
 *
 * Every implementation must be non-throwing: telemetry is fire-and-forget and a
 * subscriber fault must never fail the AI call that produced it.
 */

export interface AiRequestTelemetry {
  userId: string | null;
  applicationId: string | null;
  /** The INTENDED provider (head of the chain), not necessarily the one that succeeds. */
  provider: string | null;
  operation: string;
}

export interface AiCompletedTelemetry {
  userId: string | null;
  applicationId: string | null;
  /** The provider that actually succeeded — may differ from the requested one on fallback. */
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiTelemetrySink {
  aiRequest(t: AiRequestTelemetry): void;
  aiCompleted(t: AiCompletedTelemetry): void;
}

/** Injection token. Optional everywhere — absent means telemetry is simply off. */
export const AI_TELEMETRY = Symbol('AI_TELEMETRY');
