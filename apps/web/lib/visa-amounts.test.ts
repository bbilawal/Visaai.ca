import { describe, it, expect } from 'vitest'
import { amounts } from './visa-amounts'

/**
 * Fee amounts live in `visa_requirements.parameters`, not in prose.
 *
 * Nothing read that column, so a visa page could list "Visitor visa application
 * fee" and never say what the visa costs. It went unnoticed because Canada's
 * page looked correct — its figure had been duplicated into the `description`
 * text by hand — while New Zealand's NZD 441 and Sweden's EUR 90 were simply
 * absent. One page accidentally right is how a systematic gap hides.
 *
 * These tests pin the shapes actually stored by the extractions, so adding a
 * destination whose fee uses a new key fails here rather than silently
 * rendering nothing.
 */
describe('amounts', () => {
  it('renders a flat fee', () => {
    // Netherlands: € 423,00 highly skilled migrant application.
    expect(amounts({ amount: 423, currency: 'EUR' })).toBe('EUR 423')
  })

  it('marks a "from" price as approximate rather than exact', () => {
    // INZ publishes "cost from NZD $441" — the final fee depends on where you
    // apply, so presenting it as a fixed price would understate the risk.
    expect(amounts({ amount_from: 441, currency: 'NZD' })).toBe('from NZD 441')
  })

  it('renders a banded fee with its age bands', () => {
    // Sweden's Schengen fee is age-banded; showing only EUR 90 would overcharge
    // a family with children on screen.
    expect(
      amounts({
        eur_12_and_over: 90,
        eur_6_to_11: 45,
        eur_under_6: 0,
        currency: 'EUR',
      }),
    ).toBe('EUR 90 (12+) · EUR 45 (6-11) · free (under 6)')
  })

  it('renders per-day maintenance thresholds with their condition', () => {
    // Norway's two rates depend on whether accommodation is paid for. Printing
    // one without the other would make VisaAI stricter or looser than UDI.
    expect(
      amounts({
        per_day_nok_accommodation_paid: 300,
        per_day_nok_no_accommodation: 1300,
        currency: 'NOK',
      }),
    ).toBe('NOK 300 per day with accommodation paid · NOK 1,300 per day otherwise')
  })

  it('renders an insurance minimum', () => {
    expect(amounts({ minimum_cover_eur: 30000, currency: 'EUR' })).toBe(
      'minimum cover EUR 30,000',
    )
  })

  it('stays silent when there is no currency', () => {
    // Without a currency a number is meaningless, and guessing one on a visa
    // page is worse than omitting the figure — the quoted description remains.
    expect(amounts({ amount: 423 })).toBeNull()
  })

  it('renders a key it has never seen, rather than dropping the figure', () => {
    // REVERSED DELIBERATELY. This used to assert silence, and silence was the
    // bug: within a day of writing it I added four Norwegian keys the renderer
    // did not know, and an audit found 41 of 54 stored keys unhandled. A number
    // beside a currency is money; a renderer that drops it because nobody
    // remembered to add a case is worse than one that phrases it plainly.
    expect(amounts({ some_future_key: 12, currency: 'EUR' })).toBe(
      'EUR 12 some future key',
    )
  })

  it('drops the currency suffix from a humanised key', () => {
    // "NOK 15,488 per month nok" reads badly; the amount already says NOK.
    expect(amounts({ per_month_nok: 15488, currency: 'NOK' })).toBe(
      'NOK 15,488 per month',
    )
  })

  it('renders Norway\u2019s unequal semester amounts separately', () => {
    // The spring figure is the higher one. A single "per semester" number would
    // understate spring by NOK 15,488 for anyone arriving in January.
    expect(
      amounts({ autumn_semester_nok: 77440, spring_semester_nok: 92928, currency: 'NOK' }),
    ).toBe('NOK 77,440 autumn semester · NOK 92,928 spring semester')
  })

  it('stays silent on null parameters', () => {
    expect(amounts(null)).toBeNull()
  })

  it('ignores a non-numeric amount rather than printing it raw', () => {
    expect(amounts({ amount: 'four hundred', currency: 'EUR' })).toBeNull()
  })
})
