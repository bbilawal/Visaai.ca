import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { strategyRegistry, SCHENGEN_MEMBER_CODES } from '../../strategies';

export type CountryGroup = 'priority' | 'schengen' | 'other';

export interface SupportedCountryDto {
  /** ISO-2 code, or 'SCHENGEN' for the area-wide bloc (bloc is non-selectable). */
  code: string;
  /** Human-readable destination name. */
  name: string;
  /**
   * Display grouping for the picker. Deterministic, derived from the registry:
   * - 'priority' — the four pinned launch corridors, in a FIXED order.
   * - 'schengen' — Schengen member states (alphabetical).
   * - 'other'    — everything else (alphabetical).
   */
  group: CountryGroup;
  /**
   * Whether the browser extension can actually fill this destination's portal.
   *
   * True only where a portal fill mapping exists — today that is Canada alone
   * (`portal-fills/canada-ircc.ts` is the only `registerPortalFill` call), so
   * `buildFillInstructions` returns [] everywhere else. The submission page
   * reads this instead of testing for 'CA', which means adding the next country
   * is a mapping plus `assistedFill: true` on its strategy, and no UI change.
   */
  assistedFill: boolean;
}

/**
 * Pinned launch corridors, in their EXACT required display order (NOT
 * alphabetical). A country here never appears in any other group.
 */
const PRIORITY_ORDER: readonly string[] = ['AU', 'US', 'CA', 'GB'];
const SCHENGEN = new Set(SCHENGEN_MEMBER_CODES);

/**
 * Pure grouping + ordering. Deterministic (no runtime randomness). Single source
 * of truth for the picker's structure so the UI dropdown, search/filter, and any
 * API consumer all see the same grouped order. Each country lands in EXACTLY one
 * group (priority check wins → no duplicates).
 */
export function groupCountries(
  countries: ReadonlyArray<{
    code: string;
    name: string;
    assistedFill?: boolean;
  }>,
): SupportedCountryDto[] {
  const rank = new Map(PRIORITY_ORDER.map((code, i) => [code, i] as const));
  const priority: SupportedCountryDto[] = [];
  const schengen: SupportedCountryDto[] = [];
  const other: SupportedCountryDto[] = [];

  for (const { code, name, assistedFill = false } of countries) {
    const dto = { code, name, assistedFill };
    if (rank.has(code)) priority.push({ ...dto, group: 'priority' });
    else if (SCHENGEN.has(code)) schengen.push({ ...dto, group: 'schengen' });
    else other.push({ ...dto, group: 'other' });
  }

  priority.sort((a, b) => rank.get(a.code)! - rank.get(b.code)!); // fixed order
  const byName = (a: SupportedCountryDto, b: SupportedCountryDto) =>
    a.name.localeCompare(b.name);
  schengen.sort(byName);
  other.sort(byName);

  return [...priority, ...schengen, ...other];
}

/**
 * Public, unauthenticated reference endpoint: the canonical list of destination
 * countries VisaAI actually supports, returned in the picker's display order
 * (priority → Schengen → other) with a per-country `group`.
 *
 * Derived LIVE from the strategy registry — a country appears IFF a selectable
 * CountryStrategy is registered for it, so the dropdown can never offer a
 * destination the backend can't resolve.
 */
@Controller('countries')
export class CountriesController {
  constructor(private readonly config?: ConfigService<Env>) {}

  @Get()
  list(): { countries: SupportedCountryDto[] } {
    const base = strategyRegistry.listCountries().map(({ code, name }) => ({
      code,
      name,
      assistedFill:
        strategyRegistry.getCountry(code)?.portal().assistedFill ?? false,
    }));
    const visible = this.config?.get('SITE_MODE', { infer: true }) === 'canada'
      ? base.filter((country) => country.code === 'CA')
      : base;
    return { countries: groupCountries(visible) };
  }
}
