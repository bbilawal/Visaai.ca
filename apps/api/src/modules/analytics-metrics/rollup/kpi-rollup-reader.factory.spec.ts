import { buildRollupReader } from './kpi-rollup-reader.factory';
import { SupabaseKpiRollupReader } from './supabase-kpi-rollup.reader';
import { NoopKpiRollupReader } from './kpi-rollup.sources';

describe('buildRollupReader', () => {
  it('returns Noop when KPI_SOURCE=mock', () => {
    expect(buildRollupReader('mock', {} as any)).toBeInstanceOf(
      NoopKpiRollupReader,
    );
  });
  it('returns Supabase reader otherwise', () => {
    expect(buildRollupReader('supabase', { admin: {} } as any)).toBeInstanceOf(
      SupabaseKpiRollupReader,
    );
  });
});
