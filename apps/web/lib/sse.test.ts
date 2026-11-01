/**
 * Pure tests for the SSE frame parser.
 * Run: pnpm --filter web test:unit
 */
import { test, expect } from 'vitest'
import { drainSseFrames } from './sse.ts'

test('extracts complete frames and keeps the partial remainder', () => {
  const buf = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"'
  const { messages, rest } = drainSseFrames(buf)
  expect(messages).toEqual(['{"a":1}', '{"b":2}'])
  expect(rest).toBe('data: {"c"')
})

test('no complete frame yet → no messages, buffer preserved', () => {
  const { messages, rest } = drainSseFrames('data: {"partial":')
  expect(messages).toEqual([])
  expect(rest).toBe('data: {"partial":')
})

test('multi-line data frames are joined', () => {
  const { messages } = drainSseFrames('data: line1\ndata: line2\n\n')
  expect(messages).toEqual(['line1\nline2'])
})

test('a parsed heartbeat payload is distinguishable from a queue event', () => {
  const { messages } = drainSseFrames(
    'data: {"heartbeat":true}\n\ndata: {"event_type":"APPLICATION_CREATED"}\n\n',
  )
  const parsed = messages.map((m) => JSON.parse(m) as Record<string, unknown>)
  expect(parsed[0].heartbeat).toBe(true)
  expect(parsed[1].event_type).toBe('APPLICATION_CREATED')
})
