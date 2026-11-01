import type {
  CountryCode,
  DataResidency,
  ComplianceRequirement,
  PortalIntegration,
  VisaProgramId,
} from '../types';
import type { VisaProgramStrategy } from '../visa-program/base-visa-program.strategy';

/**
 * A country's immigration profile: its data-residency, compliance regimes,
 * government portal, and the visa programs it offers. The core pipeline talks to
 * this interface only — it never hardcodes a country.
 */
export interface CountryStrategy {
  readonly code: CountryCode;
  readonly name: string;
  /** Omitted/true = appears in the picker (GET /countries). False = registered & resolvable but hidden. */
  readonly selectable?: boolean;
  readonly dataResidency: DataResidency;
  compliance(): ComplianceRequirement[];
  portal(): PortalIntegration;
  /**
   * The portal for one route (`visa_types.visaai_id`). A country whose routes
   * file on different government portals (Canada: tr-rt for visitor visas,
   * the eTA form for an eTA) answers per route; absent = `portal()`.
   */
  portalForRoute?(visaaiId: string | null | undefined): PortalIntegration;
  programs(): VisaProgramStrategy[];
  getProgram(id: VisaProgramId): VisaProgramStrategy | undefined;
}

export abstract class BaseCountryStrategy implements CountryStrategy {
  abstract readonly code: CountryCode;
  abstract readonly name: string;
  /** Default: selectable. Subclasses may override (e.g. the SCHENGEN bloc sets false). */
  readonly selectable: boolean = true;
  abstract readonly dataResidency: DataResidency;
  abstract compliance(): ComplianceRequirement[];
  abstract portal(): PortalIntegration;
  abstract programs(): VisaProgramStrategy[];

  /** Default: every route uses the country's portal. */
  portalForRoute(_visaaiId: string | null | undefined): PortalIntegration {
    return this.portal();
  }

  getProgram(id: VisaProgramId): VisaProgramStrategy | undefined {
    return this.programs().find((p) => p.id === id);
  }
}
