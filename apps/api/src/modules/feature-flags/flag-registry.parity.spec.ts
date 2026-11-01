import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAG_DEFINITIONS } from './flag-registry';

/**
 * Three-way drift guard for the flag fallback tables.
 *
 * The registry's `defaultValue` is duplicated in two clients:
 *
 *   apps/web/lib/api/feature-flags-client.ts   → DEFAULT_FLAGS
 *   apps/mobile/src/hooks/use-feature-flags.ts → DEFAULT_FLAGS
 *
 * The duplication is deliberate and unavoidable: those values are what each
 * client renders when it cannot reach this API, which is precisely when it
 * cannot fetch them. What is avoidable is drift. A flag added here and
 * forgotten there would render `false` on every degraded load — and for
 * `payments_enabled` that means the UI telling users checkout is off while this
 * API is happily charging them.
 *
 * This test owns the guard rather than each client owning its own, because the
 * registry is the source of truth and `apps/api` is the only package of the
 * three whose tsconfig has Node types (mobile is a React Native target).
 *
 * It parses source instead of importing it: `apps/api` has no build-time
 * dependency on either client, and adding one to share seven booleans would be
 * a worse trade than a regex over a file whose shape this test also pins.
 */
const REPO = join(__dirname, '..', '..', '..', '..', '..');

const CLIENTS = [
  {
    name: 'apps/web',
    path: join(REPO, 'apps', 'web', 'lib', 'api', 'feature-flags-client.ts'),
  },
  {
    name: 'apps/mobile',
    path: join(REPO, 'apps', 'mobile', 'src', 'hooks', 'use-feature-flags.ts'),
  },
];

/** Parse `DEFAULT_FLAGS = { key: true, … }` out of a client module. */
function parseClientDefaults(source: string): Record<string, boolean> {
  const block = /DEFAULT_FLAGS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!block) throw new Error('DEFAULT_FLAGS block not found');
  const out: Record<string, boolean> = {};
  const entry = /^\s*([a-z0-9_.]+):\s*(true|false)\s*,/gm;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(block[1])) !== null) out[m[1]] = m[2] === 'true';
  return out;
}

const registryDefaults = Object.fromEntries(
  FLAG_DEFINITIONS.map((d) => [d.key, d.defaultValue]),
);

describe('flag registry parity with client fallback tables', () => {
  it.each(CLIENTS)(
    '$name parses (the regex must not silently match nothing)',
    ({ path }) => {
      expect(
        Object.keys(parseClientDefaults(readFileSync(path, 'utf8'))).length,
      ).toBe(FLAG_DEFINITIONS.length);
    },
  );

  it.each(CLIENTS)('$name declares exactly the registry keys', ({ path }) => {
    const client = parseClientDefaults(readFileSync(path, 'utf8'));
    expect(Object.keys(client).sort()).toEqual(
      Object.keys(registryDefaults).sort(),
    );
  });

  it.each(CLIENTS)('$name agrees on every default value', ({ path }) => {
    expect(parseClientDefaults(readFileSync(path, 'utf8'))).toEqual(
      registryDefaults,
    );
  });
});

describe('registry invariants', () => {
  it('keeps irreversible-effect features defaulting off', () => {
    // Stated explicitly so a future edit that flips one has to confront the
    // reason rather than just updating a table.
    const byKey = Object.fromEntries(FLAG_DEFINITIONS.map((d) => [d.key, d]));
    expect(byKey.portal_autofill_enabled.defaultValue).toBe(false);
    expect(byKey.voice_assistant_enabled.defaultValue).toBe(false);
  });

  it('keeps live subsystems defaulting on so a flag-store outage is not a blackout', () => {
    const byKey = Object.fromEntries(FLAG_DEFINITIONS.map((d) => [d.key, d]));
    expect(byKey.ai_generation_enabled.defaultValue).toBe(true);
    expect(byKey.payments_enabled.defaultValue).toBe(true);
    expect(byKey.consultant_marketplace_enabled.defaultValue).toBe(true);
  });

  it('has a unique key and a named owner for every flag', () => {
    const keys = FLAG_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of FLAG_DEFINITIONS) expect(d.owner).not.toEqual('');
  });

  it('matches the keys seeded by the migration', () => {
    // A registered flag with no seeded row silently evaluates to its default
    // forever, which looks identical to "the operator has not touched it yet".
    const sql = readFileSync(
      join(
        REPO,
        'supabase',
        'migrations',
        '20260806130000_feature_flags_and_beta_cohorts.sql',
      ),
      'utf8',
    );
    const seeded = [...sql.matchAll(/^\s*\('([a-z0-9_]+)',$/gm)].map(
      (m) => m[1],
    );
    expect(seeded.sort()).toEqual(FLAG_DEFINITIONS.map((d) => d.key).sort());
  });
});
