import { SchengenMemberStrategy } from './schengen-member.strategy';

/**
 * Canonical Schengen member set — 29 states.
 *
 * MUST stay in sync with the DB is_schengen_member() helper; the drift guard
 * that enforces this lives in test/schengen-registry-db-parity.spec.ts.
 * Order is irrelevant (UI sorts by name).
 *
 * Source of truth: European Commission / Council of the EU enlargement
 * decisions. Bulgaria and Romania became full members in two stages —
 * air and sea borders on 31 March 2024 (Council Decision (EU) 2024/210),
 * land borders on 1 January 2025 (Council Decision (EU) 2024/3153).
 * Last reviewed: 2026-08-06.
 */
export const SCHENGEN_MEMBERS: ReadonlyArray<
  readonly [code: string, name: string]
> = [
  ['AT', 'Austria'],
  ['BE', 'Belgium'],
  ['BG', 'Bulgaria'],
  ['HR', 'Croatia'],
  ['CZ', 'Czech Republic'],
  ['DK', 'Denmark'],
  ['EE', 'Estonia'],
  ['FI', 'Finland'],
  ['FR', 'France'],
  ['DE', 'Germany'],
  ['GR', 'Greece'],
  ['HU', 'Hungary'],
  ['IS', 'Iceland'],
  ['IT', 'Italy'],
  ['LV', 'Latvia'],
  ['LI', 'Liechtenstein'],
  ['LT', 'Lithuania'],
  ['LU', 'Luxembourg'],
  ['MT', 'Malta'],
  ['NL', 'Netherlands'],
  ['NO', 'Norway'],
  ['PL', 'Poland'],
  ['PT', 'Portugal'],
  ['RO', 'Romania'],
  ['SK', 'Slovakia'],
  ['SI', 'Slovenia'],
  ['ES', 'Spain'],
  ['SE', 'Sweden'],
  ['CH', 'Switzerland'],
] as const;

export const SCHENGEN_MEMBER_CODES: readonly string[] = SCHENGEN_MEMBERS.map(
  ([code]) => code,
);

export function buildSchengenMemberStrategies(): SchengenMemberStrategy[] {
  return SCHENGEN_MEMBERS.map(
    ([code, name]) => new SchengenMemberStrategy(code, name),
  );
}

/**
 * covers(set, dest): mirror of the SQL consultant_covers_country bloc rule.
 * A consultant covers `destination` if they have it exactly, OR they cover the
 * 'SCHENGEN' bloc and `destination` is a Schengen member.
 */
export function consultantCoversCountry(
  coveredCodes: ReadonlySet<string> | readonly string[],
  destination: string | null,
): boolean {
  if (!destination) return false;
  const set =
    coveredCodes instanceof Set ? coveredCodes : new Set(coveredCodes);
  if (set.has(destination)) return true; // exact
  if (set.has('SCHENGEN') && SCHENGEN_MEMBER_CODES.includes(destination))
    return true; // bloc
  return false;
}

/**
 * expandCoveredCodes(codes): for the `.in()` query — adds the 27 member codes
 * if the 'SCHENGEN' bloc is present in the coverage set.
 */
export function expandCoveredCodes(codes: readonly string[]): string[] {
  const out = new Set(codes);
  if (out.has('SCHENGEN')) for (const c of SCHENGEN_MEMBER_CODES) out.add(c);
  return [...out];
}
