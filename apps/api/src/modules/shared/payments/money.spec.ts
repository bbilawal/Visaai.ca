import {
  money,
  toMinor,
  fromMinor,
  minorUnitExponent,
  assertSameCurrency,
} from './money';

describe('money', () => {
  it('two-decimal currency: USD dollars <-> cents', () => {
    expect(toMinor(29, 'usd')).toEqual({ amountMinor: 2900, currency: 'usd' });
    expect(fromMinor({ amountMinor: 2900, currency: 'usd' })).toBe(29);
  });

  it('zero-decimal currency: JPY has no minor unit', () => {
    expect(minorUnitExponent('jpy')).toBe(0);
    expect(toMinor(1500, 'jpy')).toEqual({
      amountMinor: 1500,
      currency: 'jpy',
    });
    expect(fromMinor({ amountMinor: 1500, currency: 'jpy' })).toBe(1500);
  });

  it('rounds to the nearest minor unit (no float drift)', () => {
    expect(toMinor(19.99, 'usd')).toEqual({
      amountMinor: 1999,
      currency: 'usd',
    });
    expect(toMinor(0.1 + 0.2, 'usd')).toEqual({
      amountMinor: 30,
      currency: 'usd',
    });
  });

  it('normalizes currency to lowercase', () => {
    expect(money(100, 'USD')).toEqual({ amountMinor: 100, currency: 'usd' });
  });

  it('rejects non-integer minor amounts', () => {
    expect(() => money(10.5, 'usd')).toThrow(/integer/i);
  });

  it('assertSameCurrency throws on mismatch', () => {
    expect(() =>
      assertSameCurrency(
        { amountMinor: 1, currency: 'usd' },
        { amountMinor: 1, currency: 'cad' },
      ),
    ).toThrow(/currency/i);
  });
});
