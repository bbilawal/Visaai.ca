// @types/node is deliberately not a dependency of this browser-targeted
// package (see executor.spec.ts), so the few builtins this file needs are
// declared rather than pulled in.
declare function require(id: string): unknown
declare const __dirname: string
const { readFileSync } = require('fs') as {
  readFileSync: (p: string, enc: string) => string
}
const { join } = require('path') as { join: (...p: string[]) => string }

import { isTrustedApiUrl } from '../src/shared'

/**
 * The side panel would drive a government form on behalf of ANY socket server.
 *
 * `background.ts` refuses an attacker-chosen `apiUrl` on the web-app handoff,
 * and says why in a comment tagged SEC-8510: a token bound to an attacker's
 * server means the next call exfiltrates the user's session. That control was
 * implemented once, on one of the two paths that dial a server.
 *
 * The side panel's own connect path had no equivalent. `sidepanel.html` offers
 * a free-form "API URL" box (its placeholder even suggests
 * `http://localhost:4000`), and `connect()` passed the value straight to
 * `io(...)` with no protocol check and no host check.
 *
 * Worse, the write handlers are registered on that socket unconditionally and
 * did not require that the extension had ever ASKED for a fill.
 * `portal-fill:start` is the only emit gated on holding a `readbackToken` — the
 * server-signed approval — but the server drives everything after it. A rogue
 * server could simply emit `portal-fill:stage {stage:'started'}` itself. The
 * panel would resolve the active portal tab, bind it, and then execute every
 * `portal-fill:write` that followed. `expectedValueHash` is supplied by that
 * same server, so `verifyField` dutifully reports the attacker's own value as
 * `verified`.
 *
 * Concretely: a phishing page says "paste this API URL and token into the
 * VisaAI panel". Values the attacker chose are typed into the user's
 * authenticated IRCC form and reported back as verified. What still bounds it
 * is real and worth stating — `safety-guards.ts` forbids submit/click/navigate,
 * and the manifest's host permissions confine writes to the portal hosts — so
 * this corrupts a form the user is about to submit rather than submitting it.
 *
 * Two fixes, matching the two gaps: the panel now applies the SAME trust rule
 * as `background.ts` (moved into `shared.ts` so there is one copy), and the
 * fill handshake is inert until the panel itself has requested a fill with an
 * approval token.
 */

describe('isTrustedApiUrl', () => {
  it.each([
    'https://visaai.co',
    'https://api.visaai.co',
    'https://api.visaai.co/',
    'http://localhost:4000',
    'http://127.0.0.1:4000',
  ])('accepts %s', (url) => {
    expect(isTrustedApiUrl(url)).toBe(true)
  })

  it.each([
    ['http://visaai.co', 'plain http on the real host — downgrades the session'],
    ['https://visaai.co.evil.test', 'suffix attack on the domain'],
    ['https://evilvisaai.co', 'prefix attack on the domain'],
    ['https://attacker.test', 'unrelated host'],
    ['ws://localhost:4000', 'non-http scheme'],
    ['javascript:alert(1)', 'not a network URL at all'],
    ['file:///etc/passwd', 'local file scheme'],
    ['not a url', 'unparseable'],
    ['', 'empty'],
  ])('refuses %s (%s)', (url) => {
    expect(isTrustedApiUrl(url)).toBe(false)
  })

  it('refuses a subdomain of a lookalike TLD', () => {
    expect(isTrustedApiUrl('https://api.visaai.com')).toBe(false)
  })
})

describe('the side panel applies the same trust rule as the background worker', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'sidepanel.ts'), 'utf8')
  const background = readFileSync(
    join(__dirname, '..', 'src', 'background.ts'),
    'utf8',
  )

  it('validates the API URL before dialling it', () => {
    expect(src).toContain('isTrustedApiUrl')
  })

  it('does not keep a second private copy of the rule', () => {
    // One definition, in shared.ts. Two copies drift, and this one is the
    // difference between a session going to us and going to an attacker.
    expect(src).not.toContain('function isTrustedApiUrl')
    expect(background).not.toContain('function isTrustedApiUrl')
  })

  it('will not act on a fill it never requested', () => {
    // The server must not be able to open the handshake on its own.
    expect(src).toContain('startRequested')
  })

  it('consumes the requested-fill approval before any await in the handshake', () => {
    // Consumed after the bind, a second `started` delivered while the first
    // awaited resolvePortalTab/pf-bind-session passed the same check.
    expect(src).toMatch(
      /if \(!startRequested\) \{[\s\S]*?return\s*\}\s*(\/\/[^\n]*\n\s*)*startRequested = false\s*\n(\s*\/\/[^\n]*\n)*\s*(const|let) tabId = await resolvePortalTab\(\)/,
    )
  })

  it('binds at most once per approval', () => {
    const handshake = src.slice(
      src.indexOf("if (msg.stage === 'started')"),
      src.indexOf("if (msg.stage === 'completed')"),
    )
    // Re-armed only on the two failed-bind paths, never after a bind.
    const rearm = handshake.match(/startRequested = true/g) ?? []
    expect(rearm).toHaveLength(2)
    const afterBind = handshake.slice(
      handshake.indexOf('boundExecutionId = msg.executionId'),
    )
    expect(afterBind).not.toContain('startRequested = true')
  })
})
