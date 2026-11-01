// A module, not a global script: ts-jest type-checks spec files together, and
// top-level consts in script files (require/__dirname shims) collide across them.
export {}
// Node builtins via require(): see package-shippable.spec.ts for why.
declare function require(id: string): unknown
declare const __dirname: string

const { execFileSync } = require('child_process') as {
  execFileSync: (cmd: string, args: string[], opts: unknown) => { toString: () => string }
}
const { readFileSync } = require('fs') as {
  readFileSync: (p: string) => { toString: (enc: string) => string }
}
const { createHash } = require('crypto') as {
  createHash: (a: string) => { update: (b: unknown) => { digest: (e: string) => string } }
}
const { join } = require('path') as { join: (...parts: string[]) => string }

const root = join(__dirname, '..')
const SERVED = join(root, '..', 'web', 'public', 'extension', 'visaai-portal-assistant.zip')

/** Run pack.mjs's zipDir() in a child (it is ESM; jest here is CJS). */
function packed(dir: string): { sha: string; entries: string[] } {
  const script =
    "import { zipDir, packageEntries } from './pack.mjs';" +
    "import { createHash } from 'node:crypto';" +
    `const b = zipDir(${JSON.stringify(dir)});` +
    "process.stdout.write(JSON.stringify({ sha: createHash('sha256').update(b).digest('hex'), " +
    `entries: packageEntries(${JSON.stringify(dir)}) }));`
  return JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', script], { cwd: root, stdio: 'pipe' }).toString(),
  ) as { sha: string; entries: string[] }
}

/**
 * The release artefacts (pack.mjs). Two properties:
 *   1. Reproducible — the same source gives byte-identical zips, so a published
 *      hash can be re-derived by anyone from a checkout.
 *   2. The zip served from visaai.co/extension IS the current source. Commit
 *      eb0585bd recorded a served zip that lagged its source and would have
 *      turned portal fill off; this pins the served file to a fresh pack.
 */
describe('extension release packaging', () => {
  beforeAll(() => {
    execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'pipe' })
    execFileSync('node', ['build.mjs', '--selfhost'], { cwd: root, stdio: 'pipe' })
  })

  it('is byte-for-byte reproducible', () => {
    expect(packed('dist').sha).toBe(packed('dist').sha)
    expect(packed('dist-selfhost').sha).toBe(packed('dist-selfhost').sha)
  })

  it('ships no source maps and nothing the manifest does not use', () => {
    const { entries } = packed('dist')
    expect(entries.some((e) => e.endsWith('.map'))).toBe(false)
    expect(entries).toEqual([
      'background.js',
      'content.js',
      'icons/icon128.png',
      'icons/icon16.png',
      'icons/icon32.png',
      'icons/icon48.png',
      'manifest.json',
      'sidepanel.html',
      'sidepanel.js',
    ])
  })

  it('the served self-hosted zip is exactly a fresh pack of the current source', () => {
    const served = createHash('sha256').update(readFileSync(SERVED)).digest('hex')
    // On failure: run `pnpm --filter extension pack:publish` and commit the zip.
    expect(served).toBe(packed('dist-selfhost').sha)
  })
})
