/**
 * Drift guard: every country the application layer can offer must exist in the
 * canonical country registry, under the same name.
 *
 * WHY THIS EXISTS
 *
 * VisaAI carries two country lists with entirely separate lineages, and both
 * are legitimate:
 *
 *   - `visa_countries` — the canonical §4.1 registry, 196 rows, populated from
 *     the specification's own UN member-state list. It decides what the public
 *     visa pages can say.
 *   - the strategy registry in `src/strategies/country/` — the countries whose
 *     application pipeline is implemented. It decides what the destination
 *     dropdown can offer, via `GET /countries`.
 *
 * They answer different questions, so they will never be equal, and this test
 * does not ask them to be. What it asks is narrower and non-negotiable: a
 * country the product will happily accept an application for must EXIST in the
 * registry, and must be called the same thing there. Otherwise the user picks
 * "Czech Republic" in the dropdown and lands on pages that say "Czechia" — the
 * same country wearing two names, which reads as two different places.
 *
 * The precedent is `schengen-registry-db-parity.spec.ts`, and its history is
 * the argument for this file: two hardcoded lists held together by a comment
 * saying "MUST stay byte-identical" drifted the same way and stayed silently
 * wrong for about 19 months. A comment is not an enforcement mechanism.
 *
 * §84 item 7 asks that the country registry be normalized across database, API,
 * UI, SEO and tests. The database half was evidenced long before the rest; this
 * is the part that makes the other surfaces answerable.
 *
 * Requires a live Supabase (the local disposable stack is fine). GATED on env
 * so the default `pnpm test` stays green without a database:
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx jest country-registry-strategy-parity
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { REGISTRY_DESTINATIONS, SCHENGEN_MEMBERS } from '../src/strategies';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIGURED = Boolean(URL && SERVICE_KEY);
const describeIf = CONFIGURED ? describe : describe.skip;

/**
 * Countries with a standalone strategy class. Read from the classes' own
 * `code` fields would be better, but instantiating them drags in the whole
 * Nest graph; these four are stable and a wrong entry fails this test loudly.
 */
const STANDALONE: ReadonlyArray<readonly [code: string, name: string]> = [
  ['AU', 'Australia'],
  ['CA', 'Canada'],
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
];

/**
 * Deliberate name differences, each with the reason it is deliberate.
 *
 * This map exists so that a difference has to be ARGUED rather than merely
 * tolerated. An unlisted difference fails; adding one means writing down why,
 * which is the point — the two entries below are both cases where the registry
 * carries the UN's formal name and the dropdown carries what people call it.
 *
 * Keeping them apart is a product decision, not an accident, and it stays a
 * decision only while it is written down somewhere a test reads.
 */
const ACCEPTED_NAME_DIFFERENCES: Record<
  string,
  { registry: string; reason: string }
> = {
  CZ: {
    registry: 'Czechia',
    reason:
      "The registry carries the UN short name from §4.1. The dropdown carries 'Czech Republic', " +
      'which is what the overwhelming majority of applicants search for and recognise.',
  },
  US: {
    registry: 'United States of America',
    reason:
      "The registry carries the UN formal name from §4.1. The dropdown carries 'United States', " +
      'because the formal name in a picker is noise.',
  },
};

describeIf('Country registry ↔ strategy parity', () => {
  jest.setTimeout(45_000);

  let db: SupabaseClient;
  let registry: Map<string, string>;

  const strategyCountries: ReadonlyArray<
    readonly [code: string, name: string]
  > = [
    ...SCHENGEN_MEMBERS,
    ...STANDALONE,
    ...REGISTRY_DESTINATIONS.map(
      (d) => [String(d.code), d.name] as readonly [string, string],
    ),
  ];

  beforeAll(async () => {
    db = createClient(URL!, SERVICE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await db
      .from('visa_countries')
      .select('code, name');
    if (error) throw error;
    registry = new Map(
      (data ?? []).map((r) => [r.code as string, r.name as string]),
    );
  });

  it('has a registry row for every country the product can accept an application for', () => {
    const missing = strategyCountries
      .filter(([code]) => !registry.has(code))
      .map(([code, name]) => `${code} (${name})`);

    // A country offered in the dropdown but absent from the registry is the
    // worst case: the product takes the application and the public pages do not
    // know the place exists.
    expect(missing).toEqual([]);
  });

  it('calls each of them the same thing the registry does', () => {
    const unexplained: string[] = [];

    for (const [code, strategyName] of strategyCountries) {
      const registryName = registry.get(code);
      if (!registryName || registryName === strategyName) continue;

      const accepted = ACCEPTED_NAME_DIFFERENCES[code];
      if (accepted && accepted.registry === registryName) continue;

      unexplained.push(
        `${code}: strategy says "${strategyName}", registry says "${registryName}"`,
      );
    }

    expect(unexplained).toEqual([]);
  });

  it('does not carry stale entries in the accepted-difference map', () => {
    // An allowlist nobody prunes stops describing the system and starts hiding
    // it. If a name is aligned later, its exemption must go with it.
    const stale: string[] = [];

    for (const [code, accepted] of Object.entries(ACCEPTED_NAME_DIFFERENCES)) {
      const strategyEntry = strategyCountries.find(([c]) => c === code);
      if (!strategyEntry) {
        stale.push(`${code}: exempted, but no strategy offers it any more`);
        continue;
      }
      const registryName = registry.get(code);
      if (registryName === strategyEntry[1]) {
        stale.push(
          `${code}: exempted, but the names now agree — remove the exemption`,
        );
      } else if (registryName !== accepted.registry) {
        stale.push(
          `${code}: exemption expects registry "${accepted.registry}", found "${registryName}"`,
        );
      }
    }

    expect(stale).toEqual([]);
  });

  it('every accepted difference states a reason', () => {
    for (const [code, accepted] of Object.entries(ACCEPTED_NAME_DIFFERENCES)) {
      expect(accepted.reason.trim().length).toBeGreaterThan(40);
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  /**
   * The OTHER direction, and the one that was actually broken.
   *
   * The two tests above catch a country offered in the dropdown that the
   * registry has never heard of. Nothing caught the inverse: a country the
   * registry has fully researched, published and shipped requirements for,
   * that the dropdown never offers. That is not cosmetic — createApplication
   * rejects any country without a strategy, so China, Japan, the UAE, Türkiye,
   * Lebanon and eight others were reachable at /visas/<country> and impossible
   * to actually apply for. 1,000+ verified requirements served marketing pages
   * only.
   *
   * The bar is deliberately "has active visa types", not merely
   * support_state='supported': a country marked supported while publishing
   * nothing has no routes for the applicant to pick, and offering it would
   * dead-end them. That exact state has occurred (Finland, preview, 0 types).
   */
  it('offers every registry country that actually has routes to apply for', async () => {
    const { data, error } = await db
      .from('visa_countries')
      .select('code, name, support_state, visa_types(id, lifecycle_state)')
      .eq('support_state', 'supported');
    if (error) throw error;

    const offered = new Set(strategyCountries.map(([code]) => code));
    const unreachable = (data ?? [])
      .filter((row) => {
        const types = (row.visa_types ?? []) as Array<{
          lifecycle_state: string;
        }>;
        return types.some((t) => t.lifecycle_state === 'active');
      })
      .filter((row) => !offered.has(row.code as string))
      .map((row) => `${row.code as string} (${row.name as string})`)
      .sort();

    expect(unreachable).toEqual([]);
  });
});
