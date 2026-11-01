// Reproducible flag-asset sync.
//
// Copies the 4x3 SVG flag set from the `flag-icons` package (a devDependency —
// SOURCE OF SVGs ONLY, never imported at runtime) into `public/flags/4x3/`.
// Files under /public are served verbatim from the base URL and are NOT bundled
// into the JS, so shipping the full ISO set costs nothing in the bundle; the
// lazy <CountryFlag> <img> means a visitor only ever downloads the handful of
// flags actually rendered (then HTTP-cached). Copying the full set also means a
// country newly registered by the backend never renders a missing flag.
//
// Run:  pnpm --filter web flags:sync   (or: node scripts/sync-flags.mjs)
// The committed SVGs are the source of truth at build/deploy time; this script
// just makes regenerating them deterministic when flag-icons is upgraded.

import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(webRoot, 'node_modules', 'flag-icons', 'flags', '4x3')
const DEST = join(webRoot, 'public', 'flags', '4x3')

if (!existsSync(SRC)) {
  console.error(
    `[flags:sync] source not found: ${SRC}\n` +
      'Run `pnpm --filter web add -D flag-icons` first.',
  )
  process.exit(1)
}

// Clean-and-recopy so removed/renamed upstream flags don't linger.
await rm(DEST, { recursive: true, force: true })
await mkdir(DEST, { recursive: true })

const entries = await readdir(SRC)
const svgs = entries.filter((f) => f.endsWith('.svg'))
for (const file of svgs) {
  await cp(join(SRC, file), join(DEST, file))
}

// Lossless minify (svgo, devDependency). Keeps filenames + valid SVG; trims
// metadata/whitespace so the lazily-fetched assets are as small as feasible.
// Detailed-crest flags (es.svg, etc.) stay large by nature — accuracy over bytes.
try {
  execFileSync('npx', ['svgo', '-q', '-f', DEST, '-o', DEST, '--multipass'], {
    cwd: webRoot,
    stdio: 'inherit',
  })
  console.log('[flags:sync] minified with svgo')
} catch {
  console.warn('[flags:sync] svgo minify skipped (devDependency not installed)')
}

const hasEu = svgs.includes('eu.svg')
console.log(
  `[flags:sync] copied ${svgs.length} SVGs → public/flags/4x3/` +
    (hasEu ? ' (eu.svg present → SCHENGEN bloc)' : ' (WARNING: eu.svg missing!)'),
)
if (!hasEu) process.exit(1)
