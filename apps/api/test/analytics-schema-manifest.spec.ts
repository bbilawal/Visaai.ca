import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('analytics schema-drift guard', () => {
  it('every analytics_*/kpi_* table read/written by code is declared in a migration', () => {
    const modulesRoot = join(__dirname, '..', 'src', 'modules');
    const codeFiles = [
      'analytics',
      'analytics-metrics',
      'analytics-api',
      'analytics-alerts',
    ].flatMap((d) => {
      try {
        return walk(join(modulesRoot, d));
      } catch {
        return [];
      }
    });
    const referenced = new Set<string>();
    for (const f of codeFiles) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(
        /\.from\(\s*['"]((?:analytics|kpi)_[a-z_]+)['"]\s*\)/g,
      ))
        referenced.add(m[1]);
    }

    const migDir = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
    const migSql = readdirSync(migDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(migDir, f), 'utf8'))
      .join('\n');

    const missing = [...referenced].filter(
      (t) => !new RegExp(`create table[^;]*\\b${t}\\b`, 'i').test(migSql),
    );
    expect({ referenced: [...referenced].sort(), missing }).toEqual({
      referenced: [...referenced].sort(),
      missing: [],
    });
  });
});
