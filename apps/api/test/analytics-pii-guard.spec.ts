import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BANNED = [
  'email',
  'password',
  'passport',
  'ssn',
  'dob',
  'date_of_birth',
  'phone',
  'address',
  'first_name',
  'last_name',
  'full_name',
  'card',
  'iban',
  'cvv',
  'amount_raw',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('analytics PII guard (SP-A D7)', () => {
  it('no banned PII key appears in a props object literal', () => {
    const root = join(__dirname, '..', 'src', 'modules');
    const files = [
      'analytics',
      'analytics-metrics',
      'analytics-api',
      'analytics-alerts',
    ].flatMap((d) => {
      try {
        return walk(join(root, d));
      } catch {
        return [];
      }
    });
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const propsBlocks = src.match(/props\s*:\s*\{[^}]*\}/g) ?? [];
      for (const block of propsBlocks) {
        for (const key of BANNED) {
          if (new RegExp(`(^|[{,\\s])${key}\\s*:`).test(block))
            offenders.push(`${f}: props.${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
