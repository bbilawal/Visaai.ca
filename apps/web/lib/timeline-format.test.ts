/**
 * Pure tests for the timeline event-display mapping.
 * Run: pnpm --filter web test:unit
 */
import { test, expect } from 'vitest'
import { eventDisplay, toneColor } from './timeline-format.ts'

test('each assignment event type has a distinct, non-empty labelKey + icon', () => {
  const types = [
    'CONSULTANT_SELF_ASSIGNED',
    'CONSULTANT_ASSIGNED',
    'CONSULTANT_REASSIGNED',
    'CONSULTANT_UNASSIGNED',
  ] as const
  const labelKeys = new Set<string>()
  for (const t of types) {
    const d = eventDisplay(t)
    expect(d.labelKey.length > 0, `${t} has a labelKey`).toBeTruthy()
    expect(d.icon.length > 0, `${t} has an icon`).toBeTruthy()
    expect(['assign', 'reassign', 'unassign']).toContain(d.tone)
    labelKeys.add(d.labelKey)
  }
  expect(labelKeys.size, 'all four labelKeys are distinct').toBe(4)
})

test('reassign and unassign carry their own tones', () => {
  expect(eventDisplay('CONSULTANT_REASSIGNED').tone).toBe('reassign')
  expect(eventDisplay('CONSULTANT_UNASSIGNED').tone).toBe('unassign')
})

test('unknown type falls back safely (never throws)', () => {
  const d = eventDisplay('SOMETHING_ELSE')
  expect(d.labelKey).toBe('event')
  expect(d.icon.length > 0).toBeTruthy()
})

test('toneColor returns a css value for every tone', () => {
  for (const tone of ['assign', 'reassign', 'unassign'] as const) {
    expect(toneColor(tone)).toMatch(/var\(--color/)
  }
})
