'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/providers/toast-provider'
import { handlePlanError } from '@/lib/plan-error'
import { handlePaymentRequired } from '@/lib/payment-error'
import { CA_ETA_VISAAI_ID, CA_SPOUSAL_VISAAI_ID, formatPrefillPrice, routeHasPortalFill } from '@visaai/types'
import { OWNER_HEADINGS } from '@/lib/checklist-grouping'
import { useRequiredDocsReady, MissingDocsPanel } from '@/components/required-docs-gate'
import { docsGateItemsText } from '@/lib/required-docs'
import { CountryFlag } from '@/components/ui/country-flag'
import { OfficialForms } from '@/components/forms/official-forms'
import { prefillHeaderParts } from '@/lib/prefill-header'
import { savePrefillFields } from '@/lib/prefill-save'

interface PrefilledFormField {
  key: string
  label: string
  value: string
  group?: string
  source?: 'profile' | 'document' | 'inferred' | 'consultant' | 'applicant'
  note?: string
  needsReview?: boolean
}

interface PrefilledFormPayload {
  visaType: string
  countryCode: string
  purpose: string
  generatedAt: string
  fields: PrefilledFormField[]
}

interface PrefillResponse {
  payload: PrefilledFormPayload | null
  generatedDocumentId: string | null
  /** Version token of the stored form; sent back with every save. */
  version?: string | null
  approved?: boolean
  paid: boolean
}

interface OfficialForm {
  form_code: string
  form_name: string
  owner?: 'applicant' | 'sponsor'
  official_supported: boolean
  /** Set for forms VisaAI prepares from the application (IMM 5476). */
  prepared_note?: string | null
}

