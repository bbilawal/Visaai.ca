import type { PortalDiscoveryStrategy } from './discovery.types';
import { canadaIrccDiscovery } from './canada-ircc.discovery';
import { euHomeAffairsDiscovery } from './eu-home-affairs.discovery';
import { uscisDiscovery } from './uscis.discovery';
import { auHomeAffairsDiscovery } from './au-home-affairs.discovery';

/**
 * portalId → strategy. The id comes from a country strategy's `portal()`
 * (CanadaStrategy.portal().portalId === 'ircc'), so adding a portal is one
 * file plus one registration — the same shape as strategies/index.ts.
 */
const strategies = new Map<string, PortalDiscoveryStrategy>();

export function registerDiscoveryStrategy(s: PortalDiscoveryStrategy): void {
  strategies.set(s.portalId, s);
}

export function resolveDiscoveryStrategy(
  portalId: string,
): PortalDiscoveryStrategy | undefined {
  return strategies.get(portalId);
}

registerDiscoveryStrategy(canadaIrccDiscovery);
registerDiscoveryStrategy(euHomeAffairsDiscovery);
registerDiscoveryStrategy(uscisDiscovery);
registerDiscoveryStrategy(auHomeAffairsDiscovery);
