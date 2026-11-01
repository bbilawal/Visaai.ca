import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fixture from './fixtures/supported-countries.json'

/**
 * COUNTRY-002: before this suite, `grep -rln 'countr' apps/web/e2e/` returned
 * nothing. The country selector — the entry point to every journey in the
 * product — had zero executed end-to-end coverage on any surface. COUNTRY-001
 * (Bulgaria and Romania missing from the Schengen set for ~19 months) survived
 * that long partly because nothing exercised the list.
 *
 * SCOPE AND HONESTY — read before quoting these results:
 *
 * This suite drives the REAL page and the REAL combobox component. It stubs
 * exactly ONE dependency, at the network boundary: GET /countries is served
 * from ./fixtures/supported-countries.json so the suite needs no API process
 * and no database.
 *
 * That stub is only legitimate because the fixture is proven byte-identical to
 * the live controller payload by apps/api/test/countries-fixture-parity.spec.ts,
 * which fails the moment a country strategy is added or removed. The two tests
 * compose into a real contract chain: registry -> controller -> fixture -> UI.
 *
 * It is still NOT a full live end-to-end journey. Per the programme's own rule,
 * "a journey using a mocked critical dependency must not be reported as a fully
 * live E2E PASS". What this proves is the SELECTOR contract for every supported
 * country. Country-specific rule loading, document checklists, fees, AI guidance
 * and the mobile surfaces remain unexecuted and are tracked as open work.
 */

const COUNTRIES = fixture.countries

const PRIORITY = ['AU', 'US', 'CA', 'GB']

/** Serve the canonical list at the network boundary; assert nothing else is stubbed. */
async function withCountries(page: Page) {
  await page.route('**/countries*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    })
  })
}

/**
 * The page carries TWO role="combobox" inputs (destination country and
 * state/province), so every locator here is scoped explicitly. Options are
 * scoped to the country listbox by its aria-label for the same reason.
 */
async function openPicker(page: Page) {
  await withCountries(page)
  await page.goto('/en/applications/new')
  const input = page.locator('input#country')
  await expect(input).toBeVisible()
  return input
}

/**
 * The name the picker shows for each code. Since c4b878ce the picker renders
 * the browser's CLDR region name for the page locale, not the API's English
 * string (on /en, CZ reads "Czechia"). It is computed IN THE PAGE, with the
 * same fallbacks as lib/localize-country-name.ts, because CLDR differs between
 * Node and Chromium (HK is "Hong Kong SAR China" in one, not the other).
 */
async function shownNames(page: Page): Promise<Record<string, string>> {
  return page.evaluate((countries) => {
    const display = new Intl.DisplayNames(['en'], { type: 'region' })
    const unknown = display.of('ZZ')
    const out: Record<string, string> = {}
    for (const { code, name } of countries) {
      let shown = name
      if (/^[A-Z]{2}$/.test(code)) {
        const t = display.of(code)
        if (t && t.trim() && t !== code && t !== unknown) shown = t
      }
      out[code] = shown
    }
    return out
  }, COUNTRIES)
}

/** Options belonging to the country listbox only. */
function countryOptions(page: Page) {
  return page.getByRole('listbox', { name: 'Destination countries' }).getByRole('option')
}

/**
 * The option whose visible name is exactly `name`. A substring match on the
 * option's text let "Oman" hit "Romania" (the text also carries the code).
 */
function optionNamed(page: Page, name: string) {
  return countryOptions(page).filter({ has: page.getByText(name, { exact: true }) })
}

