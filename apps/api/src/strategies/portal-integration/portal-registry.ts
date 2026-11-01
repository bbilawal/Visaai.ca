import type { CountryCode, PortalIntegration } from '../types';
import { strategyRegistry } from '../strategy.registry';

/**
 * Portal integration lookup. Government portal details live on each country
 * strategy; this is the thin accessor the submission/automation layer uses so it
 * never hardcodes a portal (e.g. IRCC).
 */
export function portalFor(country: CountryCode): PortalIntegration | undefined {
  return strategyRegistry.getCountry(country)?.portal();
}

/**
 * The portal one application fills: its destination country's, narrowed by
 * its route (`visa_types.visaai_id`) where the country files routes on
 * different portals (Canada eTA → 'ircc-eta'). Undefined for an unknown
 * country.
 */
export function portalForRoute(
  country: CountryCode | null | undefined,
  visaaiId: string | null | undefined,
): PortalIntegration | undefined {
  if (!country) return undefined;
  const s = strategyRegistry.getCountry(country);
  if (!s) return undefined;
  return s.portalForRoute ? s.portalForRoute(visaaiId) : s.portal();
}

/** The `visaai_id` of an application row's embedded `visa_types(visaai_id)`. */
export function embeddedVisaaiId(app: unknown): string | null {
  const vt = (app as { visa_types?: unknown } | null)?.visa_types;
  const one: unknown = Array.isArray(vt) ? (vt as unknown[])[0] : vt;
  const id = (one as { visaai_id?: unknown } | null | undefined)?.visaai_id;
  return typeof id === 'string' && id ? id : null;
}

/** Portals that currently support VisaAI assisted auto-fill. */
export function assistedFillPortals(): PortalIntegration[] {
  return strategyRegistry
    .listCountries()
    .map((c) => strategyRegistry.getCountry(c.code)!.portal())
    .filter((p) => p.assistedFill);
}
