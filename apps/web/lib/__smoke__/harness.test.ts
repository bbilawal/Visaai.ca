import { describe, it, expect } from 'vitest'

describe('vitest harness', () => {
  it('runs and resolves the @ alias environment', () => {
    expect(1 + 1).toBe(2)
  })
})
