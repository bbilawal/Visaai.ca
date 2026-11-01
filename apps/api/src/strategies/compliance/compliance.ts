import type {
  ComplianceRequirement,
  ComplianceRegime,
  DataResidency,
} from '../types';

/**
 * Region-aware compliance. A jurisdiction maps to the privacy regimes that apply
 * to processing that user's data. Used to drive disclosures, retention, DSAR
 * handling, and data-residency routing per country.
 */
const REGIME_DESCRIPTIONS: Record<string, string> = {
  GDPR: 'EU General Data Protection Regulation',
  UK_GDPR: 'UK GDPR + Data Protection Act 2018',
  PIPEDA: 'Canada PIPEDA (and provincial equivalents)',
  AUS_PRIVACY_PRINCIPLES: 'Australian Privacy Principles (Privacy Act 1988)',
  PDPA_SG: 'Singapore Personal Data Protection Act',
  APPI_JP: 'Japan Act on the Protection of Personal Information',
  UAE_PDPL: 'UAE Personal Data Protection Law',
  SA_PDPL: 'Saudi Arabia Personal Data Protection Law',
  // Registry-sourced destinations (see country/registry-destinations.ts). Each
  // names the destination's own general personal-data statute, because that is
  // the law governing the processing of an applicant's file for it.
  PIPL_CN: 'China Personal Information Protection Law (2021)',
  PDPO_HK: 'Hong Kong Personal Data (Privacy) Ordinance (Cap. 486)',
  PDPA_MY: 'Malaysia Personal Data Protection Act 2010',
  PDPA_TH: 'Thailand Personal Data Protection Act B.E. 2562 (2019)',
  NZ_PRIVACY_ACT: 'New Zealand Privacy Act 2020',
  KVKK_TR: 'Türkiye Law No. 6698 on the Protection of Personal Data (KVKK)',
  PDPL_EG: 'Egypt Personal Data Protection Law No. 151 of 2020',
  PDPL_JO: 'Jordan Personal Data Protection Law No. 24 of 2023',
  PDPL_OM: 'Oman Personal Data Protection Law (Royal Decree 6/2022)',
  PDPPL_QA: 'Qatar Personal Data Privacy Protection Law No. 13 of 2016',
  // Lebanon has no comprehensive data-protection act; Law No. 81/2018 on
  // Electronic Transactions and Personal Data is the binding instrument.
  LB_ETPD:
    'Lebanon Law No. 81/2018 (Electronic Transactions and Personal Data)',
};

export function complianceFor(
  ...regimes: ComplianceRegime[]
): ComplianceRequirement[] {
  return regimes.map((regime) => ({
    regime,
    description: REGIME_DESCRIPTIONS[regime] ?? regime,
  }));
}

/** Jurisdiction → data-residency routing (region + governing jurisdiction). */
export const RESIDENCY_BY_JURISDICTION: Record<string, DataResidency> = {
  CA: { region: 'ca-central-1', jurisdiction: 'CA' },
  EU: { region: 'eu', jurisdiction: 'EU' },
  UK: { region: 'uk', jurisdiction: 'UK' },
  AU: { region: 'au-southeast', jurisdiction: 'AU' },
  US: { region: 'us-east', jurisdiction: 'US' },
  SG: { region: 'ap-southeast-1', jurisdiction: 'SG' },
  JP: { region: 'ap-northeast-1', jurisdiction: 'JP' },
  GLOBAL: { region: 'global', jurisdiction: 'GLOBAL' },
};
