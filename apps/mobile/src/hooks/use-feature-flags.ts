import { useEffect, useState } from 'react';
import { featureFlagsApi } from '@/api/endpoints';

/**
 * Registry defaults, mirroring `apps/api/.../flag-registry.ts` and
 * `apps/web/lib/api/feature-flags-client.ts`.
 *
 * A mobile client needs these more than the web one does: a phone is routinely
 * offline at launch, so "we could not reach the flags endpoint" is a normal
 * state rather than an incident. Each value answers "what should happen when we
 * cannot ask", which is why the live subsystems default ON — a user on the
 * subway must not be told payments are disabled.
 *
 * Kept in sync by `apps/web/lib/api/feature-flags-client.test.ts`, which parses
 * the API registry; this file is asserted against the same list in
 * `use-feature-flags.test.ts`.
 */
export const DEFAULT_FLAGS: Record<string, boolean> = {
  ai_generation_enabled: true,
  payments_enabled: true,
  consultant_marketplace_enabled: true,
  portal_autofill_enabled: false,
  voice_assistant_enabled: false,
  beta_banner_enabled: false,
  beta_feedback_widget_enabled: false,
};

export interface FeatureFlagsState {
  flags: Record<string, boolean>;
  loading: boolean;
  /** True while the values in hand are local defaults rather than the server's. */
  degraded: boolean;
}

/**
 * Fetches evaluated flags once per mount.
 *
 * No caching to disk on purpose. A kill switch that survives an app restart from
 * a stale cache is worse than no kill switch: the operator flips it, the client
 * keeps the old answer, and nobody can tell which build is honouring it. In-
 * memory only means the worst case is one request per cold start, and the
 * defaults cover the offline case.
 */
export function useFeatureFlags(): FeatureFlagsState {
  const [state, setState] = useState<FeatureFlagsState>({
    flags: DEFAULT_FLAGS,
    loading: true,
    degraded: true,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await featureFlagsApi.get();
        if (!cancelled) {
          setState({
            flags: { ...DEFAULT_FLAGS, ...(res?.flags ?? {}) },
            loading: false,
            degraded: false,
          });
        }
      } catch {
        // Offline or API down — keep the defaults and say so.
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** Read one flag out of an already-fetched state. */
export function flagValue(state: FeatureFlagsState, key: string): boolean {
  return state.flags[key] ?? DEFAULT_FLAGS[key] ?? false;
}
