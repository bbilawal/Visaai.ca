/**
 * Whether the intake input should take the caret back once an answer lands.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO INLINE LINES
 *
 * The rule it encodes is a bug report: "when ai answer of any questions user
 * can type again instead of clicking and then type". The input is disabled
 * while the model is replying, and disabling a focused element makes the
 * browser move focus to <body>. Nothing gave it back, so after every single
 * answer the applicant had to click the box before they could type — in an
 * interview a dozen questions long, a dozen unnecessary clicks.
 *
 * Reclaiming focus unconditionally would be its own bug: someone who clicked
 * the visa-type select, or scrolled up and focused a link while the model was
 * thinking, would have the caret yanked out from under them. So the reclaim is
 * limited to the case the disable itself created — focus sitting on nothing.
 *
 * Putting the decision here means it can be tested without a browser.
 */

export interface RefocusInput {
  /** The model is still replying; the box is disabled and must stay so. */
  isLoading: boolean
  /** The interview is over; the box is permanently disabled. */
  isComplete: boolean
  /** `document.activeElement` at the moment of the check. */
  active: Element | null
  /** `document.body` — where the browser parks focus after a disable. */
  body: Element | null
  /** The input itself. */
  input: Element | null
}

export function shouldReclaimFocus({
  isLoading,
  isComplete,
  active,
  body,
  input,
}: RefocusInput): boolean {
  // Nothing to focus, or nothing focusable yet.
  if (isLoading || isComplete || !input) return false
  // Already there: refocusing would be a no-op that still resets the caret
  // position mid-word if the applicant started typing early.
  if (active === input) return false
  // Focus went nowhere — this is the blur the disable caused, so take it back.
  if (!active || active === body) return true
  // Focus is somewhere deliberate. Leave it alone.
  return false
}
