import * as esbuild from 'esbuild'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'

const watch = process.argv.includes('--watch')
/**
 * Two packages, two contradictory requirements, one codebase.
 *
 *   store    (default)     -> dist/          NO `key`. The Chrome Web Store
 *                                            issues the id and rejects a
 *                                            package that brings its own.
 *   selfhost (--selfhost)  -> dist-selfhost/ KEEPS `key`. An unpacked install
 *                                            with no key gets an id derived
 *                                            from the user's filesystem path,
 *                                            so it differs for every person and
 *                                            can never match the id the web app
 *                                            messages (NEXT_PUBLIC_EXTENSION_ID).
 *                                            That is the zip served from
 *                                            visaai.co/extension.
 *
 * `key` is the base64 DER PUBLIC key. Shipping it discloses nothing — the
 * signing key is not in this repo — it only pins the id. The localhost origin
 * (SEC-8510) is the actual security item, and it is stripped from BOTH.
 */
const selfhost = process.argv.includes('--selfhost')
const outdir = selfhost ? 'dist-selfhost' : 'dist'

await mkdir(outdir, { recursive: true })

const ctx = await esbuild.context({
  entryPoints: {
    background: 'src/background.ts',
    content: 'src/content.ts',
    sidepanel: 'src/sidepanel.ts',
  },
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
})

// Two things the source manifest carries for DEVELOPMENT that must never reach
// a shipped package. Both were found in the zip served from /extension on
// production, which means that zip was not produced by this path.
//
// SEC-8510: `http://localhost:*` in externally_connectable lets any local
// process on that port message the extension. Keep it only for dev (--watch);
// strip it from a production build so the shipped extension trusts VisaAI
// origins alone.
//
// `key` pins the extension ID so an unpacked reload keeps the same identity —
// which is exactly what local development needs and exactly what the Chrome
// Web Store refuses: the Store issues the ID itself, and a package that brings
// its own is rejected at upload.
{
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'))
  if (!watch) {
    if (manifest.externally_connectable?.matches) {
      manifest.externally_connectable.matches =
        manifest.externally_connectable.matches.filter(
          (m) => !/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(m),
        )
    }
    // Only the Web Store package drops the id pin. See the note at the top.
    if (!selfhost) delete manifest.key
  }
  await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2))
}

// Icons are referenced by manifest.icons and action.default_icon. Copying them
// is not cosmetic: Chrome refuses to load an extension whose manifest points at
// a file that is not in the package, and the Web Store listing has no image
// without a 128px icon.
await mkdir(`${outdir}/icons`, { recursive: true })
for (const file of await readdir('icons')) {
  await copyFile(`icons/${file}`, `${outdir}/icons/${file}`)
}
await copyFile('src/sidepanel.html', `${outdir}/sidepanel.html`)

if (watch) {
  await ctx.watch()
  console.log('Watching extension…')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log(`Extension built to ${outdir}/ (${selfhost ? 'self-hosted, id pinned' : 'web store, id issued by Google'})`)
}
