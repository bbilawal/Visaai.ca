/**
 * Pure unit tests for role-aware nav config.
 * Run: pnpm --filter web test:unit
 */
import { test, expect } from 'vitest'
import type { AppRole } from '@/lib/api/me'
import { navForRole } from './nav-config.ts'
import en from '../../messages/en.json'

const ids = (role: AppRole | null | undefined) => navForRole(role).map(i => i.id)
const hrefs = (role: AppRole | null | undefined) => navForRole(role).map(i => i.href as string)

test('applicant (user): dashboard-first, then work list, comms, account', () => {
  expect(ids('user')).toEqual([
    'dashboard',
    'my-applications',
    'new-application',
    'consultants',
    'become-consultant',
    'messages',
    'billing',
    'organizations',
    'developers',
    'profile',
  ])
})

test('consultant: dashboard + review queue + payouts + messages + organizations + profile; no admin links', () => {
  expect(ids('consultant')).toEqual([
    'dashboard',
    'consultant-dashboard',
    'consultant-queue',
    'consultant-payouts',
    'messages',
    'organizations',
    'developers',
    'profile',
  ])
})

test('admin: dashboard + all-applications + assignments + users + registry/knowledge ops + audit + notif tools + comms/account', () => {
  expect(ids('admin')).toEqual([
    'dashboard',
    'admin-dashboard',
    'admin-applications',
    'assignments',
    'users',
    'consultant-review',
    'admin-billing',
    'admin-coupons',
    'registry-ops',
    'knowledge-ops',
    'audit',
    'notification-templates',
    'notification-ops',
    'messages',
    'organizations',
    'profile',
  ])
})

test('no duplicate label key within a role (kills the old double "Applications")', () => {
  for (const role of ['user', 'consultant', 'admin'] as const) {
    const keys = navForRole(role).map((i) => i.labelKey)
    expect(new Set(keys).size, `${role} has a duplicate labelKey`).toBe(keys.length)
  }
})

test('null/undefined role (signed out or loading) degrades to a minimal safe set', () => {
  expect(ids(null)).toEqual(['dashboard', 'messages', 'profile'])
  expect(ids(undefined)).toEqual(['dashboard', 'messages', 'profile'])
})

test('no leakage: non-admin roles never expose admin-only routes', () => {
  for (const role of ['user', 'consultant', null, undefined] as const) {
    const h = hrefs(role)
    expect(h, `${role} must not see /users`).not.toContain('/users')
    expect(h, `${role} must not see /assignments`).not.toContain('/assignments')
    expect(h, `${role} must not see /audit`).not.toContain('/audit')
  }
})

test('no leakage: applicant never exposes consultant routes', () => {
  expect(hrefs('user')).not.toContain('/consultant/assigned')
})

test('every href is a non-empty string (no dead/blank links)', () => {
  for (const role of ['user', 'consultant', 'admin'] as const) {
    for (const item of navForRole(role)) {
      expect(typeof item.href).toBe('string')
      expect((item.href as string).length > 0).toBeTruthy()
    }
  }
})

test('admin nav includes billing + coupons; other roles do not', () => {
  expect(ids('admin')).toEqual(expect.arrayContaining(['admin-billing', 'admin-coupons']))
  expect(hrefs('admin')).toEqual(expect.arrayContaining(['/admin/billing', '/admin/coupons']))
  expect(hrefs('user')).not.toContain('/admin/billing')
  expect(hrefs('consultant')).not.toContain('/admin/billing')
})

test('no two nav items render the SAME LABEL for a role', () => {
  // The existing duplicate check is on labelKey, which passed while the
  // consultant sidebar showed "Dashboard" twice: `dashboard` and
  // `consultantDashboard` were distinct keys that resolved to identical English
  // strings. Distinct keys are not the property that matters to a user — what
  // they see is. This asserts on the resolved label.
  for (const role of ['user', 'consultant', 'admin'] as const) {
    const labels = navForRole(role).map(
      i => (en.nav as Record<string, string>)[i.labelKey],
    )
    for (const [i, label] of labels.entries()) {
      expect(label, `${role}: labelKey "${navForRole(role)[i].labelKey}" is missing from messages/en.json nav`).toBeTruthy()
    }
    expect(new Set(labels).size, `${role} renders a duplicate nav label: ${labels.join(', ')}`).toBe(labels.length)
  }
})
