import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AUTH-002 regression cover.
 *
 * The signed RBAC claim is `app_metadata.role`. That is what the API writes
 * (`admin.service.ts`: `app_metadata: { role }`) and what `JwtGuard` reads.
 *
 * Three server components in apps/web read `app_metadata.app_role` instead — a
 * key nothing in the system ever writes. Every read silently fell back to
 * `'user'`, which meant:
 *
 *   - the onboarding gate ran admins and consultants through the applicant
 *     welcome flow;
 *   - the profile page displayed "user" as the role of every admin;
 *   - a platform admin could only manage an organisation by also being an
 *     active org_admin member.
 *
 * Nothing failed loudly, because falling back to the least-privileged role
 * looks like correct defensive coding. This test is the loud failure.
 */
const WEB_ROOT = join(__dirname, '..', '..')
const SEARCH_DIRS = ['app', 'components', 'lib']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full)
  }
  return out
}

describe('AUTH-002 — the RBAC claim key', () => {
  it('is never read as `app_role`, which nothing writes', () => {
    const offenders: string[] = []
    for (const dir of SEARCH_DIRS) {
      for (const file of walk(join(WEB_ROOT, dir))) {
        const src = readFileSync(file, 'utf8')
        if (/app_metadata\s*(\?\.|\[|\.)\s*['"]?app_role/.test(src)) {
          offenders.push(file.replace(`${WEB_ROOT}/`, ''))
        }
      }
    }
    expect(offenders, `read app_metadata.role instead:\n${offenders.join('\n')}`).toEqual([])
  })

  it('matches the key the API actually writes', () => {
    const adminService = readFileSync(
      join(WEB_ROOT, '..', 'api', 'src', 'modules', 'admin', 'admin.service.ts'),
      'utf8',
    )
    // If the API ever renames the claim, this fails and points at the rename
    // rather than letting web drift onto a key that silently reads undefined.
    expect(adminService).toContain('app_metadata: { role }')
  })
})
