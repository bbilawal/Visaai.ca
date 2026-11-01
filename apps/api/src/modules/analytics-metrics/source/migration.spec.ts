import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('kpi_rollups migration', () => {
  const dir = join(__dirname, '../../../../../..', 'supabase/migrations');
  const file = readdirSync(dir).find((f) => f.endsWith('_kpi_rollups.sql'));
  const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

  it('creates the four SP-B tables', () => {
    for (const t of [
      'kpi_metric_daily',
      'kpi_funnel_daily',
      'kpi_retention_cohort',
      'analytics_identity_map',
    ]) {
      expect(sql).toMatch(new RegExp(`create table[^;]*${t}`, 'i'));
    }
  });
  it('enables RLS on the rollup tables', () => {
    expect(sql.toLowerCase()).toContain('enable row level security');
  });
});
