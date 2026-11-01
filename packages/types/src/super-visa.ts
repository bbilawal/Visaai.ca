/**
 * Canada's Parent and Grandparent Super Visa — the deterministic checks.
 *
 * Officers decide a super visa on a few numbers: does the host's income (plus
 * a spouse co-signer's) meet the minimum necessary income for the host's
 * family size, and does the private medical insurance meet the published
 * minimum. Those are arithmetic, not judgement, so they are computed here and
 * handed to the letter writer and the readiness score as facts — a model asked
 * to "check LICO" invents a threshold.
 *
 * Sources (registry `ca-super-visa`, IRCC super visa eligibility page):
 *   minimum_necessary_income_table — updated 2025-07-29
 *   co_signer_limited_to_spouse — only the host's spouse or common-law partner
 *   insurance_policy_conditions — ≥ CAD 100,000 emergency cover, valid ≥ 1 year
 *     from entry, paid in full or in instalments with a deposit (no quotes)
 *   stay_five_years_per_entry — up to 5 years per entry
 *
 * Pure and dependency-free: shared by the API and the web app.
 */

/** Registry id (`visa_types.visaai_id`) of the super visa. */
export const SUPER_VISA_ID = 'ca-super-visa'

/** Years a super visa holder may stay per entry (IRCC, since 22 June 2023). */
export const SUPER_VISA_YEARS_PER_ENTRY = 5

/** Minimum emergency medical cover, CAD. */
export const SUPER_VISA_MIN_INSURANCE_CAD = 100_000

/** Minimum policy validity from the date of entry, months. */
export const SUPER_VISA_MIN_INSURANCE_MONTHS = 12

export function isSuperVisaRoute(visaaiId: string | null | undefined): boolean {
  return (visaaiId ?? '').trim() === SUPER_VISA_ID
}

/**
 * IRCC's minimum necessary income table, CAD, by family size (updated
 * 2025-07-29). Same shape as the registry requirement's `parameters`, so a
 * fresher table read from the registry can be passed in its place.
 */
export const MINIMUM_NECESSARY_INCOME_CAD: Readonly<Record<string, number>> = {
  family_of_1_cad: 30526,
  family_of_2_cad: 38002,
  family_of_3_cad: 46720,
  family_of_4_cad: 56724,
  family_of_5_cad: 64336,
  family_of_6_cad: 72560,
  family_of_7_cad: 80784,
  each_additional_member_cad: 8224,
}

export const MINIMUM_NECESSARY_INCOME_UPDATED = '2025-07-29'

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s$]|cad/gi, ''))
    if (v.trim() && Number.isFinite(n)) return n
  }
  return undefined
}

/**
 * The minimum necessary income for a family of `size`, or null when the size
 * is not a positive whole number. `table` overrides the built-in figures key by
 * key (registry parameters).
 */
export function minimumNecessaryIncome(
  size: number,
  table: Readonly<Record<string, unknown>> = {},
): number | null {
  if (!Number.isInteger(size) || size < 1) return null
  const read = (k: string) => num(table[k]) ?? MINIMUM_NECESSARY_INCOME_CAD[k]
  if (size <= 7) return read(`family_of_${size}_cad`) ?? null
  const seven = read('family_of_7_cad')
  const extra = read('each_additional_member_cad')
  if (seven === undefined || extra === undefined) return null
  return seven + (size - 7) * extra
}

function first(p: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = p[k]
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())) return v
  }
  return undefined
}

function yes(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['yes', 'y', 'true'].includes(s)) return true
    if (['no', 'n', 'false', 'none'].includes(s)) return false
  }
  return undefined
}

/** People counted in the host's family size, as listed at intake. */
export function superVisaHousehold(
  p: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const v = first(p, ['host_household_members', 'host_family_members'])
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    : []
}

/** The host's family size: the listed members, else a stated size, else null. */
export function superVisaFamilySize(p: Record<string, unknown>): number | null {
  const listed = superVisaHousehold(p)
  if (listed.length > 0) return listed.length
  const stated = num(first(p, ['host_family_size', 'host_household_size', 'family_size']))
  return stated !== undefined && Number.isInteger(stated) && stated > 0 ? stated : null
}

export interface SuperVisaIncomeCheck {
  familySize: number | null
  /** Minimum necessary income for that size, CAD. */
  required: number | null
  hostIncome: number | null
  /** Counted co-signer income (0 when there is none or it cannot count). */
  coSignerIncome: number
  total: number | null
  taxYear: number | null
  /** null = cannot tell (size or income unknown). */
  meets: boolean | null
  /** A co-signer was named who is not the host's spouse or partner. */
  coSignerIneligible: boolean
}

