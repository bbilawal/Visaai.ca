// Client-safe feature-flag reads. MUST NOT import ./server (next/headers):
// this module is imported by 'use client' components.
import { apiFetch } from './client'

/** Evaluated booleans keyed by flag key. Targeting rules never cross the wire. */
export type FlagMap = Record<string, boolean>

/**
 * Registry defaults, duplicated from the API's `flag-registry.ts`.
 *
 * Duplication is the point. This is what the UI renders while the first fetch
 * is in flight and what it falls back to when the API is unreachable — the two
 * moments when asking the server is exactly what is not possible. The values
 * must therefore be a local constant, and they must match the server's
 * `defaultValue` field. `feature-flags.test.ts` pins the shape so the two lists
 * cannot silently diverge; the API is authoritative once a response arrives.
 *
 * Read each entry as "what should happen if the flag system is unavailable",
 * not "off by default".
 */
export const DEFAULT_FLAGS: FlagMap = {
  // Live subsystems: an API blip must not blank out the product.
  ai_generation_enabled: true,
  payments_enabled: true,
  consultant_marketplace_enabled: true,
  // Irreversible external effect — never on unknown state.
  portal_autofill_enabled: false,
  voice_assistant_enabled: false,
  // Beta chrome: absent unless positively enabled.
  beta_banner_enabled: false,
  beta_feedback_widget_enabled: false,
}

export async function fetchFlags(token: string): Promise<FlagMap> {
  const res = await apiFetch<{ flags: FlagMap }>('/feature-flags', token)
  return res?.flags ?? {}
}
