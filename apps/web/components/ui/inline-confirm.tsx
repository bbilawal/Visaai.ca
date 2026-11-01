'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * A button that asks "are you sure?" in the page instead of `window.confirm`.
 *
 * Dry run 2026-10-18: the consultant review page confirmed "Approve
 * application" and "Start a new review" with native dialogs. A native dialog
 * blocks browser automation (the run stalled on it), sits outside the page
 * where it is easy to miss or dismiss by reflex, and cannot be styled or
 * translated with the rest of the UI.
 *
 * Pressing the trigger replaces it, in place, with the question and two
 * buttons: confirm and cancel. Focus moves to confirm; Escape or Cancel puts
 * the trigger back and returns focus to it; nothing happens until confirm.
 *
 * After confirm the action usually disables the trigger (busy). Focus on a
 * disabled button falls to <body> and a keyboard user loses their place, so
 * focus is parked on the component's wrapper until the trigger is usable
 * again, then handed back.
 */
export function InlineConfirm({
  label,
  question,
  confirmLabel,
  cancelLabel,
  onConfirm,
  disabled = false,
  busy = false,
  triggerClassName = 'btn btn-primary',
  confirmClassName,
  cancelClassName = 'btn btn-ghost',
}: {
  /** The trigger's text (may change while busy, e.g. "Approving…"). */
  label: ReactNode
  /** The question shown once the trigger is pressed. */
  question: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  disabled?: boolean
  busy?: boolean
  triggerClassName?: string
  /** Defaults to the trigger's classes. */
  confirmClassName?: string
  cancelClassName?: string
}) {
  const [asking, setAsking] = useState(false)
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  /** Set when the question closes, so focus goes back to the trigger. */
  const returnFocus = useRef(false)
  const questionId = useId()
  const blocked = disabled || busy

  useEffect(() => {
    if (asking) {
      confirmRef.current?.focus()
      return
    }
    if (!returnFocus.current) return
    returnFocus.current = false
    const trigger = triggerRef.current
    if (trigger && !trigger.disabled) trigger.focus()
    else wrapRef.current?.focus()
  }, [asking])

  // Disabled while focused (the action went busy a tick later): park focus on
  // the wrapper. Enabled again while parked there: back to the trigger.
  useEffect(() => {
    const active = document.activeElement
    if (blocked && active && active === triggerRef.current) wrapRef.current?.focus()
    else if (!blocked && active && active === wrapRef.current) triggerRef.current?.focus()
  }, [blocked])

  function close() {
    returnFocus.current = true
    setAsking(false)
  }

  return (
    <span
      ref={wrapRef}
      tabIndex={-1}
      data-inline-confirm=""
      style={{ display: 'inline-flex', outline: 'none' }}
    >
      {asking ? (
        <span
          role="group"
          aria-labelledby={questionId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
          style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <span id={questionId} className="sans" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            {question}
          </span>
          <button
            ref={confirmRef}
            type="button"
            className={confirmClassName ?? triggerClassName}
            onClick={() => {
              close()
              onConfirm()
            }}
            disabled={blocked}
          >
            {confirmLabel}
          </button>
          <button type="button" className={cancelClassName} onClick={close}>
            {cancelLabel}
          </button>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={triggerClassName}
          onClick={() => setAsking(true)}
          disabled={blocked}
          aria-busy={busy || undefined}
        >
          {label}
        </button>
      )}
    </span>
  )
}
