import { resolveRange } from './range.resolver';

describe('resolveRange', () => {
  const now = new Date('2026-07-09T12:00:00Z'); // Thursday
  it('passes absolute ranges through', () => {
    expect(
      resolveRange({ from: '2026-01-01', to: '2026-02-01' } as any, now),
    ).toEqual({ from: '2026-01-01', to: '2026-02-01' });
  });
  it('last_7d = now-6 .. now (inclusive 7 days)', () => {
    expect(resolveRange({ rangePreset: 'last_7d' } as any, now)).toEqual({
      from: '2026-07-03',
      to: '2026-07-09',
    });
  });
  it('mtd = first of month .. now', () => {
    expect(resolveRange({ rangePreset: 'mtd' } as any, now)).toEqual({
      from: '2026-07-01',
      to: '2026-07-09',
    });
  });
});
