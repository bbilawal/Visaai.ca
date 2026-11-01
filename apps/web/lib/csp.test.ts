import { describe, expect, it } from 'vitest'
import { buildCsp } from './csp'

const connectSrc = (csp: string) =>
  csp.split('; ').find((d) => d.startsWith('connect-src'))

describe('buildCsp', () => {
  it('production policy is byte-identical to the SEC-8002 policy, whatever the env', () => {
    const expected =
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; " +
      "frame-ancestors 'none'; frame-src 'self'; base-uri 'self'; form-action 'self'; " +
      "object-src 'none'; upgrade-insecure-requests"
    expect(buildCsp({ isProd: true })).toBe(expected)
    // A plaintext origin in the env must never widen the production policy.
    expect(
      buildCsp({
        isProd: true,
        apiUrl: 'http://localhost:4000',
        supabaseUrl: 'http://127.0.0.1:54321',
      }),
    ).toBe(expected)
  })

  it('dev allows the configured plain-http API and Supabase origins', () => {
    expect(
      connectSrc(
        buildCsp({
          isProd: false,
          apiUrl: 'http://localhost:4000',
          supabaseUrl: 'http://127.0.0.1:54321/',
        }),
      ),
    ).toBe("connect-src 'self' https: wss: ws: http://localhost:4000 http://127.0.0.1:54321")
  })

  it('dev reduces a URL with a path to its origin', () => {
    expect(connectSrc(buildCsp({ isProd: false, apiUrl: 'http://127.0.0.1:4100/v1' }))).toBe(
      "connect-src 'self' https: wss: ws: http://127.0.0.1:4100",
    )
  })

  it('dev ignores a missing or malformed URL', () => {
    expect(connectSrc(buildCsp({ isProd: false, apiUrl: 'not a url' }))).toBe(
      "connect-src 'self' https: wss: ws:",
    )
  })
})
