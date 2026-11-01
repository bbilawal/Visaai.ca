// Copy CA/* objects of the template buckets from visaai.co storage to visaai.ca.
// Usage: SRC_URL SRC_KEY DST_URL DST_KEY node copy-storage.mjs <names.txt>  (lines: bucket|name|mimetype)
import fs from 'node:fs'
const { SRC_URL, SRC_KEY, DST_URL, DST_KEY } = process.env
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)
let ok = 0
for (const line of lines) {
  const [bucket, name, mime] = line.split('|')
  const enc = name.split('/').map(encodeURIComponent).join('/')
  const src = await fetch(`${SRC_URL}/storage/v1/object/${bucket}/${enc}`, { headers: { apikey: SRC_KEY, Authorization: `Bearer ${SRC_KEY}` } })
  if (!src.ok) { console.error('download failed', bucket, name, src.status); continue }
  const body = Buffer.from(await src.arrayBuffer())
  const dst = await fetch(`${DST_URL}/storage/v1/object/${bucket}/${enc}`, {
    method: 'POST', body,
    headers: { apikey: DST_KEY, Authorization: `Bearer ${DST_KEY}`, 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' },
  })
  if (!dst.ok) { console.error('upload failed', bucket, name, dst.status, await dst.text()); continue }
  ok++
}
console.log(`copied ${ok}/${lines.length}`)
