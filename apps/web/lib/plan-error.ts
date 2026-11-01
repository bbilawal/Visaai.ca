import { PLAN_PRICE_CENTS, planLabelWithPrice, type PlanTier } from '@visaai/types'

export type RequiredTier = Exclude<PlanTier, 'none'>

/**
 * Derived from the shared price catalog, never re-typed. This map used to hold
 * its own literals and said "Expert Review ($100)" while the server charged
 * $250 — the user was quoted the wrong price on every gated 403.
 */
const TIER_LABELS: Record<RequiredTier, string> = {
  self_service: planLabelWithPrice('self_service'),
  copilot: planLabelWithPrice('copilot'),
  expert: planLabelWithPrice('expert'),
}

export interface PlanError {
  requiredPlan: RequiredTier
  message: string
}

export async function parsePlanError(res: Response): Promise<PlanError | null> {
  if (res.status !== 403) return null
  try {
    const body = (await res.clone().json()) as { message?: string }
    const match = body?.message?.match(/Plan '([a-z_]+)' required/)
    const tier = match?.[1] as RequiredTier | undefined
    if (tier && tier in PLAN_PRICE_CENTS) {
      return { requiredPlan: tier, message: body.message ?? '' }
    }
  } catch {
    // Non-JSON 403 — not a plan error
  }
  return null
}

export function planErrorToast(err: PlanError): string {
  return `Get a plan first — this needs ${TIER_LABELS[err.requiredPlan]}. Redirecting to billing…`
}

export function billingUrlFor(applicationId: string, requiredPlan: RequiredTier): string {
  return `/billing?applicationId=${encodeURIComponent(applicationId)}&required=${requiredPlan}`
}

/**
 * Handle a fetch Response on a gated action. If it's a 403 plan error, show a
 * toast and redirect to billing, then return true so the caller can bail.
 */
export async function handlePlanError(
  res: Response,
  applicationId: string,
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void,
): Promise<boolean> {
  const err = await parsePlanError(res)
  if (!err) return false
  toast(planErrorToast(err), 'error')
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      window.location.assign(billingUrlFor(applicationId, err.requiredPlan))
    }, 1200)
  }
  return true
}
