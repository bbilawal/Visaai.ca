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

/** Portals that currently support VisaAI assisted auto-fill. */
export function assistedFillPortals(): PortalIntegration[] {
  return strategyRegistry
    .listCountries()
    .map((c) => strategyRegistry.getCountry(c.code)!.portal())
    .filter((p) => p.assistedFill);
}
