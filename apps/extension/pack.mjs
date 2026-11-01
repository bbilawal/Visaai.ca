/**
 * Reproducible release packaging for the extension.
 *
 *   node pack.mjs            build both packages, write release/*.zip + SHA256SUMS
 *   node pack.mjs --publish  also copy the self-hosted zip to the path the web
 *                            app serves (apps/web/public/extension/…)
 *
 * The zip is written by hand rather than by `zip(1)` so the bytes depend only
 * on the built files: entries sorted, every timestamp fixed at 1980-01-01, mode
 * 0644, no directory entries, no extra fields, and STORED (uncompressed) — a
 * deflate stream can differ between zlib builds, which would make the hash a
 * property of the Node binary instead of the source. Source maps are left out:
 * they embed the full source and Chrome does not need them.
 *
 * This produces an artefact. It does not deploy the web app that serves the
 * self-hosted zip, and it does not submit anything to the Chrome Web Store.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const publish = process.argv.includes('--publish')
const SERVED = join(root, '..', 'web', 'public', 'extension', 'visaai-portal-assistant.zip')

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function listFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listFiles(p))
    else out.push(p)
  }
  return out
}

/** Package files, POSIX-relative, sorted, without source maps. */
export function packageEntries(dir) {
  return listFiles(dir)
    .map((p) => relative(dir, p).split(sep).join('/'))
    .filter((p) => !p.endsWith('.map') && !p.split('/').some((s) => s.startsWith('.')))
    .sort()
}

const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01

export function zipDir(dir) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const name of packageEntries(dir)) {
    const data = readFileSync(join(dir, name))
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4) // version needed
    lh.writeUInt16LE(0x0800, 6) // UTF-8 names
    lh.writeUInt16LE(0, 8) // STORED
    lh.writeUInt16LE(DOS_TIME, 10)
    lh.writeUInt16LE(DOS_DATE, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE((3 << 8) | 20, 4) // made by: unix, 2.0
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(DOS_TIME, 12)
    ch.writeUInt16LE(DOS_DATE, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt16LE(0, 30) // extra
    ch.writeUInt16LE(0, 32) // comment
    ch.writeUInt16LE(0, 34) // disk
    ch.writeUInt16LE(0, 36) // internal attrs
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38) // regular file, 0644
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameBuf)

    offset += lh.length + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const count = centrals.length / 2
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(count, 8)
  eocd.writeUInt16LE(count, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' })
  execFileSync(process.execPath, ['build.mjs', '--selfhost'], { cwd: root, stdio: 'inherit' })

  const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  const outDir = join(root, 'release')
  mkdirSync(outDir, { recursive: true })
  const outputs = [
    [`visaai-portal-assistant-${version}-store.zip`, zipDir(join(root, 'dist'))],
    [`visaai-portal-assistant-${version}-selfhost.zip`, zipDir(join(root, 'dist-selfhost'))],
  ]
  const sums = []
  for (const [name, buf] of outputs) {
    writeFileSync(join(outDir, name), buf)
    sums.push(`${sha256(buf)}  ${name}`)
  }
  writeFileSync(join(outDir, 'SHA256SUMS'), sums.join('\n') + '\n')
  console.log(sums.join('\n'))

  if (publish) {
    copyFileSync(join(outDir, outputs[1][0]), SERVED)
    console.log(`published self-hosted zip -> ${relative(join(root, '..', '..'), SERVED)}`)
  }
}
