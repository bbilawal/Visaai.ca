import { CountriesController, groupCountries } from './countries.controller';
import {
  REGISTRY_DESTINATION_CODES,
  SCHENGEN_MEMBER_CODES,
} from '../../strategies';

/**
 * These tests are the drift guard between the UI dropdown and the backend:
 * GET /countries must expose EXACTLY the countries the strategy registry can
 * resolve AND offer (selectable), grouped + ordered deterministically:
 * priority (fixed order) → Schengen (alpha) → other (alpha).
 */
describe('CountriesController', () => {
  const controller = new CountriesController();

  it('limits the public picker to Canada in Canada site mode', () => {
    const canadaController = new CountriesController({
      get: () => 'canada',
    } as never);
    expect(canadaController.list().countries).toEqual([
      { code: 'CA', name: 'Canada', assistedFill: true, group: 'priority' },
    ]);
  });

  it('returns exactly the registry-backed SELECTABLE countries (4 launch + 29 Schengen members + registry destinations)', () => {
    const codes = controller
      .list()
      .countries.map((c) => c.code)
      .sort();
    const expected = [
      'AU',
      'CA',
      'GB',
      'US',
      ...SCHENGEN_MEMBER_CODES,
      ...REGISTRY_DESTINATION_CODES,
    ].sort();
    expect(codes).toEqual(expected);
  });

  it('offers the registry-sourced destinations, grouped under "other"', () => {
    const list = controller.list().countries;
    const other = list.filter((c) => c.group === 'other').map((c) => c.code);
    expect(other.sort()).toEqual([...REGISTRY_DESTINATION_CODES].sort());
    // The regression this file now guards: these were researched, published at
    // /visas/<country> and unreachable from the only entry point to the product.
    for (const code of ['CN', 'JP', 'AE', 'TR', 'QA', 'OM', 'JO', 'LB', 'EG']) {
      expect(other).toContain(code);
    }
  });

  it('excludes the non-selectable SCHENGEN bloc from the picker', () => {
    const codes = controller.list().countries.map((c) => c.code);
    expect(codes).not.toContain('SCHENGEN');
  });

  it('pins the four priority countries first, in EXACT order (not alphabetical)', () => {
    const codes = controller.list().countries.map((c) => c.code);
    expect(codes.slice(0, 4)).toEqual(['AU', 'US', 'CA', 'GB']);
    // All four are tagged 'priority' and none is tagged schengen/other.
    for (const code of ['AU', 'US', 'CA', 'GB']) {
      expect(
        controller.list().countries.find((c) => c.code === code)?.group,
      ).toBe('priority');
    }
  });

  it('groups all 29 Schengen members under "schengen", sorted alphabetically', () => {
    const schengen = controller
      .list()
      .countries.filter((c) => c.group === 'schengen');
    expect(schengen.map((c) => c.code).sort()).toEqual(
      [...SCHENGEN_MEMBER_CODES].sort(),
    );
    const names = schengen.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // Priority codes never leak into the Schengen group.
    expect(schengen.map((c) => c.code)).not.toContain('AU');
  });

  it('has no duplicate codes across groups', () => {
    const codes = controller.list().countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('orders the payload priority(fixed) → schengen(alpha) → other(alpha)', () => {
    const list = controller.list().countries;
    const groupsInOrder = list.map((c) => c.group);
    // priority block, then schengen block, then other block — never interleaved.
    const firstSchengen = groupsInOrder.indexOf('schengen');
    const firstOther = groupsInOrder.indexOf('other');
    const lastPriority = groupsInOrder.lastIndexOf('priority');
    expect(lastPriority).toBeLessThan(firstSchengen);
    if (firstOther !== -1) expect(firstSchengen).toBeLessThan(firstOther);
  });

  it('exposes only {code,name,group,assistedFill}', () => {
    // A closed shape on purpose: this payload is public and unauthenticated, so
    // a field added here is a field published to everyone.
    for (const c of controller.list().countries) {
      expect(Object.keys(c).sort()).toEqual([
        'assistedFill',
        'code',
        'group',
        'name',
      ]);
    }
  });

  it('marks Canada as the only destination the extension can fill', () => {
    // Not decoration: the submission page offers the extension install on this
    // field alone. Canada is the only country with a registerPortalFill
    // mapping, so anything else being true here would send an applicant
    // through a five-step install to reach an assistant that fills nothing.
    const fillable = controller
      .list()
      .countries.filter((c) => c.assistedFill)
      .map((c) => c.code);
    expect(fillable).toEqual(['CA']);
  });
});

describe('groupCountries (pure sorting/normalization)', () => {
  const input = [
    { code: 'FR', name: 'France' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'AU', name: 'Australia' },
    { code: 'DE', name: 'Germany' },
    { code: 'US', name: 'United States' },
    { code: 'NZ', name: 'New Zealand' }, // not priority, not schengen -> other
    { code: 'CA', name: 'Canada' },
    { code: 'AT', name: 'Austria' },
  ];

  it('pins priority in fixed order, then schengen alpha, then other alpha', () => {
    const out = groupCountries(input);
    expect(out.map((c) => c.code)).toEqual([
      'AU',
      'US',
      'CA',
      'GB', // priority, fixed order
      'AT', // Austria
      'FR', // France  — alpha by NAME, so France before Germany
      'DE', // Germany
      'NZ', // other
    ]);
    expect(out.find((c) => c.code === 'NZ')?.group).toBe('other');
  });

  it('is deterministic (stable across repeated calls)', () => {
    expect(groupCountries(input)).toEqual(groupCountries(input));
  });

  it('never duplicates a country across groups', () => {
    const codes = groupCountries(input).map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
