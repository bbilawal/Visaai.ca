/**
 * Canada study permit: the registry id shared by the API and the web app.
 *
 * WHY THIS EXISTS
 *
 * The study permit program had no registry route (2026-10-20), so every stage
 * treated `ca-study-permit` as a visitor visa: the interview asked for a trip
 * purpose and arrival/departure dates, readiness scored a student as
 * unemployed and weighed funds against a holiday, and the IRCC portal route
 * resolved to tr-rt — Launch would have written IMM 5257 visitor-visa answers,
 * "Visitor visa" included, into a study permit application.
 */

/** Registry visa type (`visa_types.visaai_id`) for Canada's study permit. */
export const CA_STUDY_VISAAI_ID = 'ca-study-permit'

export function isStudyPermitRoute(visaaiId: string | null | undefined): boolean {
  return (visaaiId ?? '').trim() === CA_STUDY_VISAAI_ID
}

/**
 * IRCC's minimum funds for living costs outside Quebec, CAD per year, by
 * family members coming (the applicant included), excluding tuition and
 * transport. Quebec sets its own amounts (MIFI) and is not tabled here.
 * Source (modified 2026-08-28):
 * https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents/financial-support.html
 */
const LIVING_COST_TABLES: readonly { from: string; amounts: readonly number[]; eachExtra: number }[] = [
  { from: '2026-09-01', amounts: [23_448, 29_192, 35_888, 43_572, 49_419, 55_736, 62_054], eachExtra: 6_318 },
  { from: '2025-01-01', amounts: [22_895, 28_502, 35_040, 42_543, 48_252, 54_420, 60_589], eachExtra: 6_170 },
]

/** The living-cost minimum for `members` people applying on `on`, or null before 2025. */
export function studyLivingCostCad(members: number, on: Date = new Date()): number | null {
  if (Number.isNaN(on.getTime())) return null
  const day = on.toISOString().slice(0, 10)
  const t = LIVING_COST_TABLES.find((x) => day >= x.from)
  if (!t || members < 1) return null
  const n = Math.floor(members)
  return n <= 7 ? t.amounts[n - 1] : t.amounts[6] + (n - 7) * t.eachExtra
}

export interface StudyFundsNeed {
  /** Applicant plus the spouse and children coming. */
  familyMembers: number
  /** Living-cost minimum, or null in Quebec (MIFI sets it). */
  livingCad: number | null
  /** First-year tuition not yet paid, or null when the tuition is unknown. */
  tuitionDueCad: number | null
  /** livingCad + tuitionDueCad, or null when either is unknown. */
  totalCad: number | null
  quebec: boolean
}

const cadNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v !== 'string') return null
  const n = Number(v.replace(/[,\s]/g, '').replace(/[^0-9.-]/g, ''))
  return v.trim() && Number.isFinite(n) ? n : null
}
const yes = (v: unknown) => /^\s*(yes|y|true)\b/i.test(String(v ?? ''))
const none = (v: unknown) =>
  /^\s*(\[\s*\]|no\b|none|n\/a|nobody|neither|not\b|false\b)/i.test(String(v ?? ''))

/** The first answered value among a fact's key and its aliases. */
function first(p: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = p[k]
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())) return v
  }
  return undefined
}

/** A child row marked as coming (intake's per-child answer). */
const childComes = (c: unknown) =>
  !!c && typeof c === 'object' &&
  ['coming_to_canada', 'accompanying', 'travelling_with_applicant'].some((k) =>
    yes((c as Record<string, unknown>)[k]),
  )

/** How many children come: the intake answer (a list, a number, names), else the child rows. */
function childrenComing(p: Record<string, unknown>): number {
  const v = p.children_accompanying
  if (v === undefined || v === null || v === '') {
    return Array.isArray(p.children) ? p.children.filter(childComes).length : 0
  }
  if (Array.isArray(v)) return v.length
  if (typeof v === 'number') return Math.max(0, Math.floor(v))
  if (typeof v === 'object') return 1
  const s = String(v).trim()
  if (none(s)) return 0
  const n = /^(\d+)\b/.exec(s)
  if (n) return Number(n[1])
  if (/^both\b/i.test(s)) return 2
  return s.split(/\s*(?:,|;|\band\b)\s*/i).filter(Boolean).length
}

/** What a study permit applicant must show: living costs plus unpaid tuition. */
export function studyFundsNeed(p: Record<string, unknown>, on: Date = new Date()): StudyFundsNeed {
  const province = String(first(p, ['study_province', 'province_of_study', 'school_province']) ?? '').toLowerCase()
  const quebec = /qu[eé]bec|\bqc\b/.test(province)
  const familyMembers =
    1 +
    (yes(first(p, ['spouse_coming_to_canada', 'spouse_accompanying', 'spouse_travelling'])) ? 1 : 0) +
    childrenComing(p)
  const livingCad = quebec ? null : studyLivingCostCad(familyMembers, on)
  // The keys and aliases of the tuition_cad / tuition_paid_cad intake facts.
  const tuition = cadNumber(first(p, ['tuition_cad', 'tuition_fee_cad', 'tuition_fees', 'tuition', 'tuition_amount', 'tuition_cost_cad']))
  const paid = cadNumber(first(p, ['tuition_paid_cad', 'tuition_deposit_cad'])) ?? 0
  const tuitionDueCad = tuition === null ? null : Math.max(0, tuition - paid)
  const totalCad = livingCad === null || tuitionDueCad === null ? null : livingCad + tuitionDueCad
  return { familyMembers, livingCad, tuitionDueCad, totalCad, quebec }
}
