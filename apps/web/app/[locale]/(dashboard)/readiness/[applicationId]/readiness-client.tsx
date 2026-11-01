'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/providers/toast-provider'
import { handlePlanError } from '@/lib/plan-error'
import { getFormHref } from '@/lib/form-link'
import { ExternalLinkIcon } from '@/components/ui/icons'
import { useRequiredDocsReady, MissingDocsPanel } from '@/components/required-docs-gate'

interface VriScore {
  overall_score: number
  documentation_pct: number
  financial_pct: number
  travel_history_pct: number
  home_ties_pct: number
  employment_pct: number
  consistency_pct: number
  /**
   * FAKE-003: factor keys whose input data was absent, so no assessment ran.
   * The `*_pct` columns are `int not null`, so an unassessed factor still
   * stores 0 — and 0 renders as "0% · Weak", a failure the applicant never had.
   * This array is the only truthful signal; render "Not assessed" for anything
   * it names rather than a number nobody measured.
   */
  unassessed_factors: string[] | null
  calculated_at: string
}

interface Recommendation {
  id: string
  factor: string
  issue: string
  recommendation_text: string
  priority: number
}

interface VisaForm {
  form_code: string
  form_name: string
  source_url: string | null
}

interface VisaSuggestion {
  id: string
  country_code: string
  visa_category: string
  approval_likelihood: number
  reasoning: string
  required_forms: VisaForm[]
  required_documents: string[]
  official_source: string | null
  rank: number
}

type T = ReturnType<typeof useTranslations>

function scoreColor(pct: number): string {
  if (pct >= 70) return 'text-success-green'
  if (pct >= 40) return 'text-[#b45309]'
  return 'text-callout-red'
}

// Plain-language band so meaning is never conveyed by color alone (WCAG 1.4.1).
function scoreBand(pct: number, t: T): { label: string; hint: string } {
  if (pct >= 70) return { label: t('bandStrong'), hint: t('bandStrongHint') }
  if (pct >= 40) return { label: t('bandNeedsWork'), hint: t('bandNeedsWorkHint') }
  return { label: t('bandAtRisk'), hint: t('bandAtRiskHint') }
}

function barColor(pct: number): string {
  if (pct >= 70) return 'bg-success-green'
  if (pct >= 40) return 'bg-[#b45309]'
  return 'bg-callout-red'
}

type PlanTier = 'none' | 'self_service' | 'copilot' | 'expert'

