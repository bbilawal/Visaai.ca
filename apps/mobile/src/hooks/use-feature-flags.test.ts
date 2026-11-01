import { DEFAULT_FLAGS, flagValue } from './use-feature-flags';

/**
 * Drift between this table and the API's flag registry is guarded in
 * `apps/api/src/modules/feature-flags/flag-registry.parity.spec.ts`, which
 * reads this file directly. It lives there rather than here because the mobile
 * tsconfig targets React Native and has no Node types, so a `node:fs` read
 * fails `tsc --noEmit` even though it runs fine under Jest.
 *
 * What is asserted here is the semantics a reader of this file needs: that the
 * offline defaults are the *safe* ones for a device that launches without a
 * network, which is a normal state on mobile rather than an incident.
 */
describe('mobile DEFAULT_FLAGS', () => {
  it('defaults live subsystems ON so an offline launch is not a blackout', () => {
    expect(DEFAULT_FLAGS.payments_enabled).toBe(true);
    expect(DEFAULT_FLAGS.ai_generation_enabled).toBe(true);
    expect(DEFAULT_FLAGS.consultant_marketplace_enabled).toBe(true);
  });

  it('defaults irreversible-effect features OFF', () => {
    expect(DEFAULT_FLAGS.portal_autofill_enabled).toBe(false);
    expect(DEFAULT_FLAGS.voice_assistant_enabled).toBe(false);
  });

  it('defaults beta chrome OFF so it never appears outside a beta build', () => {
    expect(DEFAULT_FLAGS.beta_banner_enabled).toBe(false);
    expect(DEFAULT_FLAGS.beta_feedback_widget_enabled).toBe(false);
  });
});

describe('flagValue', () => {
  const state = { flags: { beta_banner_enabled: true }, loading: false, degraded: false };

  it('reads a fetched value', () => {
    expect(flagValue(state, 'beta_banner_enabled')).toBe(true);
  });

  it('falls back to the registry default for a key the server omitted', () => {
    expect(flagValue(state, 'payments_enabled')).toBe(true);
  });

  it('returns false for an unknown key rather than throwing', () => {
    expect(flagValue(state, 'not_a_flag')).toBe(false);
  });
});
