import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('analytics_reports migration', () => {
  const dir = join(__dirname, '../../../../../..', 'supabase/migrations');
  const file = readdirSync(dir).find((f) =>
    f.endsWith('_analytics_reports.sql'),
  );
  const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
  it('creates the three report tables', () => {
    for (const t of [
      'analytics_saved_report',
      'analytics_scheduled_report',
      'analytics_report_run',
    ]) {
      expect(sql).toMatch(new RegExp(`create table[^;]*${t}`, 'i'));
    }
  });
  it('enables RLS', () => {
    expect(sql.toLowerCase()).toContain('enable row level security');
  });
});
