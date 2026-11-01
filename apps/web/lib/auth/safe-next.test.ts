import { test, expect } from 'vitest'
import { resolveSafeNext } from './safe-next.ts'

test('returns a same-origin path unchanged', () => {
  expect(resolveSafeNext('/reset-password')).toBe('/reset-password')
  expect(resolveSafeNext('/profile')).toBe('/profile')
})

test('null / undefined / empty fall back to /', () => {
  expect(resolveSafeNext(null)).toBe('/')
  expect(resolveSafeNext(undefined)).toBe('/')
  expect(resolveSafeNext('')).toBe('/')
})

test('rejects non-rooted paths', () => {
  expect(resolveSafeNext('reset-password')).toBe('/')
  expect(resolveSafeNext('https://evil.com')).toBe('/')
})

test('rejects open-redirect vectors', () => {
  expect(resolveSafeNext('//evil.com')).toBe('/')
  expect(resolveSafeNext('/\\evil.com')).toBe('/')
  expect(resolveSafeNext('/%5Cevil.com')).toBe('/')
  expect(resolveSafeNext('/%5cevil.com')).toBe('/')
})
