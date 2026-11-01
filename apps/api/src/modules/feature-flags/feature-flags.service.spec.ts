import { ConfigService } from '@nestjs/config';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import { FeatureFlagsService, type FlagRow } from './feature-flags.service';

type Env = Record<string, unknown>;

function makeConfig(env: Env = {}): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

interface StoreOptions {
  flags?: Partial<FlagRow>[];
  flagError?: string;
  cohorts?: Record<string, string[]>;
}

/**
 * Minimal PostgREST-shaped double. `from('feature_flags').select(...)` is
 * awaited directly; the cohort query chains `.select().eq().is()` and is
 * awaited at the end, so the chain object is thenable.
 */
function makeSupabase(opts: StoreOptions = {}) {
  let flagReads = 0;
  const admin = {
    from(table: string) {
      if (table === 'feature_flags') {
        return {
          select: () => {
            flagReads++;
            return Promise.resolve(
              opts.flagError
                ? { data: null, error: { message: opts.flagError } }
                : { data: (opts.flags ?? []).map(fullRow), error: null },
            );
          },
        };
      }
      if (table === 'beta_cohort_members') {
        let userId = '';
        const chain = {
          select: () => chain,
          eq: (_col: string, v: string) => {
            userId = v;
            return chain;
          },
          is: () => chain,
          then: (resolve: (v: unknown) => void) =>
            resolve({
              data: (opts.cohorts?.[userId] ?? []).map((slug) => ({
                beta_cohorts: { slug },
              })),
              error: null,
            }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return {
    supabase: { admin } as unknown as SupabaseService,
    flagReads: () => flagReads,
  };
}

function fullRow(p: Partial<FlagRow>): FlagRow {
  return {
    key: p.key ?? 'beta_banner_enabled',
    description: p.description ?? '',
    enabled: p.enabled ?? true,
    rollout_percentage: p.rollout_percentage ?? 0,
    allowed_roles: p.allowed_roles ?? [],
    allowed_cohorts: p.allowed_cohorts ?? [],
    allowed_user_ids: p.allowed_user_ids ?? [],
    environments: p.environments ?? [],
  };
}

describe('FeatureFlagsService', () => {
  describe('env overrides (precedence 1–2)', () => {
    it('FORCE_OFF wins even when the stored flag is fully on', async () => {
      const { supabase } = makeSupabase({
        flags: [
          { key: 'payments_enabled', enabled: true, rollout_percentage: 100 },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ FEATURE_FLAGS_FORCE_OFF: 'payments_enabled' }),
      );

      const res = await svc.evaluate('payments_enabled', { userId: 'u1' });
      expect(res).toEqual({
        key: 'payments_enabled',
        value: false,
        reason: 'env_force_off',
      });
    });

    it('FORCE_OFF beats FORCE_ON when a key is in both lists', async () => {
      // Ambiguity during an incident resolves to "off".
      const { supabase } = makeSupabase({ flags: [] });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({
          FEATURE_FLAGS_FORCE_OFF: 'payments_enabled',
          FEATURE_FLAGS_FORCE_ON: 'payments_enabled',
        }),
      );
      expect(await svc.isEnabled('payments_enabled')).toBe(false);
    });

    it('FORCE_ON works without any database read', async () => {
      // The escape hatch has to function when Supabase is the thing that broke.
      const { supabase, flagReads } = makeSupabase({
        flagError: 'connection refused',
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ FEATURE_FLAGS_FORCE_ON: 'portal_autofill_enabled' }),
      );
      expect(await svc.isEnabled('portal_autofill_enabled')).toBe(true);
      expect(flagReads()).toBe(0);
    });

    it('tolerates whitespace and empty entries in the key list', async () => {
      const { supabase } = makeSupabase({ flags: [] });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({
          FEATURE_FLAGS_FORCE_OFF:
            ' payments_enabled , ,ai_generation_enabled ',
        }),
      );
      expect(await svc.isEnabled('payments_enabled')).toBe(false);
      expect(await svc.isEnabled('ai_generation_enabled')).toBe(false);
    });
  });

  describe('registry fallbacks (precedence 3–4)', () => {
    it('returns false for a key that is not in the registry', async () => {
      const { supabase } = makeSupabase({ flags: [] });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      expect(await svc.evaluate('not_a_real_flag')).toEqual({
        key: 'not_a_real_flag',
        value: false,
        reason: 'unregistered',
      });
    });

    it('falls back to the registry default when the store errors', async () => {
      const { supabase } = makeSupabase({ flagError: 'connection refused' });
      const svc = new FeatureFlagsService(supabase, makeConfig());

      // ai_generation_enabled defaults TRUE: a flag-store outage must not take
      // a live subsystem down.
      const ai = await svc.evaluate('ai_generation_enabled', { userId: 'u1' });
      expect(ai).toEqual({
        key: 'ai_generation_enabled',
        value: true,
        reason: 'store_error',
      });

      // portal_autofill_enabled defaults FALSE: the one action with an
      // irreversible external effect must not run on unknown state.
      const portal = await svc.evaluate('portal_autofill_enabled', {
        userId: 'u1',
      });
      expect(portal.value).toBe(false);
      expect(portal.reason).toBe('store_error');
    });

    it('retries after a store error instead of caching the failure', async () => {
      // A poisoned cache would serve defaults for the whole TTL after one blip.
      let fail = true;
      const admin = {
        from: () => ({
          select: () =>
            Promise.resolve(
              fail
                ? { data: null, error: { message: 'blip' } }
                : {
                    data: [
                      fullRow({
                        key: 'beta_banner_enabled',
                        enabled: true,
                        rollout_percentage: 100,
                      }),
                    ],
                    error: null,
                  },
            ),
        }),
      };
      const svc = new FeatureFlagsService(
        { admin } as unknown as SupabaseService,
        makeConfig(),
      );

      expect(await svc.isEnabled('beta_banner_enabled', { userId: 'u1' })).toBe(
        false,
      );
      fail = false;
      expect(await svc.isEnabled('beta_banner_enabled', { userId: 'u1' })).toBe(
        true,
      );
    });

    it('falls back to the registry default when no row exists', async () => {
      const { supabase } = makeSupabase({ flags: [] });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      const res = await svc.evaluate('payments_enabled', { userId: 'u1' });
      expect(res).toEqual({
        key: 'payments_enabled',
        value: true,
        reason: 'no_row',
      });
    });
  });

  describe('environment scoping (precedence 5)', () => {
    it('uses the registry default when the flag does not name this deployment', async () => {
      const { supabase } = makeSupabase({
        flags: [
          {
            key: 'payments_enabled',
            enabled: false, // would be a kill switch if it applied here
            environments: ['staging'],
          },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ NODE_ENV: 'production' }),
      );

      // Not applicable in production → registry default (true), NOT the stored
      // `enabled: false`. A staging-scoped row must not disable production.
      const res = await svc.evaluate('payments_enabled', { userId: 'u1' });
      expect(res).toEqual({
        key: 'payments_enabled',
        value: true,
        reason: 'environment_mismatch',
      });
    });

    it('applies the row when DEPLOY_ENV matches', async () => {
      const { supabase } = makeSupabase({
        flags: [
          {
            key: 'payments_enabled',
            enabled: false,
            environments: ['staging'],
          },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ NODE_ENV: 'production', DEPLOY_ENV: 'staging' }),
      );
      const res = await svc.evaluate('payments_enabled', { userId: 'u1' });
      expect(res.value).toBe(false);
      expect(res.reason).toBe('kill_switch');
    });

    it('treats NODE_ENV=production as DEPLOY_ENV=production when unset', async () => {
      const { supabase } = makeSupabase({
        flags: [
          {
            key: 'beta_banner_enabled',
            enabled: true,
            rollout_percentage: 100,
            environments: ['production'],
          },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ NODE_ENV: 'production' }),
      );
      expect(await svc.isEnabled('beta_banner_enabled', { userId: 'u1' })).toBe(
        true,
      );
    });
  });

  describe('kill switch (precedence 6)', () => {
    it('beats every allow rule', async () => {
      // The whole point of a kill switch: one boolean, no other column can
      // still let traffic through.
      const { supabase } = makeSupabase({
        flags: [
          {
            key: 'payments_enabled',
            enabled: false,
            rollout_percentage: 100,
            allowed_roles: ['admin', 'user'],
            allowed_cohorts: ['internal'],
            allowed_user_ids: ['u1'],
          },
        ],
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());

      const res = await svc.evaluate('payments_enabled', {
        userId: 'u1',
        appRole: 'admin',
        cohorts: ['internal'],
      });
      expect(res).toEqual({
        key: 'payments_enabled',
        value: false,
        reason: 'kill_switch',
      });
    });
  });

  describe('allow rules (precedence 7–9)', () => {
    const base = {
      key: 'beta_banner_enabled',
      enabled: true,
      rollout_percentage: 0,
    };

    it('matches an explicit user id', async () => {
      const { supabase } = makeSupabase({
        flags: [{ ...base, allowed_user_ids: ['u1'] }],
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      expect(
        (await svc.evaluate('beta_banner_enabled', { userId: 'u1' })).reason,
      ).toBe('allow_user');
      expect(await svc.isEnabled('beta_banner_enabled', { userId: 'u2' })).toBe(
        false,
      );
    });

    it('matches a role', async () => {
      const { supabase } = makeSupabase({
        flags: [{ ...base, allowed_roles: ['consultant'] }],
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      expect(
        (
          await svc.evaluate('beta_banner_enabled', {
            userId: 'u1',
            appRole: 'consultant',
          })
        ).reason,
      ).toBe('allow_role');
      expect(
        await svc.isEnabled('beta_banner_enabled', {
          userId: 'u1',
          appRole: 'user',
        }),
      ).toBe(false);
    });

    it('matches a cohort', async () => {
      const { supabase } = makeSupabase({
        flags: [{ ...base, allowed_cohorts: ['internal', 'consultants'] }],
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      expect(
        (
          await svc.evaluate('beta_banner_enabled', {
            userId: 'u1',
            cohorts: ['consultants'],
          })
        ).reason,
      ).toBe('allow_cohort');
      expect(
        await svc.isEnabled('beta_banner_enabled', {
          userId: 'u1',
          cohorts: ['external'],
        }),
      ).toBe(false);
    });

    it('does not match a cohort slug that no cohort row backs', async () => {
      // Targeting fails closed on a typo: the subject's resolved cohorts come
      // from the database, so a misspelt slug in allowed_cohorts matches nobody.
      const { supabase } = makeSupabase({
        flags: [{ ...base, allowed_cohorts: ['intrenal'] }],
        cohorts: { u1: ['internal'] },
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      const subject = await svc.subjectFor({ id: 'u1' });
      expect(await svc.isEnabled('beta_banner_enabled', subject)).toBe(false);
    });
  });

  describe('percentage rollout (precedence 10)', () => {
    it('does not apply to an anonymous subject below 100%', async () => {
      // No stable id means no stable bucket; randomising would flicker the UI.
      const { supabase } = makeSupabase({
        flags: [
          { key: 'beta_banner_enabled', enabled: true, rollout_percentage: 50 },
        ],
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      const res = await svc.evaluate('beta_banner_enabled', {});
      expect(res).toEqual({
        key: 'beta_banner_enabled',
        value: false,
        reason: 'no_subject',
      });
    });

    it('includes an anonymous subject at 100%', async () => {
      const { supabase } = makeSupabase({
        flags: [
          {
            key: 'beta_banner_enabled',
            enabled: true,
            rollout_percentage: 100,
          },
        ],
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      expect((await svc.evaluate('beta_banner_enabled', {})).reason).toBe(
        'rollout_in',
      );
    });

    it('is stable across repeated evaluations for the same user', async () => {
      const { supabase } = makeSupabase({
        flags: [
          { key: 'beta_banner_enabled', enabled: true, rollout_percentage: 50 },
        ],
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      const first = await svc.isEnabled('beta_banner_enabled', {
        userId: 'stable-user',
      });
      for (let i = 0; i < 20; i++) {
        expect(
          await svc.isEnabled('beta_banner_enabled', { userId: 'stable-user' }),
        ).toBe(first);
      }
    });
  });

  describe('caching', () => {
    it('reads the store once for many evaluations inside the TTL', async () => {
      const { supabase, flagReads } = makeSupabase({
        flags: [
          {
            key: 'beta_banner_enabled',
            enabled: true,
            rollout_percentage: 100,
          },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ FEATURE_FLAGS_CACHE_TTL_MS: 60_000 }),
      );
      for (let i = 0; i < 10; i++)
        await svc.isEnabled('beta_banner_enabled', { userId: 'u' });
      expect(flagReads()).toBe(1);
    });

    it('collapses concurrent cold-cache reads into one query', async () => {
      const { supabase, flagReads } = makeSupabase({
        flags: [
          {
            key: 'beta_banner_enabled',
            enabled: true,
            rollout_percentage: 100,
          },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ FEATURE_FLAGS_CACHE_TTL_MS: 60_000 }),
      );
      await Promise.all(
        Array.from({ length: 25 }, () =>
          svc.isEnabled('beta_banner_enabled', { userId: 'u' }),
        ),
      );
      expect(flagReads()).toBe(1);
    });

    it('re-reads after refresh()', async () => {
      const { supabase, flagReads } = makeSupabase({
        flags: [
          {
            key: 'beta_banner_enabled',
            enabled: true,
            rollout_percentage: 100,
          },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ FEATURE_FLAGS_CACHE_TTL_MS: 60_000 }),
      );
      await svc.isEnabled('beta_banner_enabled', { userId: 'u' });
      svc.refresh();
      await svc.isEnabled('beta_banner_enabled', { userId: 'u' });
      expect(flagReads()).toBe(2);
    });

    it('expires the cache after the TTL', async () => {
      const { supabase, flagReads } = makeSupabase({
        flags: [
          {
            key: 'beta_banner_enabled',
            enabled: true,
            rollout_percentage: 100,
          },
        ],
      });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ FEATURE_FLAGS_CACHE_TTL_MS: 0 }),
      );
      await svc.isEnabled('beta_banner_enabled', { userId: 'u' });
      await svc.isEnabled('beta_banner_enabled', { userId: 'u' });
      expect(flagReads()).toBe(2);
    });
  });

  describe('evaluateAllForClient', () => {
    it('returns only client-exposed flags', async () => {
      const { supabase } = makeSupabase({ flags: [] });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      const all = await svc.evaluateAllForClient({ userId: 'u1' });
      // Every registered flag is currently client-exposed; the guarantee under
      // test is that the result is registry-driven and never leaks a row's
      // targeting rules — only booleans.
      expect(Object.values(all).every((v) => typeof v === 'boolean')).toBe(
        true,
      );
      expect(all).toHaveProperty('payments_enabled');
    });

    it('honours env overrides per key', async () => {
      const { supabase } = makeSupabase({ flags: [] });
      const svc = new FeatureFlagsService(
        supabase,
        makeConfig({ FEATURE_FLAGS_FORCE_OFF: 'ai_generation_enabled' }),
      );
      const all = await svc.evaluateAllForClient({ userId: 'u1' });
      expect(all.ai_generation_enabled).toBe(false);
      // Untouched keys still resolve normally (registry default here).
      expect(all.payments_enabled).toBe(true);
    });

    it('serves registry defaults for every flag when the store is down', async () => {
      const { supabase } = makeSupabase({ flagError: 'down' });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      const all = await svc.evaluateAllForClient({ userId: 'u1' });
      expect(all.ai_generation_enabled).toBe(true);
      expect(all.portal_autofill_enabled).toBe(false);
    });
  });

  describe('cohort resolution', () => {
    it('resolves active cohort slugs for a user', async () => {
      const { supabase } = makeSupabase({
        cohorts: { u1: ['internal', 'consultants'] },
      });
      const svc = new FeatureFlagsService(supabase, makeConfig());
      expect(await svc.cohortsFor('u1')).toEqual(['internal', 'consultants']);
      expect(await svc.cohortsFor('u2')).toEqual([]);
    });

    it('handles PostgREST returning the embedded row as an array', async () => {
      const admin = {
        from: () => {
          const chain = {
            select: () => chain,
            eq: () => chain,
            is: () => chain,
            then: (resolve: (v: unknown) => void) =>
              resolve({
                data: [{ beta_cohorts: [{ slug: 'internal' }] }],
                error: null,
              }),
          };
          return chain;
        },
      };
      const svc = new FeatureFlagsService(
        { admin } as unknown as SupabaseService,
        makeConfig(),
      );
      expect(await svc.cohortsFor('u1')).toEqual(['internal']);
    });

    it('returns no cohorts when the membership read fails', async () => {
      const admin = {
        from: () => {
          const chain = {
            select: () => chain,
            eq: () => chain,
            is: () => chain,
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: null, error: { message: 'boom' } }),
          };
          return chain;
        },
      };
      const svc = new FeatureFlagsService(
        { admin } as unknown as SupabaseService,
        makeConfig(),
      );
      // Fails closed: an unreadable membership must not grant cohort access.
      expect(await svc.cohortsFor('u1')).toEqual([]);
    });
  });
});
