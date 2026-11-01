/**
 * Chrome Web Store screenshots, captured from the real extension.
 *
 *   node store/screenshots.mjs      (from apps/extension; builds dist/ first)
 *
 * Every panel in the output is a Playwright capture of the built store package
 * (`dist/`, loaded unpacked into Chromium) rendering `sidepanel.html` — the same
 * page Chrome shows in the side panel. Nothing is drawn or mocked up. The states
 * are reached through the extension's own code paths:
 *
 *   - before a hand-off:   the page as it first opens
 *   - untrusted server:    the manual form given a non-VisaAI URL (isTrustedApiUrl)
 *   - review only:         a web-app hand-off (pendingSession) with no approval
 *   - unrequested fill:    the server opens the fill handshake on its own
 *
 * The last two need a server to talk to. That is a local socket.io fixture on
 * 127.0.0.1 speaking the gateway's event names; its only job is to send the two
 * messages a real server sends in those situations. The hand-off itself is written
 * into chrome.storage.local exactly as background.ts stores it.
 *
 * The panels are then laid out on a 1280x800 canvas with a factual caption each.
 * `test/store-listing.spec.ts` checks the files' dimensions.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(root, '..', '..')
// Neither is a dependency of the extension package; both are already installed
// for the web e2e suite and the API.
const { chromium } = createRequire(join(repo, 'apps', 'web', 'package.json'))('@playwright/test')
const { Server } = createRequire(join(repo, 'apps', 'api', 'package.json'))('socket.io')

const OUT = join(root, 'store', 'screenshots')
const W = 1280
const H = 800
const PANEL = { width: 400, height: 640 }

execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' })
const dist = join(root, 'dist')
const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))

// ── local server fixture ─────────────────────────────────────────────────────
const http = createServer()
const io = new Server(http, { transports: ['websocket'] })
io.of('/automation').on('connection', (socket) => {
  const token = socket.handshake.auth?.token
  // automation:ready without a resume token is what the gateway sends once a
  // connect token checks out.
  socket.emit('automation:ready', {})
  if (token === 'fixture-unrequested') {
    // A server-initiated handshake the panel never asked for.
    socket.emit('portal-fill:stage', {
      protocol: 1,
      kind: 'stage',
      executionId: 'fixture-execution',
      stage: 'started',
    }, () => {})
  }
})
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const apiUrl = `http://127.0.0.1:${http.address().port}`

// ── the extension ────────────────────────────────────────────────────────────
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = new URL(worker.url()).host
const panelUrl = `chrome-extension://${extId}/sidepanel.html`

async function capture(setup) {
  const page = await context.newPage()
  await page.setViewportSize(PANEL)
  await page.goto(panelUrl)
  await setup(page)
  await page.waitForTimeout(300)
  const png = await page.screenshot({ type: 'png' })
  await page.close()
  return png
}

async function handoff(page, extra) {
  // What background.ts writes on a `session` message from visaai.co.
  await page.evaluate(
    (pending) => chrome.storage.local.set({ pendingSession: pending }),
    { apiUrl, receivedAt: Date.now(), ...extra },
  )
  await page.reload()
}

const before = await capture(async () => {})
const untrusted = await capture(async (page) => {
  await page.fill('#apiUrl', 'https://visaai.example.com')
  await page.fill('#token', 'example-token')
  await page.click('#connectBtn')
  await page.waitForSelector('#error:not(:empty)')
})
const reviewOnly = await capture(async (page) => {
  await handoff(page, { token: 'fixture-review-only' })
  await page.waitForFunction(() => document.getElementById('error')?.textContent?.includes('No execution approval'))
})
const unrequested = await capture(async (page) => {
  await handoff(page, { token: 'fixture-unrequested' })
  await page.waitForFunction(() => document.getElementById('error')?.textContent?.includes('Ignored an unrequested fill'))
})

// ── layout ───────────────────────────────────────────────────────────────────
const icon = readFileSync(join(root, 'icons', 'icon128.png')).toString('base64')
const b64 = (png) => png.toString('base64')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function sheet(title, panels) {
  const cells = panels
    .map(
      ([png, caption]) => `
      <figure>
        <img src="data:image/png;base64,${b64(png)}" width="${PANEL.width}" height="${PANEL.height}" />
        <figcaption>${esc(caption)}</figcaption>
      </figure>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${W}px; height: ${H}px; background: #f6f3f1; color: #000;
           font-family: system-ui, sans-serif; overflow: hidden; }
    header { display: flex; align-items: center; gap: 14px; padding: 22px 40px 0; }
    header img { width: 40px; height: 40px; }
    header h1 { font-size: 20px; margin: 0; font-weight: 600; }
    header p { font-size: 14px; margin: 2px 0 0; color: #4e4d4d; }
    main { display: flex; justify-content: center; gap: 48px; padding: 18px 40px 0; }
    figure { margin: 0; width: ${PANEL.width}px; }
    figure img { display: block; border: 1px solid rgba(0,0,0,.15); border-radius: 8px; background: #fff; }
    figcaption { font-size: 13px; line-height: 1.35; color: #242424; margin-top: 10px; }
  </style></head><body>
    <header>
      <img src="data:image/png;base64,${icon}" />
      <div><h1>VisaAI Portal Assistant ${esc(version)}</h1><p>${esc(title)}</p></div>
    </header>
    <main>${cells}</main>
  </body></html>`
}

const shots = [
  [
    '01-side-panel.png',
    sheet('The side panel, before a session starts.', [
      [before, 'Opened from the toolbar, before any hand-off from VisaAI.'],
      [untrusted, 'https://visaai.example.com is refused before any connection is made: the panel dials only visaai.co (or a local development server).'],
    ]),
  ],
  [
    '02-no-approval-no-write.png',
    sheet('Nothing is entered in the portal without an approval you gave in VisaAI.', [
      [reviewOnly, 'Hand-off without an approval: the panel connects for review only and writes nothing.'],
      [unrequested, 'A fill the server starts on its own is ignored.'],
    ]),
  ],
]

mkdirSync(OUT, { recursive: true })
const page = await context.newPage()
await page.setViewportSize({ width: W, height: H })
for (const [name, html] of shots) {
  await page.setContent(html)
  writeFileSync(join(OUT, name), await page.screenshot({ type: 'png' }))
  console.log(`wrote store/screenshots/${name}`)
}

await context.close()
io.close()
http.close()
