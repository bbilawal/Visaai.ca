/**
 * API-wiring tests for assignment mutations: assert each action targets the
 * correct backend path.
 * Run: pnpm --filter web test:unit
 */
import { test, expect } from 'vitest'
import {
  selfAssignPath,
  adminAssignPath,
  adminReassignPath,
  adminUnassignPath,
} from './assignment-paths.ts'

const ID = 'b9de1dfd-93de-4dfe-9297-896bd1bdd8cb'

test('self-assign hits the consultant self-assign endpoint', () => {
  expect(selfAssignPath(ID)).toBe(`/applications/${ID}/consultant/self-assign`)
})

test('admin assign hits /admin/applications/:id/assign', () => {
  expect(adminAssignPath(ID)).toBe(`/admin/applications/${ID}/assign`)
})

test('admin reassign hits /admin/applications/:id/reassign', () => {
  expect(adminReassignPath(ID)).toBe(`/admin/applications/${ID}/reassign`)
})

test('admin unassign hits /admin/applications/:id/unassign', () => {
  expect(adminUnassignPath(ID)).toBe(`/admin/applications/${ID}/unassign`)
})

test('paths are distinct per action', () => {
  const all = new Set([
    selfAssignPath(ID),
    adminAssignPath(ID),
    adminReassignPath(ID),
    adminUnassignPath(ID),
  ])
  expect(all.size).toBe(4)
})
