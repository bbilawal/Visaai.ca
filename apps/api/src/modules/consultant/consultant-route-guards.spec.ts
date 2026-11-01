import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every application-scoped route on the consultant controller must carry a
 * method-level guard.
 *
 * The class-level `@UseGuards(JwtGuard)` only proves someone is logged in. Three
 * read routes relied on it alone while their services read through the
 * service-role client — which bypasses RLS — keyed on `:applicationId` from the
 * URL. That let any authenticated user read a stranger's consultant assignment,
 * reassignment history, and per-field decision rollup.
 *
 * A source-level assertion because the failure mode is an ABSENT decorator:
 * there is no runtime behaviour to test on a route nobody remembered to guard.
 */
const SOURCE = readFileSync(
  join(__dirname, 'consultant.controller.ts'),
  'utf8',
);

/** Route decorator -> the handler's preceding decorator block. */
function routes(): Array<{ method: string; path: string; decorators: string }> {
  const out: Array<{ method: string; path: string; decorators: string }> = [];
  const re =
    /@(Get|Post|Patch|Put|Delete)\(([^)]*)\)([\s\S]*?)(?=\n\s{2}@(?:Get|Post|Patch|Put|Delete)\(|\n\}\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SOURCE))) {
    out.push({
      method: m[1],
      path: m[2].replace(/['"]/g, ''),
      decorators: m[3],
    });
  }
  return out;
}

describe('consultant controller route guards', () => {
  const all = routes();

  it('parses the controller (guards the guard)', () => {
    expect(all.length).toBeGreaterThanOrEqual(8);
  });

  it.each(all.map((r) => [`${r.method} ${r.path || '/'}`, r]))(
    '%s carries a method-level guard',
    (_label, route) => {
      const r = route as { decorators: string };
      expect(r.decorators).toMatch(/@UseGuards\(/);
    },
  );

  it('the three formerly-unguarded read routes use ApplicationAccessGuard', () => {
    for (const path of ['assignment', 'assignments', 'approval']) {
      const route = all.find((r) => r.method === 'Get' && r.path === path);
      expect(route).toBeDefined();
      expect(route!.decorators).toContain('ApplicationAccessGuard');
    }
  });
});