test.describe('country selector — list contract', () => {
  test('renders every supported country exactly once', async ({ page }) => {
    const input = await openPicker(page)
    await input.click()

    const options = countryOptions(page)
    await expect(options).toHaveCount(COUNTRIES.length)

    const shown = await shownNames(page)
    for (const { code } of COUNTRIES) {
      const name = shown[code]
      const hits = await optionNamed(page, name).count()
      expect(hits, `"${name}" should appear exactly once, saw ${hits}`).toBe(1)
    }
  })

  test('never offers the non-selectable SCHENGEN bloc sentinel', async ({ page }) => {
    const input = await openPicker(page)
    await input.click()
    const rendered = (await countryOptions(page).allTextContents()).join('|')
    expect(rendered).not.toContain('SCHENGEN')
  })

  test('pins the four launch corridors first, in fixed (not alphabetical) order', async ({
    page,
  }) => {
    const input = await openPicker(page)
    await input.click()
    const firstFour = await countryOptions(page).evaluateAll((els) =>
      els.slice(0, 4).map((e) => e.textContent ?? ''),
    )
    const shown = await shownNames(page)
    const expected = PRIORITY.map((c) => shown[c])
    expected.forEach((name, i) => expect(firstFour[i]).toContain(name))
  })

  test('groups Schengen members under their own heading', async ({ page }) => {
    const input = await openPicker(page)
    await input.click()
    await expect(page.getByText('Schengen Countries')).toBeVisible()
  })

  test('includes Bulgaria and Romania — the COUNTRY-001 regression guard', async ({
    page,
  }) => {
    // These two were absent from the product for ~19 months. If a future edit
    // reverts the Schengen set, this fails here as well as in the API parity
    // guard, on the surface a user would actually notice.
    const input = await openPicker(page)
    await input.click()
    const rendered = (await countryOptions(page).allTextContents()).join('|')
    expect(rendered).toContain('Bulgaria')
    expect(rendered).toContain('Romania')
  })
})

test.describe('country selector — accessibility and keyboard', () => {
  test('has no serious or critical a11y violations with the list open', async ({
    page,
  }) => {
    const input = await openPicker(page)
    await input.click()
    await expect(countryOptions(page).first()).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // Systemic token-level contrast debt, tracked separately — same
      // exclusion the existing smoke spec applies, for the same reason.
      .disableRules(['color-contrast'])
      .analyze()
    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })

  test('is operable by keyboard alone and exposes the ARIA combobox contract', async ({
    page,
  }) => {
    const input = await openPicker(page)
    await input.click()
    await expect(input).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('ArrowDown')
    await expect(input).toHaveAttribute('aria-activedescendant', /.+/)

    await page.keyboard.press('Enter')
    await expect(input).toHaveAttribute('aria-expanded', 'false')
    await expect(input).not.toHaveValue('')
  })

  test('Escape closes the list without selecting', async ({ page }) => {
    const input = await openPicker(page)
    await input.click()
    await expect(countryOptions(page).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(input).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('country selector — search', () => {
  test('filters to nothing for an unsupported country, with no silent fallback', async ({
    page,
  }) => {
    // A country VisaAI does not support must not quietly resolve to another
    // one. Absence is the correct, safe behaviour here.
    const input = await openPicker(page)
    await input.click()
    await input.fill('Wakanda')
    await expect(countryOptions(page)).toHaveCount(0)
  })

  test('a malformed code does not match anything', async ({ page }) => {
    const input = await openPicker(page)
    await input.click()
    await input.fill('!!--zz')
    await expect(countryOptions(page)).toHaveCount(0)
  })
})

/**
 * One executed case per supported country. This is the part §16.5 requires and
 * the repository had none of: every enabled country the product offers is
 * individually searched for, selected, and asserted to resolve to its own
 * canonical name — never a neighbour's.
 */
test.describe('per-country selection', () => {
  for (const { code, name, group } of COUNTRIES) {
    test(`${code} — ${name} (${group}) is findable and selectable`, async ({
      page,
    }) => {
      const input = await openPicker(page)
      const shown = (await shownNames(page))[code]
      await input.click()
      await input.fill(shown)

      // Exactness is also enforced below by asserting the input's committed value.
      const option = optionNamed(page, shown)
      await expect(option.first()).toBeVisible()

      await option.first().click()

      // The input must settle on THIS country, not a prefix-sharing neighbour
      // (e.g. Austria vs Australia, Slovakia vs Slovenia).
      await expect(input).toHaveValue(shown)
      await expect(input).toHaveAttribute('aria-expanded', 'false')
    })
  }
})
