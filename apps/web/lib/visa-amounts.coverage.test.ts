import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { amounts } from './visa-amounts'

/**
 * Every monetary parameter stored by an extraction must actually render.
 *
 * The first version of `amounts()` handled ten hand-listed keys and returned
 * null for everything else — silently. Within a day I added four Norwegian keys
 * it did not know, and the figures reached the page only because I had also
 * written them into the requirement labels. An audit then found 41 of 54 stored
 * keys unhandled, including UK maintenance minimums and Australian living costs.
 *
 * A renderer that fails silently needs a test that does not. This walks the real
 * extraction files — the same data production serves — and fails if any stored
 * number with a currency would render as nothing.
 */

const DIR = join(__dirname, '../../../data/requirements')

interface Req {
  requirement_code: string
  parameters?: Record<string, unknown> | null
}

function everyRequirement(): Array<{ file: string; req: Req }> {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as {
        requirements?: Req[]
      }
      return (doc.requirements ?? []).map((req) => ({ file, req }))
    })
}

describe('amounts — coverage over the real extraction files', () => {
  it('finds extraction files to check', () => {
    // Guards the guard: a wrong path would make every assertion below vacuous.
    expect(everyRequirement().length).toBeGreaterThan(100)
  })

  it('renders every stored monetary parameter', () => {
    const silent: string[] = []

    for (const { file, req } of everyRequirement()) {
      const p = req.parameters
      if (!p || typeof p.currency !== 'string') continue

      // Anything numeric next to a currency is money, bar the documented
      // exceptions inside amounts() itself.
      const hasNumber = Object.entries(p).some(
        ([k, v]) => k !== 'currency' && k !== 'read_at' && typeof v === 'number',
      )
      if (!hasNumber) continue

      if (amounts(p) === null) {
        silent.push(`${file}: ${req.requirement_code} -> ${JSON.stringify(p)}`)
      }
    }

    expect(silent).toEqual([])
  })

  it('never renders a bare currency with no figure', () => {
    // "NOK" alone on a visa page is worse than saying nothing.
    //
    // A digit is the test for MONEY, and `free` is deliberately not money — it
    // is the words the renderer uses instead of "LBP 0". So the assertion is
    // that every rendered segment either carries a figure or says free, rather
    // than that every output contains a digit. The looser form was hiding
    // behind luck: `free (6 to 11)` passed only because the BRACKET happens to
    // contain digits, so a whole-route zero (Lebanon's courtesy residence) was
    // the first thing to fail it.
    for (const { file, req } of everyRequirement()) {
      const out = amounts(req.parameters ?? null)
      if (out === null) continue
      for (const segment of out.split(' · ')) {
        const ok = /\d/.test(segment) || segment === 'free'
        expect(ok, `${file}: ${req.requirement_code} rendered "${segment}"`).toBe(true)
        // And whatever it says, it is never the currency on its own.
        expect(segment).not.toMatch(/^[A-Z]{3}$/)
      }
    }
  })

  it('does not price the non-monetary numbers that sit beside a currency', () => {
    // family_minimum_size is "5 or more people"; held_for_days is the UK's
    // 28-day holding period. Either rendered as money invents a price.
    expect(amounts({ family_minimum_size: 5, currency: 'CAD' })).toBeNull()
    expect(amounts({ held_for_days: 28, currency: 'GBP' })).toBeNull()
  })

  it('never prices the year an authority stamps on its own figures', () => {
    // REGRESSION. Sweden's maintenance thresholds carry stated_for_year: 2026,
    // and the renderer emitted "SEK 2,026 stated for year" -- alongside six
    // genuine thresholds, where an invented price reads as authoritative.
    //
    // The tests above could not catch it: they assert every stored number
    // RENDERS, and this one rendered. Nothing asserted that everything rendered
    // is money. That asymmetry is the gap, and it is why the sweep below walks
    // the real files rather than trusting the rule.
    expect(amounts({ stated_for_year: 2026, currency: 'SEK' })).toBeNull()
    expect(
      amounts({ per_month_cohabiting_partners_sek: 10314, stated_for_year: 2026, currency: 'SEK' }),
    ).toBe('SEK 10,314 per month cohabiting partners')
  })

  it('never prices a multiplier, ratio, share or percentage', () => {
    // REGRESSION. Sweden's Blue Card threshold is 1.25 x the average gross
    // salary, and `multiplier_of_average_salary: 1.25` sat in the same object
    // as the SEK figure it produces. It rendered as "SEK 1.25 multiplier of
    // average salary", immediately after "SEK 53,625 per month" -- a second,
    // absurdly small price for the same requirement.
    //
    // Neither guard above could see it. The coverage sweep asserts every stored
    // number RENDERS, and this one did. The year sweep only looks at 1900-2100
    // integers. So this sweeps the CLASS by key name over the real files: a
    // ratio expressed as a bare number beside a currency is never a price, and
    // the next such key fails here rather than pricing itself on a live page.
    const RATIO_WORD = /(multiplier|ratio|percent|share|factor|times_the)/i
    const priced: string[] = []

    for (const { file, req } of everyRequirement()) {
      const p = req.parameters
      if (!p || typeof p.currency !== 'string') continue
      for (const [k, v] of Object.entries(p)) {
        if (typeof v !== 'number' || !RATIO_WORD.test(k)) continue
        const out = amounts({ [k]: v, currency: p.currency })
        if (out !== null) priced.push(`${file}: ${req.requirement_code} -> ${k}=${v} rendered "${out}"`)
      }
    }

    expect(priced).toEqual([])
    // And the specific shape, so the sweep cannot pass vacuously if the file
    // ever stops storing one.
    expect(amounts({ multiplier_of_average_salary: 1.25, currency: 'SEK' })).toBeNull()
    expect(
      amounts({ per_month_sek: 53625, multiplier_of_average_salary: 1.25, currency: 'SEK' }),
    ).toBe('SEK 53,625 per month')
  })

  it('renders no figure that merely restates a calendar year', () => {
    // Sweeps the real extraction files for the same shape under a different
    // key name. A bare 1900-2100 integer beside a currency is a year far more
    // often than a price -- and where it genuinely IS a price (Sweden's
    // SEK 2,000 fee) the key says so, which is what the allow-list checks.
    const YEARISH = /^(19|20)\d{2}$/
    const NAMED_AS_MONEY = /(fee|amount|cost|sek|nok|eur|gbp|aud|cad|usd|nzd|income|salary|funds|cover|per_month|per_day|per_year|adults|children)/i
    const suspects: string[] = []

    for (const { file, req } of everyRequirement()) {
      const p = req.parameters
      if (!p || typeof p.currency !== 'string') continue
      for (const [k, v] of Object.entries(p)) {
        if (typeof v !== 'number' || !YEARISH.test(String(v))) continue
        if (NAMED_AS_MONEY.test(k)) continue
        const out = amounts({ [k]: v, currency: p.currency })
        if (out !== null) suspects.push(`${file}: ${req.requirement_code} -> ${k}=${v} rendered "${out}"`)
      }
    }

    expect(suspects).toEqual([])
  })
})

