/**
 * Pure tests for the SSE stream hub.
 * Run: pnpm --filter web test:unit
 */
import { test, expect } from 'vitest'
import type { MessagingStreamEvent } from '@visaai/types'
import { createStreamHub } from './stream-hub.ts'

function fakeConnect() {
  const state = { opens: 0, closes: 0, emit: (_e: MessagingStreamEvent) => {} }
  const connect = (onEvent: (e: MessagingStreamEvent) => void) => {
    state.opens++
    state.emit = onEvent
    return () => { state.closes++; state.emit = () => {} }
  }
  return { state, connect }
}

const evt = (id: string): MessagingStreamEvent =>
  ({ type: 'message.created', conversation_id: id, application_id: 'a' }) as MessagingStreamEvent

test('opens exactly one connection for N subscribers and fans out to all', () => {
  const { state, connect } = fakeConnect()
  const hub = createStreamHub(connect)
  const a: string[] = []; const b: string[] = []
  hub.subscribe((e) => a.push(e.conversation_id))
  hub.subscribe((e) => b.push(e.conversation_id))
  expect(state.opens).toBe(1)
  state.emit(evt('c1'))
  expect(a).toEqual(['c1'])
  expect(b).toEqual(['c1'])
})

test('unsubscribing one keeps delivery to the others', () => {
  const { state, connect } = fakeConnect()
  const hub = createStreamHub(connect)
  const a: string[] = []; const b: string[] = []
  const offA = hub.subscribe((e) => a.push(e.conversation_id))
  hub.subscribe((e) => b.push(e.conversation_id))
  offA()
  state.emit(evt('c2'))
  expect(a).toEqual([])
  expect(b).toEqual(['c2'])
  expect(state.closes).toBe(0)
})

test('closes on last unsubscribe and re-opens on a new subscribe', () => {
  const { state, connect } = fakeConnect()
  const hub = createStreamHub(connect)
  const off = hub.subscribe(() => {})
  expect(state.opens).toBe(1)
  off()
  expect(state.closes).toBe(1)
  hub.subscribe(() => {})
  expect(state.opens).toBe(2)
})

test('a throwing subscriber does not stop delivery to others', () => {
  const { state, connect } = fakeConnect()
  const hub = createStreamHub(connect)
  const got: string[] = []
  hub.subscribe(() => { throw new Error('boom') })
  hub.subscribe((e) => got.push(e.conversation_id))
  state.emit(evt('c3'))
  expect(got).toEqual(['c3'])
})
