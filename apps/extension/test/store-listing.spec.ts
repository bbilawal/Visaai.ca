// A module, not a global script: ts-jest type-checks spec files together, and
// top-level consts in script files (require/__dirname shims) collide across them.
export {}
// Node builtins via require(): see package-shippable.spec.ts for why.
declare function require(id: string): unknown
declare const __dirname: string

const { execFileSync } = require('child_process') as {
  execFileSync: (cmd: string, args: string[], opts: unknown) => { toString: () => string }
}
const { existsSync, readdirSync, readFileSync } = require('fs') as {
  existsSync: (p: string) => boolean
  readdirSync: (p: string) => string[]
  readFileSync: (p: string, enc?: string) => { toString: (enc?: string) => string } & ArrayLike<number>
}
const { createHash } = require('crypto') as {
  createHash: (a: string) => { update: (b: unknown) => { digest: (e: string) => string } }
}
const { join } = require('path') as { join: (...parts: string[]) => string }

const root = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').toString()
const manifest = JSON.parse(read('manifest.json')) as { version: string; description: string }
const submission = read('store', 'SUBMISSION.md')

/** The text under a `**Heading**` line in SUBMISSION.md, up to the next blank line. */
function field(heading: string): string {
  const lines = submission.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${heading}**`))
  if (i < 0) throw new Error(`SUBMISSION.md has no **${heading}**`)
  const out: string[] = []
  for (const l of lines.slice(i + 1)) {
    if (!l.trim()) break
    out.push(l.trim())
  }
  return out.join(' ')
}

/** Width, height and colour type from a PNG's IHDR chunk. */
function png(path: string): { width: number; height: number; colorType: number } {
  const b = readFileSync(path) as unknown as number[]
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
  expect(Array.from(b).slice(1, 4)).toEqual([0x50, 0x4e, 0x47]) // "PNG"
  return { width: u32(16), height: u32(20), colorType: b[25] }
}

/**
 * The listing is checked against the package and the source, because the
 * Web Store shows the manifest `description` as the item summary and a
 * reviewer compares it with what the code does. 0.1.3 went up saying it
 * "assists with filling government visa portal forms" — unqualified, and
 * contradicting SUBMISSION.md's own guidance (REVIEW_HANDOFF §34.12 item 4).
 */
describe('Chrome Web Store listing', () => {
  it('summary fits the Store limit and is the one SUBMISSION.md documents', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(132)
    expect(field('Summary (132 char max)')).toBe(manifest.description)
  })

  it('summary qualifies the fill and leaves submission and payment to the user', () => {
    const d = manifest.description
    // Only the IRCC mapping exists (portal-fills/canada-ircc.ts), and the server
    // writes nothing unless every mapped field is on the page (automation.gateway.ts).
    expect(d).toMatch(/IRCC/)
    expect(d).toMatch(/only if every field is found/)
    expect(d).toMatch(/approved/)
    expect(d).toMatch(/You submit and pay/)
    expect(d).not.toMatch(/Assists with filling government visa portal forms/)
  })

  it('single purpose does not open with an unqualified "Fill"', () => {
    const lines = submission.split('\n')
    const start = lines.findIndex((l) => l.startsWith('## Single purpose'))
    const quote = lines.slice(start + 1).find((l) => l.startsWith('>'))
    expect(quote).toBeDefined()
    expect(quote).not.toMatch(/^>\s*Fill\b/)
  })

  it('the shipped side panel names no development server', () => {
    expect(read('src', 'sidepanel.html')).not.toMatch(/localhost|127\.0\.0\.1/)
  })

  it('ships store screenshots at a size the Store accepts, without alpha', () => {
    const dir = join(root, 'store', 'screenshots')
    const files = readdirSync(dir).filter((f) => f.endsWith('.png'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files.length).toBeLessThanOrEqual(5)
    for (const f of files) {
      const { width, height, colorType } = png(join(dir, f))
      expect([`${width}x${height}`, f]).toEqual([
        expect.stringMatching(/^(1280x800|640x400)$/),
        f,
      ])
      expect(colorType).toBe(2) // RGB, no alpha channel
    }
  })

  it('store icon is the package icon, 128x128', () => {
    expect(png(join(root, 'icons', 'icon128.png'))).toMatchObject({ width: 128, height: 128 })
  })

  // release/ is gitignored (pack.mjs regenerates it), so this only runs where a
  // pack has been made — which is exactly where a zip is about to be uploaded.
  const sums = join(root, 'release', 'SHA256SUMS')
  ;(existsSync(sums) ? it : it.skip)('release/SHA256SUMS is for this version and these bytes', () => {
    execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'pipe' })
    const lines = read('release', 'SHA256SUMS').trim().split('\n')
    const store = `visaai-portal-assistant-${manifest.version}-store.zip`
    const selfhost = `visaai-portal-assistant-${manifest.version}-selfhost.zip`
    expect(lines.map((l) => l.split(/\s+/)[1]).sort()).toEqual([selfhost, store])
    for (const l of lines) {
      const [hash, name] = l.split(/\s+/)
      expect(createHash('sha256').update(readFileSync(join(root, 'release', name))).digest('hex')).toBe(hash)
    }
    // And the store zip is a fresh pack of the current source.
    const fresh = execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        "import { zipDir } from './pack.mjs'; import { createHash } from 'node:crypto';" +
          "process.stdout.write(createHash('sha256').update(zipDir('dist')).digest('hex'))",
      ],
      { cwd: root, stdio: 'pipe' },
    ).toString()
    expect(lines.find((l) => l.endsWith(store))!.split(/\s+/)[0]).toBe(fresh)
  })
})
