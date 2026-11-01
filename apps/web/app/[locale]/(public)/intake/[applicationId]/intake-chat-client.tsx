'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useApplicationStream, NOT_SENT_ERROR } from '@/hooks/use-application-stream'
import { useAuthGate } from '@/components/auth/auth-gate-provider'
import { GatedRegion } from '@/components/auth/gated-region'
import { track } from '@/lib/analytics'
import { isAtBottom } from '@/lib/transcript-follow'
import { shouldReclaimFocus } from '@/lib/input-refocus'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { VisaTypeSelector } from '@/components/intake/visa-type-selector'
import { useToast } from '@/components/providers/toast-provider'

interface Props {
  applicationId: string
  /** The route already chosen for this application, if any. */
  visaTypeId?: string | null
}

/**
 * The interview, and only the interview.
 *
 * The document checklist used to live here in a 300px sidebar, rebuilt on every
 * turn by a structured generation that cost 9.4–10.0s a time. It is now built
 * once, when the applicant opens their documents and actually reads it. This
 * page is the conversation: a question, an answer, and the route they are
 * answering about.
 */
export default function IntakeChatClient({
  applicationId,
  visaTypeId,
}: Props) {
  const { messages, streamingContent, isLoading, isComplete, error, needsAuth, canSend, retry, sendMessage, resend } =
    useApplicationStream({ applicationId })
  const t = useTranslations('intake')
  const tAuth = useTranslations('auth')
  const router = useRouter()
  const { toast } = useToast()
  const { status, isGated, openAuthModal } = useAuthGate()
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  /**
   * Whether the transcript should follow new text.
   *
   * True only while the applicant is already at the bottom. The page used to
   * call `scrollIntoView` on every message and on every streamed chunk, which
   * scrolls the nearest scrollable ANCESTOR as well — so the whole window
   * lurched downward mid-sentence, including while someone was reading an
   * earlier answer or typing their own. Scrolling back up now means what it
   * looks like: stay here.
   */
  const followRef = useRef(true)

  /**
   * The message count as of the last settled turn. The visa selector re-reads
   * each route's eligibility when it changes — once per reply, not per token.
   */
  const [settledCount, setSettledCount] = useState(messages.length)
  // Derived during render (React's "adjusting state when a prop changes").
  if (!isLoading && settledCount !== messages.length) {
    setSettledCount(messages.length)
  }

  const documentsHref = `/documents/${applicationId}`
  // Gate the jump to documents: a guest/logged-out user gets the auth modal
  // (the backend would 403/redirect anyway); a permanent user navigates.
  function goToDocuments() {
    if (status === 'permanent') router.push(documentsHref)
    else openAuthModal(documentsHref)
  }

  useEffect(() => {
    track('intake_started', { applicationId })
  }, [applicationId])

  /**
   * Size the pane to whatever is actually left below it.
   *
   * It used to be `h-[calc(100dvh-15rem)]`, a guess at the height of the shell
   * above — and the shell varies: the stage nav wraps on narrow screens and the
   * next-step banner comes and goes. On a 795px viewport the guess left the
   * transcript 286px tall holding 2,311px of conversation, so the reply the
   * applicant had just been sent was clipped at both ends.
   *
   * Measuring once was not enough either: the first read said 154px and the
   * banner then pushed the pane down to 237px, overflowing the viewport by the
   * difference. The offset has to be re-read whenever anything ABOVE this
   * element changes size, which is what observing the scroll container and the
   * page wrapper buys — neither changes during a conversation, so this settles
   * immediately and then stays quiet.
   */
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const apply = () => {
      el.style.setProperty(
        '--intake-top',
        `${Math.round(el.getBoundingClientRect().top)}px`,
      )
    }

    // After paint, so the banner and stage nav are in the layout. Two frames:
    // the first lets React commit, the second lets the browser lay out.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(apply)
    })

    const observer = new ResizeObserver(apply)
    // Everything whose height can move this element down the page.
    const wrapper = el.parentElement
    const main = el.closest('main')
    if (wrapper) observer.observe(wrapper)
    if (main) observer.observe(main)
    observer.observe(document.body)
    window.addEventListener('resize', apply)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [])

  const onTranscriptScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    followRef.current = isAtBottom(el)
  }, [])

  // `scrollTop` on the transcript, never `scrollIntoView`: the latter walks up
  // and scrolls every scrollable ancestor, which is what moved the page.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !followRef.current) return
    el.scrollTop = el.scrollHeight
    // `error` too: the banner renders below the last message, and a failure
    // that lands off-screen is a failure the applicant never sees.
  }, [messages, streamingContent, error])

  /**
   * Put the caret back in the box when the answer lands.
   *
   * The input is disabled while the model is replying, and disabling a focused
   * element makes the browser drop focus to <body>. Nothing gave it back, so
   * after every single answer the applicant had to click the box before they
   * could type. Reported from a live dry run on 2026-09-06. The rule for when
   * that is the right thing to do lives in `shouldReclaimFocus`.
   */
  useEffect(() => {
    if (
      shouldReclaimFocus({
        isLoading,
        active: document.activeElement,
        body: document.body,
        input: inputRef.current,
      })
    ) {
      inputRef.current?.focus()
    }
  }, [isLoading])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    // A complete intake still takes messages: they are corrections or updates
    // to earlier answers (dry run 2026-10-15 — a wrong marriage date could not
    // be fixed once the input locked).
    if (!text || isLoading) return
    // Sending is the one moment the applicant unambiguously wants to see the
    // bottom: it is their own message going in (or the reason it cannot).
    followRef.current = true
    // The session cannot take it (no access, signed out, never opened): keep
    // the text where it was typed. The input used to clear first and the
    // message vanished behind the error already on screen (prod 2026-10-24).
    if (!sendMessage(text)) return
    setInput('')
    track('question_answered', { applicationId })
  }

  return (
    <div
      ref={rootRef}
      className="mx-auto flex w-full max-w-[860px] flex-col gap-4 lg:h-[calc(100dvh-var(--intake-top,13rem)-2.25rem)]">
      <div className="flex flex-col min-h-[60vh] lg:min-h-0 flex-1">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold tracking-[-0.45px] text-deep-black">
              {t('title')}
            </h1>
            <p className="text-[14px] text-midtone-gray mt-0.5">
              {t('subtitle')}
            </p>
          </div>

          <div className="flex items-end gap-4">
            {/* Naming the route switches the checklist from a model's
                recollection to the government's published requirements. It is
                a header control rather than a column of cards because Japan
                publishes 13 routes and Türkiye 15 — as a list it was taller
                than the conversation beside it. */}
            <div className="w-[240px] max-w-[60vw]">
              {/* Choosing a route STAYS on the interview.

                  It used to jump straight to the documents page, on the
                  reasoning that `setVisaType` deletes the graph checkpoint and
                  the interview would restart from the top. That restart was
                  fixed (INTAKE-004: startOrResume restores the transcript and
                  resumes the pending question), so the jump only cost the
                  applicant their place: on 2026-10-16 a super visa applicant
                  picked her route mid-interview and landed on Documents with
                  the super visa questions — host, income, insurance — unasked,
                  and an eTA applicant the same way before any eTA question.

                  So: while the new route still has questions
                  (`intakeComplete: false`) — or the API does not say — the
                  interview carries on with them, and a toast says the route
                  was saved. Only a route whose questions are all answered
                  goes on to Documents. Clearing the selection back to "no
                  route chosen" does nothing. */}
              <VisaTypeSelector
                applicationId={applicationId}
                initialVisaTypeId={visaTypeId ?? null}
                onChange={(chosen, saved) => {
                  if (!chosen) return
                  track('visa_type_chosen', {
                    applicationId,
                    visaTypeId: chosen,
                  })
                  // A route the applicant may not be able to use (eligibility
                  // still depends on their passport, or already ruled out)
                  // keeps them here, where the selector says so and the
                  // interview can ask — not on a Documents page for the
                  // wrong route (prod 2026-10-16, app 5d3a17a4).
                  if (saved?.eligibility && saved.eligibility.status !== 'eligible') return
                  if (saved?.intakeComplete === true) {
                    goToDocuments()
                    return
                  }
                  toast(t('routeSaved'), 'success')
                }}
                // Re-read each route's fit once a reply lands: an answer may
                // have ruled the chosen route out (a Pakistani passport on
                // the eTA), and the selector is where that is shown.
                refreshKey={settledCount}
              />
            </div>
            <button
              type="button"
              onClick={() => { track('upload_cta_clicked', { applicationId }); goToDocuments() }}
              className="text-[13px] text-midtone-gray hover:text-deep-black underline underline-offset-4 shrink-0 pb-2"
            >
              {t('skipToDocuments')} <span className="inline-block rtl:-scale-x-100" aria-hidden>→</span>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollerRef}
          onScroll={onTranscriptScroll}
          className="flex-1 overflow-y-auto flex flex-col gap-3 pb-4"
        >
          {messages.map((msg) => (
            <div
              key={msg.msgId}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-[14px] px-4 py-3 text-[14px] leading-[1.5] whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-deep-black text-canvas-white'
                    : 'bg-ghost-gray text-rich-black'
                } ${msg.status === 'failed' ? 'opacity-60' : ''}`}
              >
                {msg.content}
              </div>
              {/* An undelivered message stays where it was typed, with its
                  own way to send it again — it used to vanish silently. */}
              {msg.status === 'failed' && (
                <p className="mt-1 flex items-center gap-2 text-[12px] text-callout-red" role="alert">
                  {t('notSent')}
                  <button
                    type="button"
                    onClick={() => resend(msg.msgId)}
                    disabled={isLoading}
                    className="underline text-midtone-gray hover:text-ink disabled:opacity-50"
                  >
                    {t('retry')}
                  </button>
                </p>
              )}
            </div>
          ))}

          {/* The reply as it is being written. Same bubble as a finished
              assistant message so the text does not reflow when the turn
              closes and the authoritative version replaces it. */}
          {streamingContent !== null && (
            <div className="flex justify-start">
              <div
                className="max-w-[75%] rounded-[14px] px-4 py-3 text-[14px] leading-[1.5] whitespace-pre-wrap bg-ghost-gray text-rich-black"
                aria-live="polite"
                aria-busy="true"
              >
                {streamingContent}
                <span
                  className="inline-block w-[2px] h-[1em] ms-0.5 align-[-0.15em] bg-rich-black animate-pulse"
                  aria-hidden
                />
              </div>
            </div>
          )}

          {/* Only until the first chunk arrives — once there is text to show,
              the text IS the progress indicator. */}
          {isLoading && streamingContent === null && (
            <div className="flex justify-start">
              <div className="bg-ghost-gray rounded-[14px] px-4 py-3 text-[14px] text-midtone-gray">
                {t('thinking')}
              </div>
            </div>
          )}

          {isComplete && (
            <div className="flex flex-col items-center gap-3 mt-4 p-5 rounded-[14px] bg-ghost-gray">
              <Badge variant="inverse">{t('complete')}</Badge>
              <p className="text-[14px] text-rich-black text-center max-w-[420px]">
                {t('completeBody')}
              </p>
              <Button onClick={goToDocuments}>{t('continueToVault')} <span className="inline-block rtl:-scale-x-100" aria-hidden>→</span></Button>
              <p className="text-[12px] text-midtone-gray text-center">
                {t('completeHint')}
              </p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-[13px] text-callout-red text-center">
                {needsAuth ? t('sessionEnded') : error === NOT_SENT_ERROR ? t('notSentDetail') : error}
              </p>
              {/* The error used to be the end of the road: the session was
                  never opened and nothing on screen said so, so the applicant
                  kept typing answers that could not be recorded. A missing
                  session is the one case retrying cannot fix — offer the thing
                  that can. */}
              <button
                type="button"
                onClick={needsAuth ? () => openAuthModal() : retry}
                className="text-[12px] underline text-midtone-gray hover:text-ink"
              >
                {needsAuth ? tAuth('signIn') : t('retry')}
              </button>
            </div>
          )}

        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="flex gap-2 pt-3 border-t border-subtle-ash">
          <Input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={isComplete ? t('correctionPlaceholder') : t('inputPlaceholder')}
            // Closed while the session cannot take messages: typing into it
            // only to have the text go nowhere is what this replaced (prod
            // 2026-10-24). Anything already typed stays in the box.
            disabled={isLoading || !canSend}
            aria-describedby={!canSend ? 'intake-send-blocked' : undefined}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !canSend || !input.trim()}>
            {t('send')}
          </Button>
        </form>
        {!canSend && (
          <p id="intake-send-blocked" className="pt-2 text-[12px] text-midtone-gray">
            {t('sendBlocked')}
          </p>
        )}
      </div>

      {/* No full-width "Upload your documents" button here any more. The
          layout's StageProgress banner already carries that exact call to
          action a few pixels above this page, and a second copy of it below
          the input was taking a strip of the screen the conversation needed.
          Its analytics event moved onto the header link, which is now the one
          way out of this page. */}

      {/* Guests see the rest of the workflow exists, blurred and locked. */}
      {isGated && (
        <GatedRegion target={documentsHref} className="shrink-0 rounded-[14px]">
          <Card>
            <p className="text-[14px] font-medium text-deep-black mb-3">{t('fullWorkflow')}</p>
            <ul className="flex flex-col gap-2 text-[13px] text-rich-black">
              <li>{t('wf1')}</li>
              <li>{t('wf2')}</li>
              <li>{t('wf3')}</li>
              <li>{t('wf4')}</li>
            </ul>
          </Card>
        </GatedRegion>
      )}
    </div>
  )
}
