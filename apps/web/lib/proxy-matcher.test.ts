/**
 * The proxy matcher decides which paths get localised. Anything it catches that
 * is NOT a localised page gets 307'd into the app, and the caller receives an
 * HTML document where it expected a file.
 *
 * That has happened three times, each recorded in proxy.ts: /robots.txt served
 * crawlers an HTML document instead of crawl directives; the packaged Chrome
 * extension .zip answered 200 with HTML so the download looked corrupt; and
 * /.well-known would have broken Universal Links outright, because iOS does not
 * follow redirects when fetching apple-app-site-association.
 *
 * Three times is enough. The exclusions were a regex maintained by hand with a
 * comment explaining why — and a comment is not an enforcement mechanism.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The pattern is READ OUT OF proxy.ts as text rather than imported.
 *
 * Importing the module pulls in next-intl's middleware, which does not resolve
 * under vitest. And the pattern cannot be extracted into a shared module
 * either: Next requires `config.matcher` to be a statically analysable literal,
 * so moving it would silently disable the middleware — a far worse failure than
 * the one this test prevents.
 *
 * Reading the file keeps ONE source of truth. A copy of the regex here would be
 * a second list to drift, which is the thing being guarded against.
 */
function matcherPattern(): string {
  const src = readFileSync(join(__dirname, '..', 'proxy.ts'), 'utf8')
  // The single matcher entry is the only quoted string starting with '/((?!'.
  const m = src.match(/'(\/\(\(\?!.*?)'/s)
  if (!m) {
    throw new Error(
      'Could not find the matcher literal in proxy.ts. If its shape changed, fix ' +
        'this reader — do not copy the regex here, or there will be two lists to drift.',
    )
  }
  // proxy.ts escapes backslashes for a TS string literal; unescape for RegExp.
  return m[1].replace(/\\\\/g, '\\')
}

const matches = (path: string) => new RegExp(`^${matcherPattern()}$`).test(path)

describe('proxy matcher', () => {
  it.each([
    ['/robots.txt', 'crawl directives'],
    ['/llms.txt', 'AI-readable manifest'],
    ['/sitemap.xml', 'sitemap'],
    ['/.well-known/apple-app-site-association', 'Universal Links'],
    ['/extension/visaai-portal-assistant.zip', 'packaged extension'],
    ['/favicon.ico', 'favicon'],
  ])('does not localise %s (%s)', (path) => {
    expect(matches(path)).toBe(false)
  })

  it.each([
    ['/'],
    ['/visas'],
    ['/visas/canada/study-permit'],
    ['/applications/new'],
  ])('does localise %s', (path) => {
    expect(matches(path)).toBe(true)
  })
})
