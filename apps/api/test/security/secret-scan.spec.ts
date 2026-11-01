import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..'); // apps/api/test/security -> repo root

function tracked(): string[] {
  return execSync('git ls-files', { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

// Real-secret signatures: JWT header + Supabase personal access token.
const SECRET = /eyJhbGciOi[A-Za-z0-9_-]{10}|sbp_[0-9a-f]{20}/;
// Files that legitimately mention these patterns (scanners, docs, tests).
const EXEMPT = (p: string) =>
  p.endsWith('.spec.ts') ||
  p.includes('/test/') ||
  p.startsWith('docs/') ||
  p.endsWith('.md') ||
  p.includes('.github/workflows/');

const JWT = /eyJ[A-Za-z0-9_-]{6,}\.([A-Za-z0-9_-]{6,})\.[A-Za-z0-9_-]{6,}/g;

/**
 * The local Supabase stack signs its anon/service keys with a published demo
 * secret and issues them as `iss: "supabase-demo"`. They are printed by
 * `supabase start` on every machine, so they are not secrets — and the gitleaks
 * ALLOWLIST (`.gitleaks.toml`) exists precisely to quote them, which made the
 * scanner flag the scanner and left this gate permanently red.
 *
 * Allowlisting the TOKENS rather than the file keeps the check sharp: a real
 * JWT pasted into `.gitleaks.toml` — or anywhere else — still fails.
 */
function stripLocalDemoJwts(content: string): string {
  return content.replace(JWT, (match, payload: string) => {
    try {
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { iss?: string };
      return claims.iss === 'supabase-demo' ? '<local-demo-jwt>' : match;
    } catch {
      return match;
    }
  });
}

describe('Security — secret scan (defensive)', () => {
  it('no JWT / Supabase PAT literals in tracked source', () => {
    const offenders: string[] = [];
    for (const f of tracked()) {
      if (EXEMPT(f)) continue;
      let content = '';
      try {
        content = readFileSync(join(REPO, f), 'utf8');
      } catch {
        continue; // binary / unreadable
      }
      if (SECRET.test(stripLocalDemoJwts(content))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('.env is gitignored (never tracked)', () => {
    expect(tracked()).not.toContain('.env');
  });

  it('.env.example contains placeholders only (no real secrets)', () => {
    const files = tracked().filter((f) => f.endsWith('.env.example'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(SECRET.test(readFileSync(join(REPO, f), 'utf8'))).toBe(false);
    }
  });

  it('the SECRET signature actually matches a known secret shape (scanner sanity)', () => {
    expect(SECRET.test('eyJhbGciOiJIUzI1NiThetokenpart')).toBe(true);
    expect(SECRET.test('sbp_0123456789abcdef01234567')).toBe(true);
    expect(SECRET.test('placeholder-anon-key')).toBe(false);
  });

  it('allowlists the local-demo JWTs by token, not by file', () => {
    const jwt = (claims: Record<string, unknown>) =>
      `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
        JSON.stringify(claims),
      ).toString('base64url')}.sIgNaTuReSiGnAtUrE`;

    // iss: supabase-demo → published local key, not a secret.
    expect(SECRET.test(stripLocalDemoJwts(jwt({ iss: 'supabase-demo' })))).toBe(
      false,
    );
    // Any other issuer is still a finding, wherever it appears.
    expect(
      SECRET.test(
        stripLocalDemoJwts(jwt({ iss: 'supabase', ref: 'realproj' })),
      ),
    ).toBe(true);
    // A malformed payload must not be silently treated as safe.
    expect(
      SECRET.test(
        stripLocalDemoJwts(
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.!!!!!!.zzzzzz',
        ),
      ),
    ).toBe(true);
  });
});
