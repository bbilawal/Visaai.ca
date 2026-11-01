import { BaseCountryStrategy } from './base-country.strategy';
import type {
  ComplianceRegime,
  ComplianceRequirement,
  CountryCode,
  DataResidency,
  PortalIntegration,
} from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';
import { complianceFor } from '../compliance/compliance';

/**
 * Destinations whose visa data comes from the sourced visa registry
 * (`visa_countries` / `visa_types` / `visa_requirements`) rather than from a
 * hand-written program strategy.
 *
 * WHY THIS FILE EXISTS. The product had two disagreeing country lists. The
 * registry publishes hubs and requirements for 27 destinations; the picker
 * (`GET /countries`) is derived from the strategy registry, which only ever had
 * the four launch corridors plus the Schengen members. Everything the registry
 * added after that — China, Japan, the Middle East, south-east Asia, Ireland,
 * New Zealand — was researched, verified, published at `/visas/<country>` and
 * then unreachable from the ONLY entry point to the product, because
 * `IntakeService.createApplication` rejects any country without a strategy.
 *
 * The whole downstream intake path is already registry-driven:
 * `listVisaTypesForApplication` reads `visa_types` by destination code and the
 * checklist reads `visa_requirements`. A country needs a strategy only to be
 * offered and accepted. So these strategies declare exactly what is true —
 * jurisdiction, privacy regime, the authority's own portal — and NOTHING that
 * would have to be invented.
 *
 * `programs()` is deliberately EMPTY. A program carries FormSpecs (official
 * form codes and their landing URLs) and we have not sourced those for these
 * countries. Returning a fabricated `tourist_visa` would put invented form
 * codes into `formsForCountry()` and the doc-template sweep; returning none
 * means those surfaces correctly offer nothing while the registry's real,
 * verified visa types drive the intake flow. Add a program here only when its
 * forms have actually been sourced.
 *
 * `portalUrl` and `name` are copied from the production `visa_countries` row
 * for that code. `test/registry-destinations-db-parity.spec.ts` fails if this
 * table and the registry drift apart, in either direction.
 */
export interface RegistryDestination {
  /** ISO-3166-1 alpha-2, matching `visa_countries.code`. */
  code: CountryCode;
  /** Display name, matching `visa_countries.name`. */
  name: string;
  /** Privacy regime(s) governing this destination's applicant data. */
  regimes: readonly ComplianceRegime[];
  /** Stable slug for the authority portal (free-form; used for telemetry). */
  portalId: string;
  /** The authority's own application/visa-information entry point. */
  portalUrl: string;
}

/**
 * Registry-sourced destinations, alphabetical by code.
 *
 * Regimes are the destination's own general personal-data statute, named
 * because it is the law that governs processing an applicant's file for that
 * destination. Where a country has no comprehensive data-protection act, the
 * closest binding instrument is named rather than a placeholder.
 */