describe('counts of periods are not prices', () => {
  /**
   * REGRESSION, and the third distinct time this shape has reached the renderer.
   *
   * Denmark's permanent-residence income test averages taxable income over 2
   * years, and its unsalaried PhD self-support counts a maximum of 12 months.
   * Both sat in the same object as the real DKK figure they qualify and both
   * rendered as prices — "DKK 2 years averaged" beside DKK 346,155.57, and
   * "DKK 12 max months counted" beside DKK 7,426. Two DKK figures on one line
   * read as a discount or an instalment.
   *
   * NONE of the three guards above could see it, and each has the same blind
   * spot: the coverage sweep asserts every stored number RENDERS, and these
   * rendered; the year sweep only looks at 1900-2100 integers, and 2 and 12 are
   * not years; the multiplier sweep matches ratio-shaped key names, and these
   * are counts.
   *
   * WHY THIS IS AN ALLOW-LIST AND NOT A CLEVERER REGEX
   *
   * There is no reliable pattern separating a COUNT OF PERIODS from money whose
   * key happens to name a period. `living_costs_student_12_months` is money.
   * `max_months_counted` is not. `minimum_annual_salary` is money. `over_years`
   * is not. Every rule proposed for telling them apart misfiles one of those
   * four.
   *
   * So this does what the registry's own schema does with visa categories: it
   * forces the question to be answered ONCE, per key, in the open. Any
   * period-shaped key sitting beside a currency must be either deny-listed in
   * NOT_MONEY or named here as money. A new key that is neither fails this test
   * — which is the point, because the alternative is a deny-list maintained by
   * noticing, and that is always one key behind.
   *
   * When this first ran over the real files it failed on TEN keys. Two were
   * the Danish ones above. The other eight were already live, across six
   * countries: the UK youth mobility scheme, Irish family reunification, the
   * Lebanese domestic worker, passport-renewal and bank-statement routes, and
   * the Malaysian residence pass were each printing an invented price beside a
   * real one — "GBP 31 day 28 within days of applying", "EUR 3 over years",
   * "LBP 3 minimum age months", "LBP 2 months", "LBP 3 statement months",
   * "MYR 5 validity years".
   */
  const PERIOD_SHAPED =
    /(^|_)(years?|months?|weeks?|days?|hours?)(_|$)|(^|_)(max|min|minimum|maximum|num|number|count)(_|$)/i

  /**
   * `per_<period>` is a RATE and rates are money — NOK 300,000 per year, DKK
   * 7,426 per month, AUD 13,502 school costs per child per year. This is the
   * one structural distinction that does hold, and it is what keeps the
   * allow-list below down to a dozen keys instead of every threshold in the
   * registry.
   */
  const RATE = /(^|_)per_/i

  /**
   * Period-shaped keys that ARE money. Each was read off the authority's page
   * and confirmed to be an amount, not a count.
   */
  const MONEY_ANYWAY = new Set([
    'living_costs_student_12_months',
    'living_costs_partner_12_months',
    'living_costs_child_12_months',
    'family_maximum',
    'group_maximum',
    'performing_artist_group_maximum',
    'minimum_emergency_cover_cad',
    'minimum_annual_salary',
    'maximum_total',
    'first_year_in_account_eur',
    'maximum_equipment_value_gbp',
    'minimum_gross_previous_year_eur',
    'minimum_cover_eur',
    'min_all_sectors',
    'max_all_sectors_age_45_plus',
    'min_financial_services',
    'max_financial_services_age_45_plus',
    // Türkiye's per-day permit fee floor and ceiling for the first month.
    'minimum',
    'maximum',
  ])

  it('every period-shaped key beside a currency is classified, one way or the other', () => {
    const unclassified: string[] = []

    for (const { file, req } of everyRequirement()) {
      const p = req.parameters
      if (!p || typeof p.currency !== 'string') continue

      for (const [key, value] of Object.entries(p)) {
        if (key === 'currency' || key === 'read_at') continue
        if (typeof value !== 'number') continue
        if (RATE.test(key)) continue
        if (!PERIOD_SHAPED.test(key)) continue
        if (MONEY_ANYWAY.has(key)) continue

        // Not allow-listed, so it must not render — i.e. it must be denied.
        const rendered = amounts({ [key]: value, currency: p.currency })
        if (rendered !== null) {
          unclassified.push(`${file} ${req.requirement_code}: ${key}=${value} -> "${rendered}"`)
        }
      }
    }

    expect(
      unclassified,
      'A period-shaped number beside a currency is being printed as a price:\n  ' +
        unclassified.join('\n  ') +
        '\n\nDecide which it is. If it is money, add the key to MONEY_ANYWAY in this\n' +
        'test. If it is a count, add it to NOT_MONEY in visa-amounts.ts.',
    ).toEqual([])
  })

  it('still prices a RATE per period, which is money', () => {
    // Guards the guard: were the sweep to start denying rates, it would delete
    // real figures instead of inventing fake ones — a quieter, worse failure.
    expect(amounts({ per_year_pre_tax_nok: 300_000, currency: 'NOK' })).toBe(
      'NOK 300,000 per year pre tax',
    )
    expect(amounts({ per_month: 7426, currency: 'DKK' })).toBe('DKK 7,426 per month')
  })

  it('denies the five keys this sweep found, and keeps the figures they qualify', () => {
    expect(amounts({ years_averaged: 2, currency: 'DKK' })).toBeNull()
    expect(amounts({ max_months_counted: 12, currency: 'DKK' })).toBeNull()
    expect(amounts({ day_28_within_days_of_applying: 31, currency: 'GBP' })).toBeNull()
    expect(amounts({ over_years: 3, currency: 'EUR' })).toBeNull()
    expect(amounts({ minimum_age_months: 3, currency: 'LBP' })).toBeNull()

    expect(
      amounts({ average_annual_taxable_income: 346155.57, years_averaged: 2, currency: 'DKK' }),
    ).toBe('DKK 346,155.57 average annual taxable income')
    expect(
      amounts({ savings_gbp: 2530, held_for_days: 28, day_28_within_days_of_applying: 31, currency: 'GBP' }),
    ).toBe('GBP 2,530 savings')
    expect(amounts({ cumulative_gross_eur: 75000, over_years: 3, currency: 'EUR' })).toBe(
      'EUR 75,000 cumulative gross',
    )
    expect(amounts({ amount: 150000000, minimum_age_months: 3, currency: 'LBP' })).toBe(
      'LBP 150,000,000',
    )
  })
})
