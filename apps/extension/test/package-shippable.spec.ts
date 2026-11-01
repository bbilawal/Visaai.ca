// Node builtins via require(): @types/node is not a dependency of this package,
// and adding one to assert a property of a zip would be the tail wagging the
// dog. `require` is declared rather than imported for the same reason.
declare function require(id: string): unknown
declare const __dirname: string
// Same reason as `require` above: @types/node is not a dependency here.
declare const Buffer: { from: (s: string, enc: string) => unknown }

const { execFileSync } = require('child_process') as {
  execFileSync: (cmd: string, args: string[], opts: unknown) => void
}
const { existsSync, readFileSync } = require('fs') as {
  existsSync: (p: string) => boolean
  readFileSync: (p: string, enc: string) => string
}
const { join } = require('path') as {
  join: (...parts: string[]) => string
}

/**
 * What is in the zip people actually download.
 *
 * The package served from https://visaai.co/extension carried two things the
 * source manifest holds for DEVELOPMENT only, because it had been produced by
 * hand rather than by `build.mjs`:
 *
 *   - `http://localhost:3000/*` in externally_connectable (SEC-8510) — any
 *     local process on that port could message the extension.
 *   - `key`, which pins the extension ID for unpacked reloads. The Chrome Web
 *     Store issues the ID itself and refuses a package that brings its own, so
 *     this made the zip unpublishable as well as unsafe.
 *
 * build.mjs strips both. That was already true of localhost when the bad zip
 * shipped, which is the point: a build step only protects the artefact it
 * actually produced. This asserts the property of the OUTPUT.
 */
const root = join(__dirname, '..')
const dist = join(root, 'dist')
const selfhostDist = join(root, 'dist-selfhost')

describe('production extension package', () => {
  beforeAll(() => {
    // Build the real thing rather than trusting whatever is lying in dist/.
    execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'pipe' })
    execFileSync('node', ['build.mjs', '--selfhost'], { cwd: root, stdio: 'pipe' })
  })

  function manifest(): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(dist, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>
  }

  it('carries no `key` — the Web Store issues the id', () => {
    expect(manifest()).not.toHaveProperty('key')
  })

  it('keeps `key` in the SOURCE manifest, for stable unpacked reloads', () => {
    // Stripping it at the source would break local development, which is the
    // reason the field exists. The split is deliberate; this pins both halves.
    const src = JSON.parse(
      readFileSync(join(root, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(src).toHaveProperty('key')
  })

  it('trusts only VisaAI origins', () => {
    const matches =
      (manifest().externally_connectable as { matches?: string[] } | undefined)
        ?.matches ?? []
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      expect(m).not.toMatch(/localhost|127\.0\.0\.1/)
      expect(m).toMatch(/^https:\/\//)
    }
  })

  it('ships every file the manifest points at', () => {
    // Chrome refuses to load an extension whose manifest names a missing file,
    // and the Web Store listing has no image without the 128px icon.
    const m = manifest()
    const icons = m.icons as Record<string, string>
    for (const path of Object.values(icons)) {
      expect(existsSync(join(dist, path))).toBe(true)
    }
    expect(existsSync(join(dist, '128' in icons ? icons['128'] : ''))).toBe(true)
    const worker = (m.background as { service_worker: string }).service_worker
    expect(existsSync(join(dist, worker))).toBe(true)
    const panel = (m.side_panel as { default_path: string }).default_path
    expect(existsSync(join(dist, panel))).toBe(true)
    for (const cs of m.content_scripts as Array<{ js: string[] }>) {
      for (const js of cs.js) expect(existsSync(join(dist, js))).toBe(true)
    }
  })

  it('requests host access only to portals it fills', () => {
    // A broad host permission is the single most common Web Store rejection,
    // and the most expensive thing to widen by accident.
    for (const host of manifest().host_permissions as string[]) {
      expect(host).not.toBe('<all_urls>')
      expect(host).toMatch(/^https:\/\/\*?\.?[a-z0-9.-]+\.[a-z]{2,}\//)
    }
  })

  /**
   * The self-hosted package — the zip actually served from
   * visaai.co/extension while there is no Web Store listing.
   *
   * The same reasoning that motivated this file applies here: a build step only
   * protects the artefact it actually produced, and until now the only artefact
   * under test was the store package. The zip people download is a DIFFERENT
   * one with an opposite requirement.
   *
   * Without `key`, Chrome derives an unpacked extension's id from the
   * installing user's filesystem path. Every user therefore gets a different
   * id, none of them equal to NEXT_PUBLIC_EXTENSION_ID, so the web app's
   * runtime.sendMessage handoff silently fails for everyone. `key` is the
   * base64 DER PUBLIC key — it pins the id and discloses nothing.
   */
  describe('self-hosted package', () => {
    function selfhostManifest(): Record<string, unknown> {
      return JSON.parse(
        readFileSync(join(selfhostDist, 'manifest.json'), 'utf8'),
      ) as Record<string, unknown>
    }

    it('KEEPS `key`, so every unpacked install resolves to the same id', () => {
      expect(selfhostManifest()).toHaveProperty('key')
    })

    it('resolves to the id the web app messages', () => {
      // Chrome's rule: sha256 of the DER public key, first 16 bytes, hex
      // digits mapped 0-f -> a-p.
      const { createHash } = require('crypto') as {
        createHash: (a: string) => {
          update: (b: unknown) => { digest: (e: string) => string }
        }
      }
      const key = selfhostManifest().key as string
      const hex = createHash('sha256')
        .update(Buffer.from(key, 'base64'))
        .digest('hex')
        .slice(0, 32)
      const id = [...hex]
        .map((d) => String.fromCharCode(97 + parseInt(d, 16)))
        .join('')
      expect(id).toBe('hlpcffbcmecnoonfkalhilacgebgkfcf')
    })

    it('still trusts only VisaAI origins — SEC-8510 applies to BOTH packages', () => {
      const matches =
        (
          selfhostManifest().externally_connectable as
            | { matches?: string[] }
            | undefined
        )?.matches ?? []
      expect(matches.length).toBeGreaterThan(0)
      for (const m of matches) {
        expect(m).not.toMatch(/localhost|127\.0\.0\.1/)
        expect(m).toMatch(/^https:\/\//)
      }
    })
  })
})