const SPOUSE = /spouse|wife|husband|partner|common[- ]?law/i

/** Host (+ spouse co-signer) income against the minimum for the family size. */
export function superVisaIncomeCheck(
  p: Record<string, unknown>,
  table?: Readonly<Record<string, unknown>>,
): SuperVisaIncomeCheck {
  const familySize = superVisaFamilySize(p)
  const required = familySize !== null ? minimumNecessaryIncome(familySize, table) : null
  const hostIncome =
    num(
      first(p, [
        'host_annual_income_cad',
        'inviter_annual_income_cad',
        'host_income_cad',
        'host_total_income_cad',
      ]),
    ) ?? null
  const taxYear = num(first(p, ['host_income_tax_year', 'inviter_income_tax_year', 'host_tax_year'])) ?? null

  const hasCoSigner = yes(first(p, ['has_co_signer', 'co_signer', 'has_cosigner'])) === true
  const coIncome =
    num(first(p, ['co_signer_annual_income_cad', 'cosigner_annual_income_cad', 'co_signer_income_cad'])) ?? 0
  const coRelation = String(first(p, ['co_signer_relationship', 'cosigner_relationship']) ?? '')
  // The intake asks only for a spouse co-signer, so an unstated relationship
  // is read as the spouse; a stated non-spouse is not counted.
  const coSignerIneligible = hasCoSigner && coRelation.trim() !== '' && !SPOUSE.test(coRelation)
  const coSignerIncome = hasCoSigner && !coSignerIneligible ? coIncome : 0

  const total = hostIncome !== null ? hostIncome + coSignerIncome : null
  const meets = required !== null && total !== null ? total >= required : null
  return {
    familySize,
    required,
    hostIncome,
    coSignerIncome,
    total,
    taxYear: taxYear !== null && Number.isInteger(taxYear) ? taxYear : null,
    meets,
    coSignerIneligible,
  }
}

export interface SuperVisaInsuranceCheck {
  /** Whether a policy is held; undefined when not answered. */
  has: boolean | undefined
  provider: string | null
  coverageCad: number | null
  months: number | null
  paid: string | null
  /** null = not answered; false = no policy or a stated shortfall. */
  meets: boolean | null
  problems: string[]
}

/** The private medical insurance against the published minimum. */
export function superVisaInsuranceCheck(p: Record<string, unknown>): SuperVisaInsuranceCheck {
  const has = yes(
    first(p, [
      'has_super_visa_insurance',
      'has_travel_medical_insurance',
      'has_medical_insurance',
      'has_health_insurance',
    ]),
  )
  const providerV = first(p, [
    'medical_insurance_provider',
    'insurance_provider',
    'insurance_company',
    'insurer',
    'travel_medical_insurance_provider',
  ])
  const provider = typeof providerV === 'string' ? providerV.trim() : null
  const coverageCad =
    num(
      first(p, [
        'medical_insurance_coverage_cad',
        'insurance_coverage_cad',
        'insurance_coverage_amount',
        'travel_medical_insurance_coverage_cad',
      ]),
    ) ?? null
  const months =
    num(
      first(p, [
        'medical_insurance_months',
        'insurance_duration_months',
        'insurance_validity_months',
        'travel_medical_insurance_duration_months',
      ]),
    ) ?? null
  const paidV = first(p, [
    'medical_insurance_paid',
    'insurance_paid',
    'insurance_paid_in_full',
    'travel_medical_insurance_paid',
  ])
  const paid =
    typeof paidV === 'boolean' ? (paidV ? 'paid' : 'not paid') : typeof paidV === 'string' ? paidV.trim() : null

  const problems: string[] = []
  if (has === false) problems.push('No super visa medical insurance has been bought yet.')
  if (coverageCad !== null && coverageCad < SUPER_VISA_MIN_INSURANCE_CAD)
    problems.push(
      `Emergency cover of CAD ${coverageCad.toLocaleString('en-US')} is below the CAD 100,000 minimum.`,
    )
  if (months !== null && months < SUPER_VISA_MIN_INSURANCE_MONTHS)
    problems.push(`A policy valid ${months} months is shorter than the required 1 year from entry.`)
  if (paid !== null && (/quote/i.test(paid) || /\bnot\b|unpaid/i.test(paid)))
    problems.push('The policy must be paid in full or in instalments with a deposit — a quote is not accepted.')

  const meets = has === undefined && problems.length === 0 ? null : problems.length === 0 && has !== false
  return { has, provider, coverageCad, months, paid, meets, problems }
}
