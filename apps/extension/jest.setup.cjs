// jsdom lacks Web Crypto + (sometimes) TextEncoder; polyfill from Node so the
// readback engine's crypto.subtle / TextEncoder work under jsdom.
//
// The guard is on `crypto.subtle`, NOT on `crypto`. jsdom DOES define
// globalThis.crypto — with getRandomValues and no subtle — so `if
// (!globalThis.crypto)` was always false and the polyfill never ran. Every test
// touching hashValue() died on "Cannot read properties of undefined (reading
// 'digest')", which is what the readback engine is built on.
const { webcrypto } = require('node:crypto')
const { TextEncoder, TextDecoder } = require('node:util')

if (!globalThis.crypto?.subtle) {
  // Defined non-writable by jsdom, so assignment alone is not enough.
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}
if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder
if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder
