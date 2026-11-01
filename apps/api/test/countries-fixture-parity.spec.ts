import * as fs from 'fs';
import * as path from 'path';
import { CountriesController } from '../src/modules/countries/countries.controller';

/**
 * Keeps the web E2E country fixture honest.
 *
 * The Playwright country-selector suite serves apps/web/e2e/fixtures/
 * supported-countries.json at the network boundary instead of requiring a live
 * API. That is only legitimate while the fixture is byte-identical to what
 * GET /countries actually returns — otherwise the E2E would be proving the UI
 * renders a list the product does not serve.
 *
 * This test is the link in that chain. Add or remove a country strategy and
 * this fails until the fixture is regenerated, so the E2E can never drift into
 * testing a fictional country list.
 *
 * Regenerate with:
 *   pnpm --filter api exec ts-node -e "…" (see VISAAIDocs/audit/COUNTRY_SELECTION_SOURCE_OF_TRUTH_AUDIT.md)
 */
describe('GET /countries ↔ web E2E fixture parity', () => {
  const fixturePath = path.join(
    __dirname,
    '../../web/e2e/fixtures/supported-countries.json',
  );

  it('fixture exists', () => {
    expect(fs.existsSync(fixturePath)).toBe(true);
  });

  it('fixture matches the live controller payload exactly, including order', () => {
    const live = new CountriesController().list();
    const fixture = JSON.parse(
      fs.readFileSync(fixturePath, 'utf8'),
    ) as typeof live;

    // Order matters: the picker's grouping contract is priority (fixed order)
    // → schengen (alpha) → other (alpha), and the web hook deliberately does
    // not re-sort. A reordered fixture would silently weaken the E2E.
    expect(fixture).toEqual(live);
  });

  it('fixture contains no duplicate codes', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
      countries: { code: string }[];
    };
    const codes = fixture.countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('fixture never contains the non-selectable SCHENGEN bloc sentinel', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
      countries: { code: string }[];
    };
    expect(fixture.countries.map((c) => c.code)).not.toContain('SCHENGEN');
  });
});
