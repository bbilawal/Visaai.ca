import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Auth-posture enforcement (audit: "authentication is opt-in per-route → a new
 * controller that forgets @UseGuards(JwtGuard) is silently public").
 *
 * Rather than a global guard (which would break the tokenless webhook / health /
 * public routes unless every one is found), this fails CI if ANY controller is
 * neither authenticated nor on the explicitly-reviewed public allowlist.
 * A new public controller must be added here consciously — never by omission.
 *
 * "Authenticated" means JwtGuard (a Supabase user session) OR PartnerAuthGuard
 * (a partner API key / OAuth token). The partner API deliberately does not use
 * JwtGuard: partner traffic carries no user JWT, and PartnerAuthGuard performs
 * the equivalent job — credential verification, tenant resolution and a
 * fail-closed scope check. Any further guard added to this list must enforce
 * authentication itself, not merely wrap one that does.
 */
const SRC = join(__dirname, '..', '..', 'src');

// Controllers intentionally reachable without JwtGuard. Each reviewed as safe.
const PUBLIC_ALLOWLIST = new Set<string>([
  'app.controller.ts', // GET / + GET /health (liveness), no data
  'health.controller.ts', // GET /health/ready (readiness), no data
  'modules/iam/security.controller.ts', // pre-auth account lockout (zod + generic responses)
  'modules/countries/countries.controller.ts', // read-only reference data
  'modules/notifications/notifications-unsubscribe.controller.ts', // HMAC-signed link
  'modules/reminders/reminders.controller.ts', // HMAC-signed link
]);

function findControllers(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findControllers(full, acc);
    else if (
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

describe('auth posture — every controller declares it', () => {
  it('every controller is JwtGuard-protected or on the reviewed public allowlist', () => {
    const offenders: string[] = [];
    for (const file of findControllers(SRC)) {
      const rel = file
        .slice(SRC.length + 1)
        .split('\\')
        .join('/');
      const src = readFileSync(file, 'utf8');
      const guarded = /JwtGuard|PartnerAuthGuard/.test(src);
      if (!guarded && !PUBLIC_ALLOWLIST.has(rel)) offenders.push(rel);
    }
    // A non-empty list means a controller is silently public — guard it, or add
    // it to PUBLIC_ALLOWLIST above with a one-line justification.
    expect(offenders).toEqual([]);
  });

  it('the public allowlist has no stale entries', () => {
    const controllers = new Set(
      findControllers(SRC).map((f) =>
        f
          .slice(SRC.length + 1)
          .split('\\')
          .join('/'),
      ),
    );
    const stale = [...PUBLIC_ALLOWLIST].filter((p) => !controllers.has(p));
    expect(stale).toEqual([]);
  });
});
