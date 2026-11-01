import { describe, it, expect } from 'vitest';
import { centsToUsd, usdToCents } from './money';

describe('centsToUsd', () => {
  it('formats cents as USD', () => {
    expect(centsToUsd(34900)).toBe('$349.00');
    expect(centsToUsd(0)).toBe('$0.00');
    expect(centsToUsd(1500)).toBe('$15.00');
  });
});

describe('usdToCents', () => {
  it('parses dollars to cents; blank/invalid → null', () => {
    expect(usdToCents('349')).toBe(34900);
    expect(usdToCents('19.99')).toBe(1999);
    expect(usdToCents('')).toBeNull();
    expect(usdToCents('abc')).toBeNull();
    expect(usdToCents('-5')).toBeNull();
  });
});
