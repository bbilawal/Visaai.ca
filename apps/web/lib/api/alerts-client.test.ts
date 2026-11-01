import { describe, it, expect } from 'vitest'
import { alertPath } from './alerts-client'

describe('alerts-client', () => {
  it('builds the alert resource path', () => {
    expect(alertPath('a1')).toBe('/analytics/alerts/a1')
    expect(alertPath()).toBe('/analytics/alerts')
  })
})
