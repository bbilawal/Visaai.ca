import type { CommissionRule } from '@visaai/types';
import { resolveRule, split, roundCents } from './commission.engine';

let seq = 0;
function rule(p: Partial<CommissionRule> = {}): CommissionRule {
  seq += 1;
  return {
    id: p.id ?? `rule-${seq}`,
    scope: p.scope ?? 'global',
    country_code: p.country_code ?? null,
    visa_type: p.visa_type ?? null,
    consultant_id: p.consultant_id ?? null,
    model: p.model ?? 'percentage',
    platform_pct: p.model === 'fixed' ? null : (p.platform_pct ?? 0.2),
    platform_fixed_usd:
      p.model === 'fixed' ? (p.platform_fixed_usd ?? 50) : null,
    effective_from: p.effective_from ?? '2026-01-01T00:00:00Z',
    active: p.active ?? true,
    note: p.note ?? null,
    created_at: p.created_at ?? '2026-01-01T00:00:00Z',
  };
}

describe('commission.engine — resolveRule', () => {
  const GLOBAL = rule({ id: 'g', scope: 'global', platform_pct: 0.2 });
  const VISA = rule({
    id: 'v',
    scope: 'visa',
    visa_type: 'student',
    platform_pct: 0.18,
  });
  const COUNTRY = rule({
    id: 'c',
    scope: 'country',
    country_code: 'CA',
    platform_pct: 0.15,
  });
  const CV = rule({
    id: 'cv',
    scope: 'country_visa',
    country_code: 'CA',
    visa_type: 'student',
    platform_pct: 0.12,
  });
  const CONS = rule({
    id: 'co',
    scope: 'consultant',
    consultant_id: 'cons-1',
    platform_pct: 0.1,
  });
  const ALL = [GLOBAL, VISA, COUNTRY, CV, CONS];

  it('most-specific wins: consultant > country_visa > country > visa > global', () => {
    expect(
      resolveRule(ALL, {
        country: 'CA',
        visa: 'student',
        consultantId: 'cons-1',
      })?.id,
    ).toBe('co');
    expect(resolveRule(ALL, { country: 'CA', visa: 'student' })?.id).toBe('cv');
    expect(resolveRule(ALL, { country: 'CA', visa: 'work' })?.id).toBe('c');
    expect(resolveRule(ALL, { country: 'US', visa: 'student' })?.id).toBe('v');
    expect(resolveRule(ALL, { country: 'US', visa: 'work' })?.id).toBe('g');
  });

  it('ignores inactive rules', () => {
    const rules = [
      GLOBAL,
      rule({
        id: 'cv-off',
        scope: 'country_visa',
        country_code: 'CA',
        visa_type: 'student',
        active: false,
      }),
    ];
    expect(resolveRule(rules, { country: 'CA', visa: 'student' })?.id).toBe(
      'g',
    );
  });

  it('within a tier, latest effective_from wins', () => {
    const old = rule({
      id: 'old',
      scope: 'global',
      effective_from: '2026-01-01T00:00:00Z',
    });
    const neu = rule({
      id: 'new',
      scope: 'global',
      effective_from: '2026-06-01T00:00:00Z',
    });
    expect(resolveRule([old, neu], {})?.id).toBe('new');
    expect(resolveRule([neu, old], {})?.id).toBe('new');
  });

  it('returns null when nothing matches (no global)', () => {
    expect(resolveRule([VISA], { country: 'CA', visa: 'work' })).toBeNull();
  });

  it('does not pick a consultant rule for a different consultant', () => {
    expect(resolveRule([GLOBAL, CONS], { consultantId: 'other' })?.id).toBe(
      'g',
    );
  });
});

describe('commission.engine — split', () => {
  it('percentage: fee = round(gross*pct), payout = remainder (80/20)', () => {
    const s = split(100, rule({ id: 'r', scope: 'global', platform_pct: 0.2 }));
    expect(s).toEqual({
      gross_usd: 100,
      platform_fee_usd: 20,
      consultant_payout_usd: 80,
      rule_id: 'r',
    });
  });

  it('percentage rounds to cents', () => {
    const s = split(99.99, rule({ scope: 'global', platform_pct: 0.2 }));
    expect(s.platform_fee_usd).toBe(20); // 19.998 -> 20.00
    expect(s.consultant_payout_usd).toBe(79.99);
    expect(roundCents(s.platform_fee_usd + s.consultant_payout_usd)).toBe(
      99.99,
    );
  });

  it('fixed: fee = flat amount', () => {
    const s = split(
      300,
      rule({ scope: 'global', model: 'fixed', platform_fixed_usd: 50 }),
    );
    expect(s.platform_fee_usd).toBe(50);
    expect(s.consultant_payout_usd).toBe(250);
  });

  it('fixed fee never exceeds gross (payout >= 0)', () => {
    const s = split(
      30,
      rule({ scope: 'global', model: 'fixed', platform_fixed_usd: 50 }),
    );
    expect(s.platform_fee_usd).toBe(30);
    expect(s.consultant_payout_usd).toBe(0);
  });

  it('zero gross splits to zero', () => {
    const s = split(0, rule({ scope: 'global', platform_pct: 0.2 }));
    expect(s).toMatchObject({ platform_fee_usd: 0, consultant_payout_usd: 0 });
  });

  it('throws on negative gross', () => {
    expect(() => split(-1, rule())).toThrow();
  });
});