export const REGISTRY_DESTINATIONS: readonly RegistryDestination[] = [
  {
    code: 'AE',
    name: 'United Arab Emirates',
    regimes: ['UAE_PDPL'],
    portalId: 'ae-icp',
    portalUrl: 'https://icp.gov.ae/en/services-details',
  },
  {
    code: 'CN',
    name: 'China',
    regimes: ['PIPL_CN'],
    portalId: 'cn-nia',
    portalUrl: 'https://en.nia.gov.cn/n147423/n147478/n147715/index.html',
  },
  {
    code: 'EG',
    name: 'Egypt',
    regimes: ['PDPL_EG'],
    portalId: 'eg-evisa',
    portalUrl: 'https://visa2egypt.gov.eg/eVisa/Home',
  },
  {
    code: 'HK',
    name: 'Hong Kong SAR',
    regimes: ['PDPO_HK'],
    portalId: 'hk-immd',
    portalUrl: 'https://www.immd.gov.hk/eng/online-services/index.html',
  },
  {
    code: 'IE',
    name: 'Ireland',
    regimes: ['GDPR'],
    portalId: 'ie-isd',
    portalUrl: 'https://www.irishimmigration.ie/coming-to-visit-ireland/',
  },
  {
    code: 'JO',
    name: 'Jordan',
    regimes: ['PDPL_JO'],
    portalId: 'jo-moi',
    portalUrl: 'https://jordan.gov.jo/',
  },
  {
    code: 'JP',
    name: 'Japan',
    regimes: ['APPI_JP'],
    portalId: 'jp-isa',
    portalUrl: 'https://www.moj.go.jp/isa/applications/status/index.html',
  },
  {
    code: 'LB',
    name: 'Lebanon',
    regimes: ['LB_ETPD'],
    portalId: 'lb-gsg',
    portalUrl: 'https://www.general-security.gov.lb/en/posts/37',
  },
  {
    code: 'MY',
    name: 'Malaysia',
    regimes: ['PDPA_MY'],
    portalId: 'my-imi',
    portalUrl: 'https://malaysiavisa.imi.gov.my/evisa/evisa.jsp',
  },
  {
    code: 'NZ',
    name: 'New Zealand',
    regimes: ['NZ_PRIVACY_ACT'],
    portalId: 'nz-inz',
    portalUrl: 'https://www.immigration.govt.nz/new-zealand-visas',
  },
  {
    code: 'OM',
    name: 'Oman',
    regimes: ['PDPL_OM'],
    portalId: 'om-mol',
    portalUrl: 'https://www.mol.gov.om/ManpowerAllEServices',
  },
  {
    code: 'QA',
    name: 'Qatar',
    regimes: ['PDPPL_QA'],
    portalId: 'qa-mofa',
    portalUrl: 'https://mofa.gov.qa/en/consular-services/visas',
  },
  {
    code: 'SG',
    name: 'Singapore',
    regimes: ['PDPA_SG'],
    portalId: 'sg-ica',
    portalUrl: 'https://eservices.ica.gov.sg/sgarrivalcard/',
  },
  {
    code: 'TH',
    name: 'Thailand',
    regimes: ['PDPA_TH'],
    portalId: 'th-mfa',
    portalUrl:
      'https://consular.mfa.go.th/th/page/%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%A0%E0%B8%97%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B8%AB%E0%B8%A5%E0%B8%B1%E0%B8%81%E0%B9%80%E0%B8%81%E0%B8%93%E0%B8%91%E0%B9%8C%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%82%E0%B8%AD-visa?menu=5ddcb8b29b1e8a30447d6f22',
  },
  {
    code: 'TR',
    name: 'Türkiye',
    regimes: ['KVKK_TR'],
    portalId: 'tr-evisa',
    portalUrl: 'https://www.evisa.gov.tr/en/',
  },
] as const;

export const REGISTRY_DESTINATION_CODES: readonly string[] =
  REGISTRY_DESTINATIONS.map((d) => d.code);

/**
 * A destination served by the sourced registry. Selectable, resolvable, and
 * carrying no invented programs — see the file header.
 */
export class RegistryCountryStrategy extends BaseCountryStrategy {
  readonly selectable = true;
  readonly code: CountryCode;
  readonly name: string;
  /**
   * Jurisdiction is the destination itself. `region` stays 'global' because
   * VisaAI runs a single processing region today; naming a per-country region
   * here would assert infrastructure that does not exist.
   */
  readonly dataResidency: DataResidency;

  private readonly regimes: readonly ComplianceRegime[];
  private readonly portalId: string;
  private readonly portalUrl: string;

  constructor(destination: RegistryDestination) {
    super();
    this.code = destination.code;
    this.name = destination.name;
    this.regimes = destination.regimes;
    this.portalId = destination.portalId;
    this.portalUrl = destination.portalUrl;
    this.dataResidency = {
      region: 'global',
      jurisdiction: String(destination.code),
    };
  }

  compliance(): ComplianceRequirement[] {
    return complianceFor(...this.regimes);
  }

  portal(): PortalIntegration {
    return {
      portalId: this.portalId,
      portalUrl: this.portalUrl,
      assistedFill: false,
    };
  }

  /** Intentionally empty — see the file header. */
  programs(): VisaProgramStrategy[] {
    return [];
  }
}

export function buildRegistryDestinationStrategies(): RegistryCountryStrategy[] {
  return REGISTRY_DESTINATIONS.map((d) => new RegistryCountryStrategy(d));
}
