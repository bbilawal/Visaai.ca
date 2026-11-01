import { validateQuery, assertFiltersSupported } from './metric.query.schema';
import { InvalidQueryError, UnsupportedFilterError } from './metric.errors';

describe('validateQuery', () => {
  it('accepts a well-formed query', () => {
    const q = validateQuery({
      from: '2026-07-01',
      to: '2026-07-31',
      grain: 'day',
    });
    expect(q.grain).toBe('day');
  });
  it('rejects from > to', () => {
    expect(() =>
      validateQuery({ from: '2026-07-31', to: '2026-07-01', grain: 'day' }),
    ).toThrow(InvalidQueryError);
  });
  it('rejects a bad grain', () => {
    expect(() =>
      validateQuery({
        from: '2026-07-01',
        to: '2026-07-02',
        grain: 'hour' as any,
      }),
    ).toThrow(InvalidQueryError);
  });
});

describe('assertFiltersSupported', () => {
  const q = (filters: any) => ({
    from: '2026-07-01',
    to: '2026-07-31',
    grain: 'day' as const,
    filters,
  });
  it('rejects an unsupported filter', () => {
    expect(() =>
      assertFiltersSupported('mrr', q({ visa_type: 'skilled' }), [
        'plan',
        'country',
      ]),
    ).toThrow(UnsupportedFilterError);
  });
  it('rejects multi-dimension filter (single-dim v1)', () => {
    expect(() =>
      assertFiltersSupported('mrr', q({ plan: 'pro', country: 'CA' }), [
        'plan',
        'country',
      ]),
    ).toThrow(InvalidQueryError);
  });
  it('accepts a single supported filter', () => {
    expect(() =>
      assertFiltersSupported('mrr', q({ plan: 'pro' }), ['plan', 'country']),
    ).not.toThrow();
  });
});
