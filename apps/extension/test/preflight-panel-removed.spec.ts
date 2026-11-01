// A module, not a global script: ts-jest type-checks spec files together, and
// top-level consts in script files (require/__dirname shims) collide across them.
export {}
declare function require(id: string): unknown
declare const __dirname: string
const { existsSync, readFileSync, readdirSync } = require('fs') as {
  existsSync: (p: string) => boolean
  readFileSync: (p: string, enc: string) => string
  readdirSync: (p: string) => string[]
}
const { join } = require('path') as { join: (...p: string[]) => string }

/**
 * REVIEW_HANDOFF §27.7 item 54. `preflight-panel.ts` was unreachable dead code
 * that still shipped in both packages:
 *
 *  - nothing in the extension (or the web app — it cannot write extension
 *    storage) ever wrote the `preflightContext` it loads, so it only ever
 *    rendered "No preflight context"; no manifest entry opens its page;
 *  - had it run, its `readback` went out over `chrome.runtime.sendMessage`,
 *    which reaches extension pages and the worker, never a content script — so
 *    every row read "(field not found)" and the human-review checkbox it gated
 *    was answering a uniformly wrong question;
 *  - its `fetch` dialled `ctx.apiUrl` with a bearer token and no
 *    `isTrustedApiUrl` check (SEC-8510).
 *
 * The live review + approval flow is the web app's preflight lock and the side
 * panel. Removed rather than repaired; this pins that it stays removed.
 */
const root = join(__dirname, '..')

describe('54 — the dead preflight panel is gone', () => {
  it('has no source or page', () => {
    expect(existsSync(join(root, 'src', 'preflight-panel.ts'))).toBe(false)
    expect(existsSync(join(root, 'src', 'preflight-panel.html'))).toBe(false)
  })

  it('is not built or copied into a package', () => {
    expect(readFileSync(join(root, 'build.mjs'), 'utf8')).not.toContain('preflight-panel')
  })

  it('no extension source sends `readback` over chrome.runtime (it never reaches a content script)', () => {
    for (const f of readdirSync(join(root, 'src')).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(root, 'src', f), 'utf8')
      expect({ f, hit: /runtime\s*\.sendMessage\(\s*\{\s*type:\s*'readback'/.test(src) }).toEqual({ f, hit: false })
    }
  })

  it('no extension source reads a preflightContext nobody writes', () => {
    for (const f of readdirSync(join(root, 'src')).filter((n) => n.endsWith('.ts'))) {
      expect({ f, hit: readFileSync(join(root, 'src', f), 'utf8').includes('preflightContext') }).toEqual({ f, hit: false })
    }
  })
})