export default function PrefillClient({
  applicationId,
  visaaiId = null,
}: {
  applicationId: string
  /** The application's `visa_types.visaai_id`; decides the form fee shown. */
  visaaiId?: string | null
}) {
  // Same table the API charges from, so the number shown is the number billed.
  const formFee = formatPrefillPrice(visaaiId)
  const isEta = visaaiId === CA_ETA_VISAAI_ID
  // No Portal Assistant fill for this route yet (Submit shows the manual
  // route), so the page must not promise one.
  const portalFill = routeHasPortalFill(visaaiId)
  const { toast } = useToast()
  const t = useTranslations('prefill')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

  const [payload, setPayload] = useState<PrefilledFormPayload | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadingOfficial, setDownloadingOfficial] = useState<string | null>(null)
  const [officialForms, setOfficialForms] = useState<OfficialForm[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showDocsGate, setShowDocsGate] = useState(false)
  const { ready: docsReady, missing: missingDocs } = useRequiredDocsReady(applicationId)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { session } } = await getSession()
      if (!session || cancelled) return
      const res = await fetch(`${apiUrl}/prefill/${applicationId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (cancelled) return
      if (res.ok) {
        const data = await res.json() as PrefillResponse
        setPayload(data.payload)
        setVersion(data.version ?? null)
        setPaid(data.paid)
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [apiUrl, applicationId])

  // Pull the list of official forms (and which ones VisaAI can stamp) so we
  // can show a download button per form.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { session } } = await getSession()
      if (!session || cancelled) return
      const res = await fetch(`${apiUrl}/prefill/${applicationId}/official-forms`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok || cancelled) return
      const data = await res.json() as { forms: OfficialForm[] }
      if (!cancelled) setOfficialForms(data.forms)
    }
    void load()
    return () => { cancelled = true }
  }, [apiUrl, applicationId])

  // Returning from Stripe checkout (?paid=1): the webhook records the payment
  // server-side, so refetch the real paid status (retry briefly in case the
  // webhook is a beat behind), then drop the param to keep the URL clean.
  useEffect(() => {
    if (searchParams.get('paid') !== '1') return
    let cancelled = false
    async function confirm() {
      const { data: { session } } = await getSession()
      if (!session) return
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        const res = await fetch(`${apiUrl}/prefill/${applicationId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          const data = await res.json() as PrefillResponse
          if (data.paid) {
            if (!cancelled) {
              setPaid(true)
              setPayload(data.payload)
              setVersion(data.version ?? null)
              toast(t('toastPaymentConfirmed'), 'success')
            }
            break
          }
        }
        await new Promise(r => setTimeout(r, 1500))
      }
      if (!cancelled) router.replace(`/prefill/${applicationId}`)
    }
    void confirm()
    return () => { cancelled = true }
  }, [searchParams, applicationId, router, apiUrl, toast])

  async function withAuth(): Promise<string | null> {
    const { data: { session } } = await getSession()
    return session?.access_token ?? null
  }

  async function handleGenerate() {
    if (!docsReady) {
      // Say WHY, every time. The bare "upload first" toast plus a panel at the
      // top of the page read as "the button does nothing" when the click came
      // from the Generate button further down (dry run 2026-10-14).
      setShowDocsGate(true)
      toast(
        missingDocs.length > 0
          ? t('toastDocsFirstList', { items: docsGateItemsText(missingDocs) })
          : t('toastDocsFirst'),
        'error',
      )
      requestAnimationFrame(() => {
        document
          .getElementById('missing-docs-panel')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const token = await withAuth()
      if (!token) throw new Error('Not authenticated')
      const res = await fetch(`${apiUrl}/prefill/${applicationId}/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (await handlePlanError(res, applicationId, toast)) return
      if (!res.ok) throw new Error('Failed to generate prefilled form')
      const data = await res.json() as PrefillResponse
      setPayload(data.payload)
      setVersion(data.version ?? null)
      setPaid(data.paid)
      toast(t('toastDrafted'), 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate'
      setError(msg)
      toast(msg, 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave() {
    if (!payload) return
    setSaving(true)
    try {
      const token = await withAuth()
      if (!token) throw new Error('Not authenticated')
      const out = await savePrefillFields<PrefilledFormPayload>(
        apiUrl, token, applicationId, payload.fields, version,
      )
      if (out.kind === 'conflict') {
        // The form moved on (e.g. the consultant corrected a value). Do not
        // overwrite it: reload the latest copy and let the applicant redo
        // their change on top of it.
        toast(out.message, 'error')
        const res = await fetch(`${apiUrl}/prefill/${applicationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json() as PrefillResponse
          setPayload(data.payload)
          setVersion(data.version ?? null)
        }
        return
      }
      setPayload(out.payload)
      setVersion(out.version)
      toast(t('toastSaved'), 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save'
      toast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      const token = await withAuth()
      if (!token) throw new Error('Not authenticated')
      const res = await fetch(`${apiUrl}/prefill/${applicationId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (await handlePaymentRequired(res, applicationId, toast)) return
      if (!res.ok) throw new Error('Failed to download PDF')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `visaai-prefilled-${applicationId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to download'
      toast(msg, 'error')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDownloadOfficial(form: OfficialForm) {
    setDownloadingOfficial(form.form_code)
    try {
      const token = await withAuth()
      if (!token) throw new Error('Not authenticated')
      const res = await fetch(
        `${apiUrl}/prefill/${applicationId}/official-pdf/${encodeURIComponent(form.form_code)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (await handlePaymentRequired(res, applicationId, toast)) return
      if (res.status === 503) {
        toast(`Official ${form.form_code} template isn't reachable right now — downloaded the formatted summary instead.`, 'info')
        await handleDownload()
        return
      }
      if (res.status === 404 && form.prepared_note) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(body?.message ?? `${form.form_code} is not needed for this application`)
      }
      if (!res.ok) throw new Error('Failed to download official form')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `visaai-${form.form_code.replace(/\s+/g, '_')}-${applicationId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast(
        form.prepared_note
          ? `${form.form_code} answers downloaded — copy them onto the official form, then follow the steps under the form.`
          : `${form.form_code} downloaded — verify every value before submission.`,
        'success',
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to download', 'error')
    } finally {
      setDownloadingOfficial(null)
    }
  }

  async function handleUnlock() {
    try {
      const token = await withAuth()
      if (!token) throw new Error('Not authenticated')
      const base = window.location.origin
      const res = await fetch(`${apiUrl}/billing/checkout/prefill`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId,
          successUrl: `${base}/prefill/${applicationId}?paid=1`,
          cancelUrl: `${base}/prefill/${applicationId}`,
        }),
      })
      if (!res.ok) {
        // Same failure mode as the billing page: a hardcoded message here threw
        // away the status and the x-request-id that correlates with the api log,
        // turning a config error into an untraceable client-side one.
        const requestId = res.headers.get('x-request-id')
        let detail = ''
        try {
          const body = await res.json() as { message?: string; error?: string }
          detail = body.message ?? body.error ?? ''
        } catch {
          detail = ''
        }
        console.error('[prefill] checkout request failed', {
          status: res.status,
          requestId,
          detail,
          applicationId,
        })
        toast(
          `Failed to start checkout (${res.status}${requestId ? ` · ${requestId}` : ''})`,
          'error',
        )
        return
      }
      const { url } = await res.json() as { url: string }
      window.location.assign(url)
    } catch (err) {
      console.error('[prefill] checkout request threw', err)
      toast(err instanceof Error ? err.message : 'Failed to start checkout', 'error')
    }
  }

  function updateFieldValue(index: number, value: string) {
    if (!payload) return
    const next = [...payload.fields]
    next[index] = { ...next[index], value }
    setPayload({ ...payload, fields: next })
  }

  const officialByOwner = useMemo(() => {
    const owners: Array<'applicant' | 'sponsor'> = ['applicant', 'sponsor']
    return owners
      .map(owner => ({
        owner,
        heading: OWNER_HEADINGS[owner],
        forms: officialForms.filter(f => (f.owner ?? 'applicant') === owner),
      }))
      .filter(g => g.forms.length > 0)
  }, [officialForms])

  const grouped = useMemo(() => {
    if (!payload) return [] as [string, { field: PrefilledFormField; index: number }[]][]
    const map = new Map<string, { field: PrefilledFormField; index: number }[]>()
    payload.fields.forEach((field, index) => {
      const g = field.group || 'Other'
      const list = map.get(g) ?? []
      list.push({ field, index })
      map.set(g, list)
    })
    return Array.from(map.entries())
  }, [payload])

  if (loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

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
        {payload && (
          <div className="flex items-center gap-2">
            <Badge variant={paid ? 'inverse' : 'neutral'}>
              {paid ? t('unlocked') : t('previewLocked')}
            </Badge>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? t('regenerating') : t('regenerate')}
            </Button>
          </div>
        )}
      </div>

      {/* Auto-fill explainer — forms draft themselves once docs are verified. */}
      <Card variant="tight" className="mb-4">
        <p className="text-[13px] text-rich-black">
          <span className="font-medium">These forms auto-complete once every required document is uploaded and verified.</span>{' '}
          {portalFill ? (
            <>
              Previewing and editing the values is free. Downloading the filled forms or letting VisaAI auto-submit them on the
              official portal needs a one-time fee per visa.
            </>
          ) : (
            <>Previewing and editing the values is free. Downloading the filled forms needs a one-time fee per visa.</>
          )}
        </p>
      </Card>

      {showDocsGate && !docsReady && (
        <MissingDocsPanel applicationId={applicationId} missing={missingDocs} />
      )}

      {error && <p className="mb-4 text-[13px] text-callout-red" role="alert">{error}</p>}

      {payload && !paid && (
        <Card className="mb-4 border border-deep-black">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-[14px] font-medium text-deep-black">
                {portalFill ? <>Unlock downloads &amp; auto-submit</> : 'Unlock downloads'}
              </p>
              <p className="text-[13px] text-midtone-gray mt-0.5">
                {portalFill ? (
                  <>
                    One-time {formFee} for this visa. Download the filled PDF and the official government forms, and let VisaAI
                    auto-fill them on the immigration portal.
                  </>
                ) : (
                  <>One-time {formFee} for this visa. Download the filled PDF of these answers.</>
                )}
              </p>
              {isEta && (
                <p className="text-[13px] text-midtone-gray mt-0.5">
                  IRCC&apos;s own CAD $7 eTA fee is separate — you pay it on the IRCC site.
                </p>
              )}
            </div>
            <Button onClick={handleUnlock} size="lg" className="shrink-0">Unlock — {formFee}</Button>
          </div>
        </Card>
      )}

      {!payload ? (
        <>
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[14px] text-rich-black mb-1">{t('noFormYet')}</p>
            <p className="text-[13px] text-midtone-gray mb-5 max-w-md">
              {t(portalFill ? 'emptyExplainer' : 'emptyExplainerManual')}
            </p>
            <Button onClick={handleGenerate} disabled={generating} size="lg">
              {generating ? t('generating') : t('generate')}
            </Button>
          </Card>

          {/* The blank government forms for the visa type this application is
              for, under the Generate button.
              
              Drafting is not the only reason someone opens this stage. Until
              this was here the empty state offered exactly one thing to do —
              press Generate — and an applicant who wanted to see WHICH forms
              their route needs, or to fill one in by hand, had nothing. The
              list is free and needs no draft: these are public government
              blanks, and the fee is for the FILLED copies. */}
          <div className="mt-4">
            <OfficialForms applicationId={applicationId} enabled />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] text-midtone-gray">{t('application')}</p>
                <p className="text-[14px] font-medium text-deep-black inline-flex items-center gap-2">
                  {/* Decorative: the country code is the visible text. */}
                  {payload.countryCode && (
                    <CountryFlag code={payload.countryCode} size="sm" />
                  )}
                  <span>{prefillHeaderParts(payload, locale).join(' · ')}</span>
                </p>
                <p className="text-[12px] text-midtone-gray mt-1">
                  {t('draftedMeta', {
                    date: new Date(payload.generatedAt).toLocaleString(),
                    count: payload.fields.length,
                  })}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? t('saving') : t('saveEdits')}
                </Button>
                <Button onClick={paid ? handleDownload : handleUnlock} disabled={downloading}>
                  {downloading ? t('preparing') : paid ? t('downloadSummary') : `Unlock to download — ${formFee}`}
                </Button>
              </div>
            </div>
          </Card>

          {officialByOwner.length > 0 && (
            <Card>
              <p className="text-[14px] font-medium text-deep-black mb-1">{t('officialFormsHeading')}</p>
              <p className="text-[13px] text-midtone-gray mb-3">
                VisaAI stamps your values onto the real blank from the immigration authority, split by who files it.
                Always verify every value before submitting.{!paid && ' Downloads unlock with the one-time fee.'}
              </p>
              <div className="flex flex-col gap-4">
                {officialByOwner.map(group => (
                  <div key={group.owner}>
                    {officialByOwner.length > 1 && (
                      <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-midtone-gray mb-2">
                        {group.heading}
                      </p>
                    )}
                    <div className="flex flex-col gap-2">
                      {group.forms.map(form => (
                        <div
                          key={`${group.owner}-${form.form_code}`}
                          className="border border-subtle-ash rounded-[10px] px-3 py-2 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-rich-black">
                              {form.prepared_note ? `${form.form_code} — pre-filled, print and sign` : form.form_code}
                            </p>
                            {form.form_name && form.form_name !== form.form_code && (
                              <p className="text-[12px] text-midtone-gray truncate">{form.form_name}</p>
                            )}
                            {form.prepared_note && (
                              <p className="text-[11px] text-midtone-gray mt-1">{form.prepared_note}</p>
                            )}
                          </div>
                          {form.official_supported ? (
                            <Button
                              size="sm"
                              onClick={() => handleDownloadOfficial(form)}
                              disabled={downloadingOfficial === form.form_code}
                            >
                              {downloadingOfficial === form.form_code
                                ? t('preparing')
                                : paid ? t('downloadForm', { code: form.form_code }) : `Unlock ${form.form_code}`}
                            </Button>
                          ) : (
                            <span className="text-[11px] text-midtone-gray">{t('officialComingSoon')}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="flex flex-col gap-4">
            {grouped.map(([group, items]) => (
              <Card key={group}>
                <p className="text-[14px] font-medium text-deep-black mb-3">{group}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map(({ field, index }) => (
                    <div key={`${field.key}-${index}`} className="flex flex-col gap-1">
                      <label className="text-[12px] text-midtone-gray flex items-center gap-1.5">
                        <span>{field.label}</span>
                        {field.source && (
                          <span className="text-[10px] uppercase tracking-wide text-midtone-gray">
                            · {field.source}
                          </span>
                        )}
                      </label>
                      <input
                        value={field.value}
                        onChange={(e) => updateFieldValue(index, e.target.value)}
                        placeholder="—"
                        className="border border-subtle-ash rounded-[10px] text-[14px] text-rich-black bg-canvas-white px-[10px] py-2 focus:outline-none focus-visible:border-rich-black focus-visible:ring-2 focus-visible:ring-deep-black/15 transition-[border-color,box-shadow]"
                      />
                      {field.note && (
                        <p className={`text-[11px] ${field.needsReview ? 'text-rose' : 'text-midtone-gray'}`}>
                          {field.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <Card variant="tight">
            <p className="text-[13px] text-rich-black mb-2 font-medium">{t('readyTitle')}</p>
            <p className="text-[13px] text-midtone-gray mb-3">
              {portalFill ? t('readyBody') : t(visaaiId === CA_SPOUSAL_VISAAI_ID ? 'readyBodyManualSpousal' : 'readyBodyManual')}
            </p>
            <Link href={`/submission/${applicationId}`} className="text-[13px] text-rich-black underline">
              {t('goToSubmit')}
            </Link>
          </Card>
        </div>
      )}
    </div>
  )
}
