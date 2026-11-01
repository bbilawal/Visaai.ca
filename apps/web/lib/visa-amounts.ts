/**
 * Render a requirement's structured amounts.
 *
 * Fee and threshold figures live in `visa_requirements.parameters`, not in
 * prose, and for a long time nothing read them — a page could list "Visitor visa
 * application fee" and never say NZD 441. Canada looked correct only because its
 * amount had been duplicated into `description` by hand, which is exactly how a
 * systematic gap hides behind one accidentally-right page.
 *
 * WHY THIS IS A RULE AND NOT A LIST OF KEYS
 *
 * The first version handled ten hand-listed keys and silently rendered nothing
 * for anything else. Within a day I added four Norwegian keys it did not know
 * (`per_month_nok`, `per_year_nok`, `autumn_semester_nok`, `spring_semester_nok`)
 * and walked straight into my own gap — the figures appeared on the page only
 * because I had also written them into the requirement labels.
 *
 * An audit found 41 of 54 stored parameter keys unhandled, including UK
 * maintenance minimums and Australian living costs. So the rule is now
 * structural rather than enumerated:
 *
 *   a NUMBER, alongside a `currency`, is money — unless it is named on the
 *   deny-list below.
 *
 * A new destination can add a key without anyone remembering to update this
 * file, and `visa-amounts.coverage.test.ts` fails if a stored key would render
 * nothing.
 */

/**
 * Numbers that sit next to a currency and are NOT money.
 *
 * `family_minimum_size` is "5 or more people" on a Canadian family fee;
 * `held_for_days` is the UK's 28-day maintenance holding period. Rendering
 * either as "CAD 5" or "GBP 28" would invent a price.
 */
const NOT_MONEY = new Set([
  'family_minimum_size',
  'held_for_days',
  // A validity period, not a price: Canada's super visa insurance must run 12
  // months from entry, beside its CAD 100,000 cover. Rendered as "CAD 12
  // minimum validity months" until the coverage sweep caught it.
  'minimum_validity_months',
  // The year an authority stamps on its own figures. Sweden's maintenance
  // thresholds carry stated_for_year: 2026, and this rendered as
  // "SEK 2,026 stated for year" -- an invented price, printed in the same line
  // as six real thresholds, where it reads as authoritative.
  //
  // A range heuristic ("numbers near 2026 are years") would be worse than the
  // deny-list, not better: Sweden's own application fee is SEK 2,000. And a
  // key-name heuristic on /year/ is wrong too -- per_year_pre_tax_nok is
  // Norway's sponsor income and very much money. So it is named explicitly.
  'stated_for_year',
  // Same class, bare key. Türkiye's residence fees carry `year: 2026` beside
  // real TRY amounts, and it rendered as "TRY 2,026 year" — an invented price
  // printed immediately after TRY 964.00 and TRY 348.10, where it reads as
  // another fee. The coverage sweep caught it before publication; without the
  // sweep the only clue would have been a plausible-looking number on a live
  // page. A year is never money, whatever the key is called.
  'year',
  // A MULTIPLIER IS NOT A PRICE. Sweden's EU Blue Card threshold is defined as
  // 1.25 x the average gross salary published by the National Mediation Office,
  // and `multiplier_of_average_salary: 1.25` sits in the same object as the
  // real SEK figure it produces. It rendered as "SEK 1.25 multiplier of average
  // salary" -- printed immediately after "SEK 53,625 per month", where it reads
  // as a second, absurdly small price for the same requirement.
  //
  // Neither existing guard could see it: the coverage sweep asserts every
  // stored number RENDERS, and this one did; the year sweep only looks at
  // 1900-2100 integers. `visa-amounts.coverage.test.ts` now sweeps the real
  // files for the whole class -- multiplier, ratio, percent, share, factor --
  // so the next such key fails a test instead of pricing itself.
  'multiplier_of_average_salary',
  // COUNTS OF PERIODS ARE NOT RATES PER PERIOD. Denmark's permanent-residence
  // income test averages taxable income over 2 years, and its unsalaried PhD
  // self-support counts a maximum of 12 months. Both sit in the same object as
  // the real DKK figure they qualify, and both rendered as prices --
  // "DKK 2 years averaged" beside DKK 346,155.57, and "DKK 12 max months
  // counted" beside DKK 7,426. A reader seeing two DKK figures on one line
  // reads the smaller as a discount or an instalment.
  //
  // This is the B-35 class exactly, caught before publication this time rather
  // than two minutes after it. The keys are named individually and not matched
  // by pattern, because the file's own history says why: a /year/ heuristic
  // would swallow `per_year_pre_tax_nok`, which is Norway's sponsor income and
  // very much money. The distinction is a COUNT OF PERIODS versus a RATE PER
  // PERIOD, and no key-name regex separates those reliably.
  'years_averaged',
  'max_months_counted',
  // THREE MORE OF THE SAME CLASS, FOUND LIVE IN PRODUCTION by the period-count
  // sweep in visa-amounts.coverage.test.ts. Each sat beside a real figure and
  // rendered as a second, much smaller price for the same requirement:
  //
  //   GBP 2,530 savings · GBP 31 day 28 within days of applying
  //   EUR 75,000 cumulative gross · EUR 3 over years
  //   LBP 150,000,000 · LBP 3 minimum age months
  //
  // The UK one is the sharpest lesson available here: `held_for_days` was
  // ALREADY on this deny-list, and it is a sibling key in the very same
  // parameters object as `day_28_within_days_of_applying`. Whoever added the
  // first one had the object open and fixed the number that had been noticed.
  // A deny-list maintained by noticing will always be one key behind, which is
  // why the sweep now fails on any unrecognised period-shaped key rather than
  // waiting for someone to see it on a page.
  'day_28_within_days_of_applying',
  'over_years',
  'minimum_age_months',
  // Three more the same sweep found live: a two-month permit rendering as
  // "LBP 2 months", a three-month bank statement as "LBP 3 statement months",
  // and a five-year pass validity as "MYR 5 validity years". Eight invented
  // prices in total, across five countries, none of which any existing guard
  // could see.
  'months',
  'statement_months',
  'validity_years',
  // Singapore's ONE Pass: 12 consecutive months of salary history rendered as
  // "SGD 12", and a 6-month application window as "SGD 6". Ten in total.
  'consecutive_months',
  'apply_within_months_of_start',
])

