/**
 * Whether the intake transcript should follow new text to the bottom.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE INLINE LINES
 *
 * The rule it encodes is the whole of a bug report: "page automatically scroll
 * down, it should stay at same place when user asks question". The old code
 * called `scrollIntoView` on every message and every streamed chunk, and that
 * API walks up the tree and scrolls every scrollable ANCESTOR — so the page
 * itself lurched downward mid-sentence, including while someone was reading an
 * earlier answer or typing their own.
 *
 * The fix has two halves. The transcript scrolls ITSELF (`scrollTop`), never
 * the page. And it only does so while the reader is already at the bottom,
 * which is what this decides. Putting the decision here means it can be tested
 * without a browser, and means the threshold is written down once rather than
 * guessed at each call site.
 */

/**
 * How far from the bottom still counts as "at the bottom", in pixels.
 *
 * Not zero: browsers report fractional scroll positions on scaled displays and
 * after a zoom, so an exact comparison would read as "the user scrolled away"
 * on a transcript nobody had touched. One line of text is roughly 21px at this
 * font size, so 64px is about three lines — close enough that new text is still
 * in view, far enough that a deliberate scroll up is unambiguous.
 */
export const FOLLOW_SLACK_PX = 64

export interface ScrollGeometry {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export function isAtBottom(
  { scrollHeight, scrollTop, clientHeight }: ScrollGeometry,
  slack: number = FOLLOW_SLACK_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight < slack
}
