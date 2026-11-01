import { test, expect } from 'vitest'
import { scorePassword, PASSWORD_MIN_LENGTH } from './password-strength.ts'

test('empty password scores 0 with all checks false', () => {
  const r = scorePassword('')
  expect(r.score).toBe(0)
  expect(r.checks).toEqual({ len: false, upper: false, lower: false, number: false, special: false })
})

test('counts each satisfied rule', () => {
  const r = scorePassword('Ab1!xxxxxxxx') // 12 chars, upper, lower, number, special
  expect(r.checks).toEqual({ len: true, upper: true, lower: true, number: true, special: true })
  expect(r.score).toBe(5)
})

// AUTH-001: the minimum moved 8 -> 12 to match the Supabase project policy.
// Pinning the boundary keeps the client and the server from drifting apart —
// a client that accepts 8 while the server rejects it is a form that fails
// only after submission.
test('the length rule is satisfied at exactly the minimum, not one below', () => {
  expect(PASSWORD_MIN_LENGTH).toBe(12)
  expect(scorePassword('a'.repeat(PASSWORD_MIN_LENGTH)).checks.len).toBe(true)
  expect(scorePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)).checks.len).toBe(false)
})

test('short but mixed scores below max', () => {
  const r = scorePassword('Ab1!') // 4 chars: no len
  expect(r.checks.len).toBe(false)
  expect(r.score).toBe(4)
})

test('lowercase-only long password scores 2 (len + lower)', () => {
  const r = scorePassword('abcdefghijkl')
  expect(r.checks).toEqual({ len: true, upper: false, lower: true, number: false, special: false })
  expect(r.score).toBe(2)
})
