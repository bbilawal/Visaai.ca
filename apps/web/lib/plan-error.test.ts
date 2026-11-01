import { describe, expect, it } from 'vitest'
import { PLAN_PRICE_CENTS, formatPlanPrice, planLabelWithPrice } from '@visaai/types'
import { planErrorToast, parsePlanError, billingUrlFor } from './plan-error'

describe('plan price quoting', () => {
  it('quotes the price the server actually charges', () => {
    // The regression: this file held its own literals and told the user
    // "Expert Review ($100)" while billing charged 25000 cents. A price the
    // user reads must be derived from the price they are charged.
    expect(planErrorToast({ requiredPlan: 'expert', message: '' })).toContain('$250')
    expect(planErrorToast({ requiredPlan: 'copilot', message: '' })).toContain('$30')
    expect(planErrorToast({ requiredPlan: 'self_service', message: '' })).toContain('$10')
  })

  it('derives every quoted price from the shared cent amounts', () => {
    for (const tier of ['self_service', 'copilot', 'expert'] as const) {
      const dollars = PLAN_PRICE_CENTS[tier] / 100
      expect(planErrorToast({ requiredPlan: tier, message: '' })).toContain(
        `$${dollars}`,
      )
    }
  })

  it('formats a whole-dollar price without trailing zeros and a part-dollar with them', () => {
    expect(formatPlanPrice('expert')).toBe('$250')
    expect(planLabelWithPrice('expert')).toBe('Expert Review ($250)')
  })
})

describe('parsePlanError', () => {
  const res = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  it('recognises a gated 403 and names the tier', async () => {
    const err = await parsePlanError(res(403, { message: "Plan 'expert' required" }))
    expect(err?.requiredPlan).toBe('expert')
  })

  it('ignores a non-403', async () => {
    expect(await parsePlanError(res(500, { message: "Plan 'expert' required" }))).toBeNull()
  })

  it('ignores a 403 that is not a plan error', async () => {
    expect(await parsePlanError(res(403, { message: 'Forbidden' }))).toBeNull()
  })

  it('ignores an unknown tier rather than quoting a price for it', async () => {
    expect(await parsePlanError(res(403, { message: "Plan 'platinum' required" }))).toBeNull()
  })

  it('survives a non-JSON body', async () => {
    expect(await parsePlanError(new Response('nope', { status: 403 }))).toBeNull()
  })
})

describe('billingUrlFor', () => {
  it('encodes the application id', () => {
    expect(billingUrlFor('a b/c', 'expert')).toBe(
      '/billing?applicationId=a%20b%2Fc&required=expert',
    )
  })
})
