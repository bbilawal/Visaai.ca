import '../index'; // registers the built-in country strategies
import { CA_ETA_VISAAI_ID } from '@visaai/types';
import { assessCaBusinessVisitorEligibility as assess } from './ca-business-visitor-eligibility';
import {
  routeEligibility,
  rulesRouteOut,
} from '../../modules/intake/graphs/nodes/required-facts';

const BIZ = 'ca-business-visitors';

describe('Canada business visitor — visa or eTA (owner decision 2026-10-18)', () => {
  it('pay from a Canadian source is a work permit, not this route', () => {
    for (const paid_by_canadian_source of ['Yes', true, 'yes']) {
      for (const nationality of ['PAK', 'GB', 'US']) {
        const r = assess({ nationality, paid_by_canadian_source });
        expect(r.status).toBe('ineligible');
        expect(r.reason).toMatch(/work permit/);
      }
    }
    expect(assess({ nationality: 'PAK', paid_in_canada: 'Yes' }).status).toBe(
      'ineligible',
    );
  });

  it('paid only from outside Canada keeps the usual answer', () => {
    for (const paid_by_canadian_source of ['No', false]) {
      expect(assess({ nationality: 'PAK', paid_by_canadian_source }).status).toBe(
        'eligible',
      );
      expect(assess({ nationality: 'US', paid_by_canadian_source }).status).toBe(
        'not_required',
      );
    }
  });

  it('a visa-required national files this route', () => {
    const r = assess({ nationality: 'PAK' });
    expect(r.status).toBe('eligible');
    expect(r.reason).toMatch(/Pakistan need a visitor visa/);
  });

  it('a visa-exempt national flying in is sent to the eTA', () => {
    for (const nationality of ['GB', 'France', 'JPN']) {
      const r = assess({ nationality });
      expect(r.status).toBe('ineligible');
      expect(r.recommendedVisaaiId).toBe(CA_ETA_VISAAI_ID);
      expect(r.reason).toMatch(/only an eTA/);
    }
  });

  it('a visa-exempt national arriving by land needs nothing', () => {
    expect(assess({ nationality: 'GB', travel_by_air: false }).status).toBe(
      'not_required',
    );
  });

  it('US citizens, US permanent residents and Canadians need nothing', () => {
    for (const p of [
      { nationality: 'US' },
      { nationality: 'PAK', us_permanent_resident: true },
      { nationality: 'CA' },
    ]) {
      const r = assess(p);
      expect(r.status).toBe('not_required');
      expect(r.reason).not.toMatch(/do not need an eTA\b/);
    }
  });

  it('a valid Canadian visa already covers the business trip', () => {
    const r = assess({ nationality: 'PAK', has_valid_canadian_visa: true });
    expect(r.status).toBe('not_required');
    expect(r.reason).toMatch(/covers a business visit/);
  });

  it('a CAN+ national who qualifies for an eTA may still file the visa', () => {
    const r = assess({ nationality: 'Brazil', has_valid_us_visa: true });
    expect(r.status).toBe('eligible');
    expect(r.reason).toMatch(/also apply for a visitor visa/);
  });

  it('a CAN+ national with no visa history yet can file the visa', () => {
    const r = assess({ nationality: 'Philippines' });
    expect(r.status).toBe('eligible');
    expect(r.reason).toMatch(/Philippines need a visitor visa/);
    expect(r.reason).not.toMatch(/do not know/);
  });

  it('an exempt national who has not said how they travel hears both answers', () => {
    expect(assess({ nationality: 'France' }).reason).toMatch(/arriving by car/);
    expect(
      assess({ nationality: 'France', travel_by_air: true }).reason,
    ).not.toMatch(/arriving by car/);
  });

  it('every not_required reason names neither document as needed', () => {
    expect(assess({ nationality: 'US' }).reason).toMatch(
      /neither a visa nor an eTA/,
    );
    expect(
      assess({ nationality: 'PAK', us_permanent_resident: true }).reason,
    ).toMatch(/need neither a visitor visa nor an eTA/);
    expect(assess({ nationality: 'CA' }).reason).toMatch(
      /need neither a visitor visa nor an eTA/,
    );
    expect(assess({ nationality: 'GB', travel_by_air: false }).reason).toMatch(
      /need neither a visitor visa nor an eTA|only a valid passport/,
    );
  });

  it('unknown nationality stays open', () => {
    expect(assess({}).status).toBe('unknown');
  });

  it('the route is gated through the registry, and the TRV is not', () => {
    const gb = routeEligibility('CA', BIZ, { nationality: 'GB' });
    expect(rulesRouteOut(gb)).toBe(true);
    expect(
      rulesRouteOut(routeEligibility('CA', BIZ, { nationality: 'PAK' })),
    ).toBe(false);
    expect(
      routeEligibility('CA', 'ca-visitor-visa-temporary-resident-visa', {
        nationality: 'GB',
      }),
    ).toBeNull();
  });
});