/** Shapes worth phrasing specially, because the bare number misleads. */
const PHRASING: Record<string, (money: string) => string> = {
  amount: (m) => m,
  // INZ and IRCC publish "from" prices whose final value depends on where you
  // apply. Presenting one as fixed would understate the cost.
  amount_from: (m) => `from ${m}`,
  eur_12_and_over: (m) => `${m} (12+)`,
  eur_6_to_11: (m) => `${m} (6-11)`,
  minimum_cover_eur: (m) => `minimum cover ${m}`,
  per_day_nok_accommodation_paid: (m) => `${m} per day with accommodation paid`,
  per_day_nok_no_accommodation: (m) => `${m} per day otherwise`,
  per_month_nzd_accommodation_prepaid: (m) => `${m} per month if accommodation is prepaid`,
}

/**
 * Turn a key into readable words: `living_costs_student_12_months` becomes
 * "living costs student 12 months". Currency suffixes are dropped because the
 * amount already carries the currency — "NOK 15,488 per month nok" reads badly.
 */
function humanise(key: string): string {
  return key
    .replace(/_(nok|sek|nzd|eur|gbp|aud|cad|usd)(_|$)/gi, '$2')
    .replace(/_/g, ' ')
    .trim()
}

export function amounts(parameters: Record<string, unknown> | null): string | null {
  if (!parameters) return null
  const currency = typeof parameters.currency === 'string' ? parameters.currency : null
  if (!currency) return null

  const parts: string[] = []

  for (const [key, value] of Object.entries(parameters)) {
    if (key === 'currency' || key === 'read_at') continue
    if (NOT_MONEY.has(key)) continue
    if (typeof value !== 'number') continue

    const money = `${currency} ${value.toLocaleString('en')}`

    // A zero fee is a real and useful fact — Sweden charges nothing under 6 —
    // but "EUR 0" reads as a bug, so say it in words.
    //
    // The parenthetical exists to name WHICH bracket is free (`free (6 to 11)`).
    // The unqualified `amount` key has no bracket to name, and humanising it
    // produced the literal string "free (amount)" — which Lebanon's courtesy
    // residence, the first route in this registry an authority states as free
    // OUTRIGHT rather than free for one age band, rendered on its fee line.
    // A whole-route zero says "free" and nothing else.
    if (value === 0) {
      const bracket = humanise(key).replace(/^eur /, '')
      parts.push(bracket === 'amount' ? 'free' : `free (${bracket})`)
      continue
    }

    const phrase = PHRASING[key]
    parts.push(phrase ? phrase(money) : `${money} ${humanise(key)}`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}
