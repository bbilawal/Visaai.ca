import { buildMetricRegistry } from './metric.registry';

describe('buildMetricRegistry', () => {
  it('keys services by their .key', () => {
    const a = {
      key: 'financial',
      supportedFilters: [],
      compute: jest.fn(),
    } as any;
    const b = {
      key: 'growth',
      supportedFilters: [],
      compute: jest.fn(),
    } as any;
    const reg = buildMetricRegistry([a, b]);
    expect(reg.get('financial')).toBe(a);
    expect(reg.get('growth')).toBe(b);
    expect(reg.size).toBe(2);
  });
});
