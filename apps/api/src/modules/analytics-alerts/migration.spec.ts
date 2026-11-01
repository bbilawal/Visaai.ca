import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('analytics_alerts migration', () => {
  const dir = join(__dirname, '../../../../..', 'supabase/migrations');
  const file = readdirSync(dir).find((f) =>
    f.endsWith('_analytics_alerts.sql'),
  );
  const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
  it('creates the rule + event tables', () => {
    for (const t of ['analytics_alert_rule', 'analytics_alert_event']) {
      expect(sql).toMatch(new RegExp(`create table[^;]*${t}`, 'i'));
    }
  });
  it('enables RLS', () => {
    expect(sql.toLowerCase()).toContain('enable row level security');
  });
});
