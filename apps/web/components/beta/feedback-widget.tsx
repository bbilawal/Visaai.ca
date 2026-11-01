'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useFlag } from '@/components/providers/feature-flags-provider'
import { getSession } from '@/lib/supabase/client'
import {
  collectDeviceMetadata,
  submitFeedback,
  type FeedbackKind,
} from '@/lib/api/feedback-client'

const KINDS: FeedbackKind[] = ['bug', 'feature_request', 'satisfaction', 'other']
const RATING_KINDS: FeedbackKind[] = ['satisfaction']

/**
 * In-app beta feedback (Task 15 §6).
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never pre-fills the message with page content, form state, or anything
 *    from the user's application. A "we've attached your current page for
 *    context" convenience is how case data ends up in a support queue, and the
 *    §6 rule is not to capture sensitive application data unnecessarily.
 *  - It never attaches a screenshot automatically. The consent checkbox governs
 *    diagnostics only; the API refuses an attachment without it, and the
 *    storage policy refuses one outside the user's own prefix.
 *
 * Accessibility: the panel is a labelled dialog, focus moves into it on open
 * and returns to the trigger on close, Escape closes it, and the result is
 * announced through `Alert` (`role="status"` / `role="alert"`). WCAG 2.2 AA is
 * a launch gate, so a widget bolted on at the end is exactly the thing that
 * quietly fails it.
 */
export function FeedbackWidget() {
  const enabled = useFlag('beta_feedback_widget_enabled')
  const t = useTranslations('beta')
  const pathname = usePathname()

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [rating, setRating] = useState(4)
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'ok' | 'error' | null>(null)

  const panelId = useId()
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstFieldRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (open) firstFieldRef.current?.focus()
    else triggerRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!enabled) return null

  const needsRating = RATING_KINDS.includes(kind)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setResult(null)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('no session')

      await submitFeedback(
        session.access_token,
        {
          kind,
          rating: needsRating ? rating : null,
          message: message.trim(),
          surface: 'web',
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '',
          diagnosticsConsent: consent,
          // Only sent with consent. Without it the server still receives
          // nothing beyond the request headers it would have anyway.
          device: consent ? collectDeviceMetadata() : {},
        },
        pathname,
      )

      setResult('ok')
      setMessage('')
      setConsent(false)
    } catch {
      setResult('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed bottom-4 end-4 z-50">
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          id={panelId}
          className="mb-2 w-80 rounded-lg border border-hairline-2 bg-paper-canvas p-4 shadow-lg"
        >
          <h2 id={titleId} className="mb-2 text-base font-semibold text-ink">
            {t('feedbackTitle')}
          </h2>

          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('feedbackKind')}</span>
              <select
                ref={firstFieldRef}
                value={kind}
                onChange={(e) => setKind(e.target.value as FeedbackKind)}
                className="input"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>

            {needsRating && (
              <label className="flex flex-col gap-1 text-sm">
                <span>{t('feedbackRating')}</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={rating}
                  onChange={(e) => setRating(Number(e.target.value))}
                  // The slider's value must be readable without sight; the
                  // numeric value alone ("3") is meaningless out of context.
                  aria-valuetext={t('feedbackRatingValue', { rating })}
                />
              </label>
            )}

            <label className="flex flex-col gap-1 text-sm">
              <span>{t('feedbackMessage')}</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                rows={4}
                required
                className="input"
                placeholder={t('feedbackPlaceholder')}
              />
              <span className="text-xs text-pale-stone">{t('feedbackPrivacyHint')}</span>
            </label>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>{t('feedbackDiagnosticsConsent')}</span>
            </label>

            {result === 'ok' && <Alert variant="success">{t('feedbackThanks')}</Alert>}
            {result === 'error' && <Alert variant="error">{t('feedbackFailed')}</Alert>}

            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={busy} disabled={!message.trim()}>
                {t('feedbackSubmit')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t('feedbackClose')}
              </Button>
            </div>
          </form>
        </div>
      )}

      <Button
        ref={triggerRef}
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {t('feedbackTrigger')}
      </Button>
    </div>
  )
}
