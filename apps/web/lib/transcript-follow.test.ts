import { describe, expect, it } from 'vitest'
import { isAtBottom, FOLLOW_SLACK_PX } from './transcript-follow'

/**
 * The transcript may only chase new text while the reader is already at the
 * bottom. Everything here is a case that actually happened on /intake, where
 * the page used to scroll itself out from under whoever was reading it.
 */
describe('isAtBottom', () => {
  const pane = (scrollTop: number, scrollHeight = 2000, clientHeight = 400) =>
    ({ scrollHeight, scrollTop, clientHeight })

  it('follows when the reader is pinned to the bottom', () => {
    expect(isAtBottom(pane(1600))).toBe(true)
  })

  it('does not follow when the reader has scrolled back to re-read', () => {
    // The bug: a reply landing here used to drag them to the bottom mid-sentence.
    expect(isAtBottom(pane(200))).toBe(false)
    expect(isAtBottom(pane(0))).toBe(false)
  })

  it('tolerates the fractional scroll positions browsers actually report', () => {
    // A transcript nobody has touched can sit a pixel off the bottom on a
    // scaled display. An exact comparison would call that "scrolled away".
    expect(isAtBottom(pane(1599.4))).toBe(true)
    expect(isAtBottom(pane(1600 - (FOLLOW_SLACK_PX - 1)))).toBe(true)
  })

  it('treats a deliberate scroll of more than the slack as deliberate', () => {
    expect(isAtBottom(pane(1600 - FOLLOW_SLACK_PX))).toBe(false)
  })

  it('follows a transcript shorter than its own pane', () => {
    // First turn: nothing to scroll. Must not read as "scrolled away", or the
    // opening question would never be followed.
    expect(isAtBottom({ scrollHeight: 150, scrollTop: 0, clientHeight: 400 })).toBe(true)
  })

  it('is unaffected by how tall the conversation has grown', () => {
    // A long intake and a short one behave identically at the same distance.
    expect(isAtBottom({ scrollHeight: 50_000, scrollTop: 49_600, clientHeight: 400 })).toBe(true)
    expect(isAtBottom({ scrollHeight: 50_000, scrollTop: 40_000, clientHeight: 400 })).toBe(false)
  })
})
