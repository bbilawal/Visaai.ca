/**
 * Live E2E 2026-10-19 (Pakistani business visitor, self-funded scrap metal
 * trader): /finances left "Is someone else giving you money?" blank, and the
 * /activities current-job row was never written (no IRCC occupation for the
 * title; duties with "," and ":" that IRCC refuses).
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import { buildMappingInputs } from '../src/modules/automation/fill-instructions';
import {
  applyFillTransform,
  plainWords,
} from '../src/modules/automation/fill-transforms';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { irccOccupationFor } from '../src/modules/automation/portal-fills/ircc-occupations';

const inputs = (p: Record<string, unknown>) =>
  buildMappingInputs(resolvePortalFill('ircc')!, p);
const value = (p: Record<string, unknown>, key: string) =>
  inputs(p).find((m) => m.fieldKey === key);

const TRADER = {
  given_name: 'Imran',
  family_name: 'Test',
  date_of_birth: '1990-01-02',
  nationality: 'Pakistan',
  passport_number: 'AB1234567',
  current_country_of_residence: 'Pakistan',
  employed: true,
  occupation: 'scrap metal trader',
  employer_name: 'Acme Metals',
  job_duties:
    'Managing day-to-day operations of Acme Metals, buying and selling scrap metal and recyclable materials, negotiating with suppliers, and supplying industrial clients in Pakistan.',
  employment_start_date: '2025-06',
  employer_address: '12 Mall Road, Model Town, Gujranwala, Punjab, Pakistan',
  trip_expenses_paid_by: 'Self',
  paid_by_canadian_source: false,
};

describe('/finances: someone else giving you money', () => {
  const funds = (p: Record<string, unknown>) =>
    value(p, 'funds_shared')?.targetField;
  it('a self-funded trip answers No', () => {
    expect(funds(TRADER)).toBe('#areFundsShared_radio-button-02-input');
  });
  it.each([
    'Myself',
    'Own funds',
    'Applicant (business income)',
    'self',
    'Self - personal savings',
    'My own money',
  ])('"%s" is No', (who) => {
    expect(funds({ ...TRADER, trip_expenses_paid_by: who })).toBe(
      '#areFundsShared_radio-button-02-input',
    );
  });
  it.each([
    'Employer',
    'My son',
    'Self and my brother',
    'Self, partner',
    'Self / client',
    'Self, inviting organization',
  ])('"%s" is Yes', (who) => {
    expect(funds({ ...TRADER, trip_expenses_paid_by: who })).toBe(
      '#areFundsShared_radio-button-01-input',
    );
  });
  it('a named sponsor is Yes even when the applicant also says self', () => {
    expect(funds({ ...TRADER, sponsor_name: 'Ali Khan' })).toBe(
      '#areFundsShared_radio-button-01-input',
    );
  });
  it('nothing said about who pays leaves it for the applicant', () => {
    const { trip_expenses_paid_by: _t, ...rest } = TRADER;
    expect(funds(rest)).toBeUndefined();
  });
});

describe('/activities: a trader gets an IRCC occupation', () => {
  it.each([
    [
      'scrap metal trader',
      'Sales and service occupations',
      'Technical sales specialists in wholesale trade and retail and wholesale buyers',
    ],
    [
      'Cloth merchant',
      'Sales and service occupations',
      'Technical sales specialists in wholesale trade and retail and wholesale buyers',
    ],
    [
      'Owner of scrap metal trading business',
      'Management occupations',
      'Retail and wholesale trade managers',
    ],
    [
      'Managing partner, wholesale dealer',
      'Management occupations',
      'Retail and wholesale trade managers',
    ],
    [
      'Managing Director',
      'Management occupations',
      'Legislators and senior management, including political officials',
    ],
    [
      'Shop owner',
      'Management occupations',
      'Retail and wholesale trade managers',
    ],
    [
      'Owner and manager of a concrete block manufacturing company',
      'Management occupations',
      'Managers in manufacturing and utilities',
    ],
    [
      'Factory owner',
      'Management occupations',
      'Managers in manufacturing and utilities',
    ],
  ])('%s → %s / %s', (title, activity, jobTitle) => {
    expect(irccOccupationFor(title)).toEqual({ activity, title: jobTitle });
  });
  it('a manager who only works at a factory is not a manufacturing manager (review)', () => {
    for (const t of [
      'Head chef at a plant-based restaurant',
      'Sales manager at a manufacturing company',
      'Head of HR at a factory',
      'Plant nursery owner',
      'Manager at a garment factory',
      'Plant operator',
    ])
      expect(irccOccupationFor(t)?.title).not.toBe('Managers in manufacturing and utilities');
    expect(irccOccupationFor('CEO of a steel mill')?.title).toBe(
      'Legislators and senior management, including political officials',
    );
    expect(irccOccupationFor('Plant manager')?.title).toBe('Managers in manufacturing and utilities');
  });
  it('a generic owner names no sector and is left blank (never senior management)', () => {
    for (const t of [
      'Business owner',
      'Proprietor',
      'Businessman',
      'Entrepreneur',
      'Business partner',
      'Managing partner',
    ])
      expect(irccOccupationFor(t)).toBeUndefined();
    expect(irccOccupationFor('Owner of a wholesale business')?.title).toBe(
      'Retail and wholesale trade managers',
    );
    expect(irccOccupationFor('CEO')?.title).toBe(
      'Legislators and senior management, including political officials',
    );
  });
  it('"trade" by itself is not a trade business', () => {
    expect(irccOccupationFor('Head of trade finance')).toBeUndefined();
    expect(irccOccupationFor('Director of trade policy')).toBeUndefined();
  });
  it('a stock or forex trader is not wholesale trade and is not guessed', () => {
    expect(irccOccupationFor('Stock trader')).toBeUndefined();
    expect(irccOccupationFor('Head of forex trading')).toBeUndefined();
  });
  it('earlier rules still win (bank manager, sales manager)', () => {
    expect(irccOccupationFor('Bank manager')?.title).toBe(
      'Managers in financial and business services',
    );
    expect(irccOccupationFor('Sales manager')?.title).toBe(
      'Sales and account representatives',
    );
  });

  it('the current-job row is written, duties in plain words', () => {
    const out = inputs(TRADER);
    const v = (k: string) => out.find((m) => m.fieldKey === k)?.mappedValue;
    expect(out.some((m) => m.fieldKey === 'ircc_work_current_row')).toBe(true);
    expect(v('ircc_work_current_activity')).toBe(
      'Sales and service occupations',
    );
    expect(v('ircc_work_current_employer')).toBe('Acme Metals');
    const duties = String(v('ircc_work_current_duties'));
    expect(duties).toMatch(/^[A-Za-z0-9 ]+$/);
    expect(duties).toBe(
      // Cut at a whole word to IRCC's 100-character limit (live 2026-10-19).
      'Managing day to day operations of Acme Metals buying and selling scrap metal and recyclable',
    );
    expect(v('ircc_work_current_address_city')).toBe('Gujranwala');
  });
});

describe('plain words (IRCC duties box)', () => {
  it('drops punctuation, keeps words', () => {
    expect(plainWords('Sales: retail, wholesale; R&D/QA (lead).')).toBe(
      'Sales retail wholesale R and D QA lead',
    );
    expect(plainWords('Café owner')).toBe('Cafe owner');
    expect(plainWords('...')).toBeUndefined();
  });
  it('cuts at a whole word', () => {
    expect(plainWords('alpha beta gamma', 12)).toBe('alpha beta');
    expect(plainWords('alpha beta gamma', 100)).toBe('alpha beta gamma');
  });
  it('is the plain_words transform', () => {
    expect(applyFillTransform('plain_words', 'a, b: c')).toBe('a b c');
    expect(applyFillTransform('plain_words', '!!')).toBeNull();
  });
  it('long duties are cut, not dropped', () => {
    const long = Array.from({ length: 60 }, (_, i) => `task${i},`).join(' ');
    const d = String(
      value({ ...TRADER, job_duties: long }, 'ircc_work_current_duties')
        ?.mappedValue,
    );
    expect(d.length).toBeLessThanOrEqual(100);
    expect(d.startsWith('task0 task1 task2')).toBe(true);
  });
});
