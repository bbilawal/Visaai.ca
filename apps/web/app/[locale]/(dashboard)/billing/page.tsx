'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { createClient, getSession } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { PlanTier } from '@visaai/types'

interface ApplicationOption {
  id: string
  status: string
  created_at: string
}

export default function BillingPage() {
  const t = useTranslations('billing')
  const ts = useTranslations('status')
  const plans = [
    {
      tier: 'self_service' as const,
      name: t('planSelfService'),
      price: '$10',
      features: [t('featAiIntake'), t('featChecklist'), t('featReadiness'), t('featVault')],
    },
    {
      tier: 'copilot' as const,
      name: t('planCopilot'),
      price: '$30',
      features: [t('featEverythingSelf'), t('featOcr'), t('featCrossDoc'), t('featLetters'), t('featPortalFill')],
      popular: true,
    },
    {
      tier: 'expert' as const,
      name: t('planExpert'),
      // Display only — the charged amount is server-resolved from PLAN_PRICES
      // (billing.service.ts). Keep the two in step.
      price: '$250',
      features: [t('featEverythingCopilot'), t('featConsultantReview'), t('featCompliance'), t('featFinalAssessment')],
    },
  ]
  const searchParams = useSearchParams()
  const requestedAppId = searchParams.get('applicationId')
  const requiredTier = searchParams.get('required') as Exclude<PlanTier, 'none'> | null

  const [applications, setApplications] = useState<ApplicationOption[]>([])
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [loadingApps, setLoadingApps] = useState(true)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadApplications() {
      const supabase = createClient()
      const { data } = await supabase
        .from('applications')
        .select('id, status, created_at')
        .order('created_at', { ascending: false })

      const apps = (data ?? []) as ApplicationOption[]
      setApplications(apps)
      if (requestedAppId && apps.some(a => a.id === requestedAppId)) {
        setSelectedAppId(requestedAppId)
      } else if (apps.length === 1) {
        setSelectedAppId(apps[0].id)
      }
      setLoadingApps(false)
    }
    loadApplications()
  }, [requestedAppId])

  async function handleUpgrade(planTier: Exclude<PlanTier, 'none'>) {
    if (!selectedAppId) {
      setError(t('errSelectApp'))
      return
    }
    setLoading(planTier)
    setError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) return

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          applicationId: selectedAppId,
          planTier,
          successUrl: `${window.location.origin}/`,
          cancelUrl: `${window.location.origin}/billing`,
        }),
      })

      if (!res.ok) {
        // Surface enough to diagnose without a server log: the API returns a
        // JSON envelope ({ error, message }) and an x-request-id header that
        // correlates with the api logs.
        const requestId = res.headers.get('x-request-id')
        let detail = ''
        try {
          const body = await res.json() as { message?: string; error?: string }
          detail = body.message ?? body.error ?? ''
        } catch {
          detail = ''
        }
        console.error('[billing] checkout request failed', {
          status: res.status,
          requestId,
          detail,
          planTier,
        })
        setLoading(null)
        setError(
          `${t('errCheckoutCreate')} (${res.status}${requestId ? ` · ${requestId}` : ''})`,
        )
        return
      }

      const { url } = await res.json() as { url: string }
      window.location.assign(url)
    } catch (err) {
      console.error('[billing] checkout request threw', err)
      setLoading(null)
      setError(t('errCheckoutStart'))
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[18px] font-semibold tracking-[-0.45px] text-deep-black">
          {t('title')}
        </h1>
        <p className="text-[14px] text-midtone-gray mt-0.5">
          {t('subtitle')}
        </p>
      </div>

      {requiredTier && (
        <Card className="mb-4" role="alert">
          <p className="text-[14px] font-medium text-deep-black">
            {t('requiredTitle')}
          </p>
          <p className="text-[13px] text-midtone-gray mt-0.5">
            {t('requiredBody', {
              plan: plans.find(p => p.tier === requiredTier)?.name ?? requiredTier,
              price: plans.find(p => p.tier === requiredTier)?.price ?? '',
            })}
          </p>
        </Card>
      )}

      {error && (
        <p className="mb-4 text-[13px] text-callout-red" role="alert">{error}</p>
      )}

      {/* Application selector */}
      {loadingApps ? (
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full max-w-[360px]" />
        </div>
      ) : applications.length === 0 ? (
        <Card className="mb-6 max-w-[480px]">
          <p className="text-[14px] text-midtone-gray">
            {t('noApps')}{' '}
            <Link href="/applications/new" className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm">
              {t('createOne')}
            </Link>
          </p>
        </Card>
      ) : applications.length > 1 ? (
        <div className="mb-6 max-w-[360px]">
          <label
            htmlFor="app-select"
            className="block text-[12px] font-medium text-rich-black mb-1"
          >
            {t('selectApp')}
          </label>
          <select
            id="app-select"
            value={selectedAppId ?? ''}
            onChange={e => setSelectedAppId(e.target.value || null)}
            className="w-full border border-subtle-ash rounded-[10px] text-[14px] text-rich-black bg-canvas-white px-[10px] py-2 focus:outline-none focus-visible:border-rich-black focus-visible:ring-2 focus-visible:ring-deep-black/15 transition-[border-color,box-shadow]"
          >
            <option value="">{t('chooseApp')}</option>
            {applications.map(app => (
              <option key={app.id} value={app.id}>
                Canada — TRV · {ts.has(app.status) ? ts(app.status) : app.status} · {new Date(app.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="mb-6">
          <p className="text-[12px] text-midtone-gray">
            {t('upgradingApp', { date: new Date(applications[0].created_at).toLocaleDateString() })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {plans.map(plan => (
          <Card key={plan.tier}>
            <CardHeader>
              <div className="flex items-center justify-between mb-1">
                <CardTitle>{plan.name}</CardTitle>
                {plan.popular && <Badge variant="inverse">{t('popular')}</Badge>}
              </div>
              <p className="text-[24px] font-semibold text-deep-black mt-2">{plan.price}</p>
              <p className="text-[12px] text-midtone-gray">{t('perApplication')}</p>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5 mb-4">
                {plan.features.map(f => (
                  <li key={f} className="text-[13px] text-rich-black flex items-start gap-2">
                    <span className="text-success-green mt-0.5 shrink-0">&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                disabled={loading === plan.tier || loadingApps || applications.length === 0}
                onClick={() => handleUpgrade(plan.tier)}
              >
                {loading === plan.tier ? t('redirecting') : t('getPlan', { plan: plan.name })}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