export default function ReadinessClient({ applicationId }: { applicationId: string }) {
  const t = useTranslations('readiness')
  const FACTOR_LABELS: Record<string, string> = {
    documentation_pct: t('factorDocumentation'),
    financial_pct: t('factorFinancial'),
    travel_history_pct: t('factorTravelHistory'),
    home_ties_pct: t('factorHomeTies'),
    employment_pct: t('factorEmployment'),
    consistency_pct: t('factorConsistency'),
  }
  const { toast } = useToast()
  const [planTier, setPlanTier] = useState<PlanTier>('none')
  const [score, setScore] = useState<VriScore | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [visaSuggestions, setVisaSuggestions] = useState<VisaSuggestion[]>([])
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [calculating, setCalculating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadTrigger, setLoadTrigger] = useState(0)
  const [showDocsGate, setShowDocsGate] = useState(false)
  const { ready: docsReady, missing: missingDocs } = useRequiredDocsReady(applicationId)

  const isCopilotOrHigher = planTier === 'copilot' || planTier === 'expert'

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { session } } = await getSession()
      if (!session || cancelled) return

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vri/${applicationId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok || cancelled) return

      const data = await res.json() as {
        planTier?: PlanTier
        score: VriScore | null
        recommendations: Recommendation[]
        visaSuggestions?: VisaSuggestion[]
      }
      if (!cancelled) {
        setPlanTier(data.planTier ?? 'none')
        setScore(data.score)
        setRecommendations(data.recommendations)
        setVisaSuggestions(data.visaSuggestions ?? [])
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [applicationId, loadTrigger])

  async function handleCalculate() {
    if (!docsReady) {
      setShowDocsGate(true)
      toast(t('uploadDocsFirst'), 'error')
      return
    }
    setCalculating(true)
    setError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vri/${applicationId}/calculate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (await handlePlanError(res, applicationId, toast)) return
      if (!res.ok) throw new Error(t('errCalculate'))
      toast(t('vriCalculated'), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errCalculate')
      setError(msg)
      toast(msg, 'error')
    } finally {
      setCalculating(false)
    }
  }

  async function handleApplySuggestion(suggestion: VisaSuggestion) {
    setApplyingId(suggestion.id)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/vri/${applicationId}/apply-suggestion/${suggestion.id}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      )
      if (await handlePlanError(res, applicationId, toast)) return
      if (!res.ok) throw new Error(t('errApply'))
      const data = await res.json() as { added: number; skipped: number }
      setAppliedIds(prev => new Set(prev).add(suggestion.id))
      const msg = data.added > 0
        ? t('applyAdded', { added: data.added })
        : t('applyAllPresent')
      toast(msg, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : t('errApply'), 'error')
    } finally {
      setApplyingId(null)
    }
  }

  // Tolerates the column being absent (older rows, or a database where the
  // migration has not landed yet): no array means nothing is flagged unassessed.
  const unassessed = new Set<string>(score?.unassessed_factors ?? [])

  const factorKeys: (keyof VriScore)[] = [
    'documentation_pct', 'financial_pct', 'home_ties_pct',
    'consistency_pct', 'employment_pct', 'travel_history_pct',
  ]

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold tracking-[-0.45px] text-deep-black">
            {t('title')}
          </h1>
          <p className="text-[14px] text-midtone-gray mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        {score && (
          <Button onClick={handleCalculate} disabled={calculating || loading}>
            {calculating ? t('calculating') : t('recalculate')}
          </Button>
        )}
      </div>

      {showDocsGate && !docsReady && (
        <MissingDocsPanel applicationId={applicationId} missing={missingDocs} />
      )}

      {error && (
        <p className="mb-4 text-[13px] text-callout-red" role="alert">{error}</p>
      )}

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-canvas-white rounded-[14px] p-4 flex flex-col items-center justify-center py-8" style={{ boxShadow: 'var(--shadow-card)' }}>
            <Skeleton className="h-12 w-16 mb-2" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="col-span-2 bg-canvas-white rounded-[14px] p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
            <Skeleton className="h-4 w-36 mb-4" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mb-3">
                <div className="flex justify-between mb-1">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : !score ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[14px] text-midtone-gray mb-2">{t('noScore')}</p>
          <p className="text-[12px] text-midtone-gray mb-4">
            {t('noScoreHint')}
          </p>
          <Button onClick={handleCalculate} disabled={calculating}>
            {calculating ? t('calculating') : t('calculateCta')}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="flex flex-col items-center justify-center py-8 text-center">
            <div className={`text-[48px] font-semibold leading-[1] tracking-[-2.4px] ${scoreColor(score.overall_score)}`}>
              {score.overall_score}
            </div>
            <p className="text-[12px] text-midtone-gray mt-1">{t('overallLabel')}</p>
            <p className={`text-[13px] font-medium mt-2 ${scoreColor(score.overall_score)}`}>
              {scoreBand(score.overall_score, t).label}
            </p>
            <p className="text-[12px] text-midtone-gray mt-1 max-w-[28ch]">
              {scoreBand(score.overall_score, t).hint}
            </p>
            <p className="text-[11px] text-midtone-gray mt-2">
              {new Date(score.calculated_at).toLocaleString()}
            </p>
          </Card>

          <Card className="md:col-span-2">
            <p className="text-[14px] font-medium text-deep-black mb-3">{t('factorBreakdown')}</p>
            <div className="flex flex-col gap-3">
              {factorKeys.map(key => {
                const pct = score[key] as number
                // FAKE-003: a factor with no input data was never scored. Its
                // stored 0 is a placeholder, not a result — say so rather than
                // showing the applicant a failing bar they did not earn.
                const notAssessed = unassessed.has(key as string)
                if (notAssessed) {
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] text-rich-black">{FACTOR_LABELS[key]}</span>
                        <span className="text-[13px] font-medium text-midtone-gray">
                          {t('factorNotAssessed')}
                        </span>
                      </div>
                      <div
                        className="h-1.5 bg-ghost-gray rounded-full overflow-hidden"
                        role="img"
                        aria-label={`${FACTOR_LABELS[key]}: ${t('factorNotAssessed')}`}
                      />
                    </div>
                  )
                }
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] text-rich-black">{FACTOR_LABELS[key]}</span>
                      <span className={`text-[13px] font-medium ${scoreColor(pct)}`}>
                        {pct}% · {scoreBand(pct, t).label}
                      </span>
                    </div>
                    <div className="h-1.5 bg-ghost-gray rounded-full overflow-hidden" role="img" aria-label={`${FACTOR_LABELS[key]}: ${pct} percent, ${scoreBand(pct, t).label}`}>
                      <div
                        className={`h-full transition-all ${barColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {!isCopilotOrHigher && (
            <Card className="col-span-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[14px] font-medium text-deep-black">
                    Unlock AI recommendations &amp; visa suggestions
                  </p>
                  <p className="text-[13px] text-midtone-gray mt-1">
                    Your <span className="font-medium">Self-Service</span> plan includes the overall
                    score and dimension breakdown. Upgrade to <span className="font-medium">Copilot</span> to
                    see visa categories ranked by how well they match your profile, the exact
                    required forms and documents for each, and AI recommendations that tell you how
                    to lift each dimension score.
                  </p>
                </div>
                <a href={`/billing?applicationId=${applicationId}&required=copilot`}>
                  <Button>Upgrade to Copilot — $30</Button>
                </a>
              </div>
            </Card>
          )}

          {recommendations.length > 0 && (
            <Card className="col-span-3">
              <p className="text-[14px] font-medium text-deep-black mb-3">
                {t('recommendationsTitle')}
              </p>
              <div className="flex flex-col gap-3">
                {recommendations.map(rec => (
                  <div key={rec.id} className="pb-3 border-b border-subtle-ash last:border-0">
                    <p className="text-[13px] font-medium text-rich-black">
                      {FACTOR_LABELS[rec.factor] ?? rec.factor}
                    </p>
                    <p className="text-[13px] text-midtone-gray mt-0.5">{rec.issue}</p>
                    <p className="text-[13px] text-rich-black mt-1">{rec.recommendation_text}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {visaSuggestions.length > 0 && (
            <Card className="col-span-3">
              <div className="mb-3">
                <p className="text-[14px] font-medium text-deep-black">
                  {t('bestFitTitle', { country: visaSuggestions[0]?.country_code ?? '' })}
                </p>
                <p className="text-[13px] text-midtone-gray mt-0.5">
                  {t('bestFitIntro', { country: visaSuggestions[0]?.country_code ?? '' })}
                </p>
              </div>
              {/*
                The page renders a percentage next to each visa category. Without
                this line a reader has no way to know it is a fit score against
                their own answers rather than a probability of approval — and
                VisaAI can neither predict nor influence a government decision.
              */}
              <p className="text-[13px] text-midtone-gray mb-4">{t('scoreDisclaimer')}</p>
              <div className="flex flex-col gap-4">
                {visaSuggestions.map(s => (
                  <div key={s.id} className="pb-4 border-b border-subtle-ash last:border-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <p className="text-[14px] font-medium text-rich-black">{s.visa_category}</p>
                      <span className={`text-[13px] font-medium ${scoreColor(s.approval_likelihood)}`}>
                        {t('matchPct', { pct: s.approval_likelihood })}
                      </span>
                    </div>
                    <div className="h-1.5 bg-ghost-gray rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full transition-all ${barColor(s.approval_likelihood)}`}
                        style={{ width: `${s.approval_likelihood}%` }}
                      />
                    </div>
                    <p className="text-[13px] text-rich-black mb-2">{s.reasoning}</p>
                    {(s.required_forms?.length ?? 0) > 0 && (
                      <div className="mt-2">
                        <p className="text-[12px] font-medium text-deep-black mb-1">
                          {t('requiredFormsOfficial')}
                        </p>
                        <div className="flex flex-col gap-2">
                          {s.required_forms.map((form, i) => {
                            const { href, isFallback } = getFormHref({
                              source_url: form.source_url,
                              form_code: form.form_code,
                              form_name: form.form_name,
                              country: s.country_code,
                            })
                            const label = form.form_name && form.form_name !== form.form_code
                              ? `${form.form_code} — ${form.form_name}`
                              : form.form_code
                            return (
                              <a
                                key={i}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={isFallback ? 'Search the official site for this form' : 'Open the official form'}
                                className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-[#1d4ed8] hover:text-[#1e40af] underline underline-offset-2 decoration-[#1d4ed8]/40 hover:decoration-[#1e40af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8]/30 rounded-sm"
                              >
                                <ExternalLinkIcon size={13} />
                                {label}
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {s.required_documents.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[12px] font-medium text-deep-black mb-1">
                          {t('supportingDocsOfficial')}
                        </p>
                        <ul className="list-disc ps-5 text-[13px] text-rich-black flex flex-col gap-0.5">
                          {s.required_documents.map((doc, i) => (
                            <li key={i}>{doc}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {s.official_source && (
                      <p className="text-[12px] text-midtone-gray mt-2">
                        {t('sourceLabel')}{' '}
                        {/^https?:\/\//i.test(s.official_source) ? (
                          <a
                            href={s.official_source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-deep-black underline underline-offset-2 decoration-deep-black/40 hover:decoration-deep-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black/15 rounded-sm"
                          >
                            {s.official_source}
                            <ExternalLinkIcon className="opacity-70" />
                          </a>
                        ) : (
                          s.official_source
                        )}
                      </p>
                    )}
                    {(s.required_documents.length > 0 || (s.required_forms?.length ?? 0) > 0) && (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          onClick={() => handleApplySuggestion(s)}
                          disabled={applyingId === s.id || appliedIds.has(s.id)}
                        >
                          {appliedIds.has(s.id)
                            ? t('addedToChecklist')
                            : applyingId === s.id
                              ? t('adding')
                              : t('useTheseForms')}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="col-span-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[14px] font-medium text-deep-black">AI Prefilled Application Form</p>
                <p className="text-[13px] text-midtone-gray mt-0.5">
                  VisaAI scans your documents and drafts every field of the official form. Review the
                  values, download the summary PDF or — where supported — the actual government form
                  (e.g. IMM 5257) with values stamped in. Included with your plan.
                </p>
              </div>
              <a href={`/prefill/${applicationId}`}>
                <Button>Generate prefilled form</Button>
              </a>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
