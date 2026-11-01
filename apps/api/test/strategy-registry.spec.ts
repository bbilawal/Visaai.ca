/**
 * Country/visa strategy system: the registry resolves built-in countries, and a
 * brand-new country can be added by registering a strategy alone (no core change).
 */
import { strategyRegistry, SCHENGEN_MEMBER_CODES } from '../src/strategies';
import { StrategyRegistry } from '../src/strategies/strategy.registry';
import { BaseCountryStrategy } from '../src/strategies/country/base-country.strategy';
import { visitorVisaProgram } from '../src/strategies/visa-program/visitor-visa.strategy';
import type { VisaProgramStrategy } from '../src/strategies/visa-program/base-visa-program.strategy';

describe('strategy registry (built-ins)', () => {
  it('resolves Canada visitor + super visa programs', () => {
    const trv = strategyRegistry.resolve('CA', 'visitor_visa');
    expect(trv?.program.label).toMatch(/TRV/i);
    expect((trv?.program.forms?.() ?? []).map((f) => f.formCode)).toContain(
      'IMM 5257',
    );

    const superVisa = strategyRegistry.resolve('CA', 'family_sponsorship');
    expect(superVisa?.program.label).toMatch(/super visa/i);
    expect(superVisa?.program.requiredDocuments().map((d) => d.code)).toContain(
      'sponsor_income',
    );
  });

  it('lists the launch countries + 27 Schengen members, but NOT the SCHENGEN bloc', () => {
    const codes = strategyRegistry.listCountries().map((c) => c.code);
    // Launch corridors present.
    expect(codes).toEqual(expect.arrayContaining(['CA', 'US', 'GB', 'AU']));
    // All 27 Schengen members are selectable/listed.
    expect(codes).toEqual(expect.arrayContaining([...SCHENGEN_MEMBER_CODES]));
    // The area-wide bloc is non-selectable → filtered out of the listing.
    expect(codes).not.toContain('SCHENGEN');
  });

  it('keeps the SCHENGEN bloc REGISTERED & resolvable (just not listed)', () => {
    const bloc = strategyRegistry.getCountry('SCHENGEN');
    expect(bloc).toBeDefined();
    expect(bloc!.name).toBe('Schengen Area');
    expect(bloc!.selectable).toBe(false);
    // It still resolves a program (tourist_visa) for legacy 'SCHENGEN' apps.
    expect(strategyRegistry.resolve('SCHENGEN', 'tourist_visa')).toBeDefined();
  });

  it('resolves a Schengen member (DE) with member-coded programs + GDPR/EU residency', () => {
    const de = strategyRegistry.getCountry('DE');
    expect(de).toBeDefined();
    expect(de!.name).toBe('Germany');
    expect(de!.selectable).toBe(true);
    expect(de!.dataResidency.jurisdiction).toBe('EU');
    expect(de!.compliance().map((c) => c.regime)).toContain('GDPR');
    // programs() passes the member ISO-2, not 'SCHENGEN'.
    const tourist = strategyRegistry.resolve('DE', 'tourist_visa');
    expect(tourist?.program.country).toBe('DE');
  });

  it('SCHENGEN_MEMBER_CODES has exactly the canonical 29 codes', () => {
    // 29, not 27: Bulgaria and Romania are full members (air/sea 31 Mar 2024,
    // land 1 Jan 2025). The database helper public.is_schengen_member() must
    // agree code-for-code — enforced by test/schengen-registry-db-parity.spec.ts.
    expect(SCHENGEN_MEMBER_CODES).toHaveLength(29);
    expect([...SCHENGEN_MEMBER_CODES].sort()).toEqual(
      [
        'AT',
        'BE',
        'BG',
        'HR',
        'CZ',
        'DK',
        'EE',
        'FI',
        'FR',
        'DE',
        'GR',
        'HU',
        'IS',
        'IT',
        'LV',
        'LI',
        'LT',
        'LU',
        'MT',
        'NL',
        'NO',
        'PL',
        'PT',
        'RO',
        'SK',
        'SI',
        'ES',
        'SE',
        'CH',
      ].sort(),
    );
    // No duplicates.
    expect(new Set(SCHENGEN_MEMBER_CODES).size).toBe(29);
  });

  it('Canada is region-pinned (PIPEDA / ca-central)', () => {
    const ca = strategyRegistry.getCountry('CA')!;
    expect(ca.dataResidency.region).toBe('ca-central-1');
    expect(ca.compliance().map((c) => c.regime)).toContain('PIPEDA');
  });
});

describe('extensibility: new country with no core change', () => {
  it('adds a country by registering a strategy only', () => {
    class NewZealandStrategy extends BaseCountryStrategy {
      readonly code = 'NZ';
      readonly name = 'New Zealand';
      readonly dataResidency = { region: 'au-southeast', jurisdiction: 'NZ' };
      compliance() {
        return [];
      }
      portal() {
        return {
          portalId: 'nz-immi',
          portalUrl: 'https://www.immigration.govt.nz/',
          assistedFill: false,
        };
      }
      programs(): VisaProgramStrategy[] {
        return [visitorVisaProgram('NZ', { label: 'NZ Visitor Visa' })];
      }
    }

    // Use an isolated registry to avoid cross-test global mutation.
    const r = new StrategyRegistry();
    r.registerCountry(new NewZealandStrategy());

    const resolved = r.resolve('NZ', 'visitor_visa');
    expect(resolved?.country.name).toBe('New Zealand');
    expect(resolved?.program.requiredDocuments().length).toBeGreaterThan(0);
    // No imports of intake/documents/vri/narrative were needed to add NZ.
  });
});
