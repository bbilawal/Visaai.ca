import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Strip line + block comments so a documentation mention of the rejected authority
// (the COR-1 code comment) does not trip the guard — only real code counts.
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('COR-1 take-rate authority guard', () => {
  const code = stripComments(
    readFileSync(
      join(
        __dirname,
        '..',
        'src',
        'modules',
        'analytics-metrics',
        'services',
        'consultant-metrics.service.ts',
      ),
      'utf8',
    ),
  );
  it('take-rate reads commission-derived rollups', () => {
    expect(code).toContain('consultant_gross');
    expect(code).toContain('consultant_payout');
  });
  it('does NOT read pricing_constants.take_rate (code, not comments)', () => {
    expect(code).not.toMatch(/pricing_constants\.take_rate/);
  });
});
