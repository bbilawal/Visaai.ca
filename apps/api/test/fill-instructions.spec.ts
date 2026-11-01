/**
 * Decoupled portal fill: the generic mapping-driven builder produces the same
 * Canada IRCC steps as the old hardcoded buildCanadaTrvInstructions, now sourced
 * from the registered IRCC mapping (no Canada code in the fill engine).
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import { buildInstructionsFromMapping } from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  isPortalFillRegistered,
} from '../src/strategies/portal-integration/portal-fill.registry';

const profile = {
  full_name: 'Maria Garcia Lopez',
  date_of_birth: '1990-04-12',
  passport_number: 'X1234567',
  nationality: 'MEX',
  purpose_of_visit: 'Tourism',
  planned_entry_date: '2026-12-01',
  planned_departure_date: '2027-01-31',
};

describe('portal fill registry', () => {
  it('registers the IRCC mapping (no hardcoded portal in the engine)', () => {
    expect(isPortalFillRegistered('ircc')).toBe(true);
    expect(resolvePortalFill('ircc')!.length).toBeGreaterThan(0);
  });
});

describe('buildInstructionsFromMapping (generic)', () => {
  const steps = buildInstructionsFromMapping(
    resolvePortalFill('ircc')!,
    profile,
  );
  const byLabel = (l: string) => steps.find((s) => s.label === l);

  it('splits full_name into given/family', () => {
    expect(byLabel('Given name')?.value).toBe('Maria Garcia');
    expect(byLabel('Family name')?.value).toBe('Lopez');
  });

  it('maps fields to the live IRCC selectors and pages', () => {
    expect(byLabel('Passport number')?.selector).toBe('#travelDocNum_input');
    expect(byLabel('Passport number (confirm)')?.selector).toBe(
      '#travelDocNumConfirmation_input',
    );
    expect(byLabel('Purpose of visit')?.selector).toBe('#visitDetails_txtArea');
    const mapping = resolvePortalFill('ircc')!;
    expect(mapping.every((f) => f.page)).toBe(true);
  });

  it('splits dates into IRCC year / month / day selects', () => {
    expect(byLabel('Date of birth — year')?.value).toBe('1990');
    expect(byLabel('Date of birth — month')?.value).toBe('04');
    expect(byLabel('Date of birth — day')?.value).toBe('12');
    expect(byLabel('Date entering Canada — day')?.value).toBe('1');
    expect(byLabel('Date leaving Canada — month')?.value).toBe('01');
    expect(byLabel('Date of birth — year')?.action).toBe('select');
  });

  it('writes IRCC country codes, and nothing for an unknown country', () => {
    expect(byLabel('Nationality on passport')?.value).toBe('501');
    expect(byLabel('Passport country code')?.value).toBe('501');
    const unknown = buildInstructionsFromMapping(resolvePortalFill('ircc')!, {
      ...profile,
      nationality: 'Atlantis',
    });
    expect(
      unknown.find((s) => s.label === 'Nationality on passport'),
    ).toBeUndefined();
  });

  it('skips empty fields', () => {
    const sparse = buildInstructionsFromMapping(resolvePortalFill('ircc')!, {
      full_name: 'Solo',
    });
    expect(sparse.find((s) => s.label === 'Passport number')).toBeUndefined();
  });
});

describe('IRCC purpose of visit and stay dates (#51, #20)', () => {
  const mapping = () => resolvePortalFill('ircc')!;

  it('writes a full purpose description with dates and derived duration, not the bare phrase', () => {
    const steps = buildInstructionsFromMapping(mapping(), {
      ...profile,
      purpose_of_visit: 'family visit',
      planned_entry_date: '2027-03-01',
      planned_departure_date: '2027-04-30',
      relationship_to_family_in_destination: 'son',
    });
    expect(steps.find((s) => s.label === 'Purpose of visit')?.value).toBe(
      'Family visit from March 1, 2027 to April 30, 2027 (61 days): visiting my son. I will return home on April 30, 2027.',
    );
  });

  it('fills the IRCC date selects from whichever date keys the interview used', () => {
    const {
      planned_entry_date: _e,
      planned_departure_date: _d,
      ...rest
    } = profile;
    const steps = buildInstructionsFromMapping(mapping(), {
      ...rest,
      intended_arrival_date: '2027-03-01',
      intended_departure_date: '2027-04-30',
    });
    expect(
      steps.find((s) => s.label === 'Date entering Canada — month')?.value,
    ).toBe('03');
    expect(
      steps.find((s) => s.label === 'Date leaving Canada — day')?.value,
    ).toBe('30');
  });
});
