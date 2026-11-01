/**
 * Minimal SSE frame parser (pure, no DOM/network). Splits an accumulating
 * buffer on the SSE record separator (`\n\n`), extracting each frame's joined
 * `data:` payload. Returns complete messages plus the unparsed remainder.
 * Kept separate from the React client so it is unit-testable.
 */
export interface SseDrainResult {
  messages: string[]
  rest: string
}

export function drainSseFrames(buffer: string): SseDrainResult {
  const messages: string[] = []
  let rest = buffer
  let idx: number
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n')
    if (data) messages.push(data)
  }
  return { messages, rest }
}
