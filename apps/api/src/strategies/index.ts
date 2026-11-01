import { strategyRegistry } from './strategy.registry';
import { CanadaStrategy } from './country/canada.strategy';
import { UsaStrategy } from './country/usa.strategy';
import { UkStrategy } from './country/uk.strategy';
import { AustraliaStrategy } from './country/australia.strategy';
import { SchengenStrategy } from './country/schengen.strategy';
import { buildSchengenMemberStrategies } from './country/schengen-members';
import { buildRegistryDestinationStrategies } from './country/registry-destinations';

/**
 * Register built-in country strategies. Adding a country = create its strategy
 * and add ONE line here. No core pipeline code changes.
 *
 * Destinations served by the sourced visa registry (China, Japan, the Middle
 * East, south-east Asia, Ireland, New Zealand) are registered in bulk from
 * REGISTRY_DESTINATIONS — they need no hand-written program strategy because
 * their visa types and requirements come from the registry tables.
 *
 * Roadmap stubs (SA, future): add the strategy file + register.
 */
strategyRegistry.registerCountry(new CanadaStrategy());
strategyRegistry.registerCountry(new UsaStrategy());
strategyRegistry.registerCountry(new UkStrategy());
strategyRegistry.registerCountry(new AustraliaStrategy());
strategyRegistry.registerCountry(new SchengenStrategy()); // KEEP: legacy resolvable
for (const member of buildSchengenMemberStrategies()) {
  strategyRegistry.registerCountry(member); // 27 selectable Schengen members
}
for (const destination of buildRegistryDestinationStrategies()) {
  strategyRegistry.registerCountry(destination); // registry-sourced destinations
}

export { strategyRegistry, StrategyRegistry } from './strategy.registry';
// CountryStrategyRegistry is the canonical name for the country registry.
export {
  StrategyRegistry as CountryStrategyRegistry,
  strategyRegistry as countryStrategyRegistry,
} from './strategy.registry';
export {
  VisaProgramRegistry,
  visaProgramRegistry,
} from './visa-program/visa-program.registry';
export type { ResolvedStrategy } from './strategy.registry';
export type { CountryStrategy } from './country/base-country.strategy';
export type { VisaProgramStrategy } from './visa-program/base-visa-program.strategy';
export {
  SCHENGEN_MEMBERS,
  SCHENGEN_MEMBER_CODES,
  buildSchengenMemberStrategies,
  consultantCoversCountry,
  expandCoveredCodes,
} from './country/schengen-members';
export { SchengenMemberStrategy } from './country/schengen-member.strategy';
export {
  REGISTRY_DESTINATIONS,
  REGISTRY_DESTINATION_CODES,
  RegistryCountryStrategy,
  buildRegistryDestinationStrategies,
} from './country/registry-destinations';
export type { RegistryDestination } from './country/registry-destinations';
export {
  DOCUMENT_TEMPLATE_TABLE,
  PROGRAM_WILDCARD,
  documentTemplatesFor,
} from './document-requirements/document-templates';
export type { DocumentTemplateTable } from './document-requirements/document-templates';
export {
  registerFormRenderer,
  resolveFormRenderer,
  isFormRendererRegistered,
} from './form-mapping/form-renderer.registry';
export {
  portalFor,
  assistedFillPortals,
} from './portal-integration/portal-registry';
export {
  registerPortalFill,
  resolvePortalFill,
  isPortalFillRegistered,
} from './portal-integration/portal-fill.registry';
export type {
  FillFieldMapping,
  PortalFillMapping,
} from './portal-integration/portal-fill.registry';
export * from './types';
