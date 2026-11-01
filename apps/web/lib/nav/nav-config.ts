import type { AppRole } from '@/lib/api/me'

/**
 * Single source of truth for role-aware sidebar navigation.
 *
 * Pure + framework-free (no React, no hooks) so it is trivially unit-testable
 * and reused by any renderer. UI ONLY — this is NOT a security boundary. Every
 * destination is independently RBAC-gated server-side (route-group `requireRole`
 * layouts + backend guards); hiding a link never grants or revokes access.
 *
 * Hrefs point ONLY at routes that actually exist, so the menu can never leak a
 * link to a missing/unauthorized page. Spec'd-but-unbuilt destinations
 * (applicant Documents/Profile index, consultant Reviews Queue, Admin/Consultant
 * portal index) are intentionally omitted until those routes ship.
 *
 * Note: `AppRole` uses `'user'` for the applicant role (there is no
 * `'applicant'` literal in the system).
 */
export interface NavItem {
  /** Stable id for testing/keys, independent of label or href. */
  id: string
  /**
   * Key into the `nav` i18n namespace (NOT a display string). The renderer
   * resolves it with `useTranslations('nav')` so labels localize per locale.
   * Distinct ids can share a key (the three "Applications" entries all use
   * `applications`); every key here must exist in each `messages/<locale>.json`.
   */
  labelKey: string
  /**
   * Locale-LESS internal path (e.g. `/profile`). Typed `string`, not next's
   * `Route`: these are consumed by the i18n `<Link>` (from @/i18n/navigation),
   * which adds the active locale prefix at render time, so they are
   * deliberately NOT checked against the [locale]-prefixed typedRoutes tree.
   */
  href: string
}

/**
 * Shared entries (same id/route/label across every role). Defined once so the
 * label/route stays identical wherever they appear.
 *
 * `dashboard` points at `/` — the role's home/overview (progress + lists). It
 * was previously mislabeled "Applications", which (a) didn't match the page and
 * (b) collided with the consultant/admin role "Applications" item, rendering the
 * SAME label twice. It now uses the dedicated `dashboard` label (already present
 * in every locale) and anchors the top of every role's nav.
 */
const DASHBOARD: NavItem = { id: 'dashboard', labelKey: 'dashboard', href: '/' }
const MESSAGES: NavItem = { id: 'messages', labelKey: 'messages', href: '/messages' }
const PROFILE: NavItem = { id: 'profile', labelKey: 'profile', href: '/profile' }
const ORGANIZATIONS: NavItem = { id: 'organizations', labelKey: 'organizations', href: '/organizations' }
// Partner Portal. Shown to every role: partner access belongs to an
// organization, and the API re-checks membership and `partner.*` permissions,
// so hiding the link would only make it undiscoverable, not safer.
const DEVELOPERS: NavItem = { id: 'developers', labelKey: 'developers', href: '/developers' }

/**
 * Full, ORDERED nav per role. Ordering follows: primary work surface first →
 * communication → account. Every href maps to a route that actually exists;
 * each labelKey exists in every `messages/<locale>.json` `nav` namespace.
 *
 * Scope-qualified labels remove the cross-role "Applications" collision:
 *   - applicant work list  → "My Applications"  (/my-applications)
 *   - consultant work list → "Review Queue"     (/consultant/applications)
 *   - admin work list      → "All Applications" (/applications)
 */
const BY_ROLE: Record<AppRole, NavItem[]> = {
  user: [
    DASHBOARD,
    { id: 'my-applications', labelKey: 'myApplications', href: '/my-applications' },
    { id: 'new-application', labelKey: 'newApplication', href: '/applications/new' },
    { id: 'consultants', labelKey: 'consultants', href: '/consultants' },
    // Self-onboarding for people who want to LIST on the marketplace. Shown to
    // applicants because that is the role a prospective consultant still holds
    // — they have no consultant role until an admin approves their profile.
    {
      id: 'become-consultant',
      labelKey: 'becomeConsultant',
      href: '/become-a-consultant',
    },
    MESSAGES,
    { id: 'billing', labelKey: 'billing', href: '/billing' },
    ORGANIZATIONS,
    DEVELOPERS,
    PROFILE,
  ],
  consultant: [
    DASHBOARD,
    { id: 'consultant-dashboard', labelKey: 'consultantDashboard', href: '/consultant/dashboard' },
    { id: 'consultant-queue', labelKey: 'reviewQueue', href: '/consultant/applications' },
    { id: 'consultant-payouts', labelKey: 'payouts', href: '/consultant/payouts' },
    MESSAGES,
    ORGANIZATIONS,
    DEVELOPERS,
    PROFILE,
  ],
  admin: [
    DASHBOARD,
    { id: 'admin-dashboard', labelKey: 'adminDashboard', href: '/admin' },
    { id: 'admin-applications', labelKey: 'allApplications', href: '/applications' },
    { id: 'assignments', labelKey: 'assignments', href: '/assignments' },
    { id: 'users', labelKey: 'userManagement', href: '/users' },
    // Without this the consultant self-onboarding flow dead-ends: `active` is
    // admin-only, so a submitted profile is unbookable until reviewed here.
    { id: 'consultant-review', labelKey: 'consultantReview', href: '/consultant-review' },
    { id: 'admin-billing', labelKey: 'adminBilling', href: '/admin/billing' },
    { id: 'admin-coupons', labelKey: 'adminCoupons', href: '/admin/coupons' },
    // The reviewer's entry point for the visa source-change queue. Without a
    // nav item the page exists but nobody arrives at it, which is how 125
    // changes came to be waiting with no one able to look at them.
    { id: 'registry-ops', labelKey: 'adminRegistryOps', href: '/registry' },
    // The knowledge corpus has the same problem the registry queue had: a
    // coverage gap or a quarantined source is only actionable if somebody can
    // see it. Without a nav item the page exists and nobody arrives.
    { id: 'knowledge-ops', labelKey: 'adminKnowledgeOps', href: '/knowledge' },
    { id: 'audit', labelKey: 'auditLogs', href: '/audit' },
    { id: 'notification-templates', labelKey: 'notificationTemplates', href: '/notification-templates' },
    { id: 'notification-ops', labelKey: 'notificationOps', href: '/notification-ops' },
    MESSAGES,
    ORGANIZATIONS,
    PROFILE,
  ],
}

/**
 * Build the nav for a role. A null/unknown role (signed out or still loading)
 * gets a minimal safe set (Dashboard + Messages + Profile) — fail-safe, never
 * throws, never leaks a privileged link.
 */
export function navForRole(role: AppRole | null | undefined): NavItem[] {
  if (!role) return [DASHBOARD, MESSAGES, PROFILE]
  return [...(BY_ROLE[role] ?? [DASHBOARD, MESSAGES, PROFILE])]
}
