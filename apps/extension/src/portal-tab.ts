import { classifyPortalPage } from './portal-page'

/** Government portal hosts the side panel will bind a fill to. */
export const PORTAL_HOSTS = [/\.cic\.gc\.ca$/, /\.canada\.ca$/, /^cic\.gc\.ca$/, /^canada\.ca$/]

export interface TabLike {
  id?: number
  url?: string
  active?: boolean
  status?: string
  lastAccessed?: number
}

export function isPortalUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && PORTAL_HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

/**
 * The tab a fill binds to, from the tabs of the side panel's window.
 *
 * The active tab wins when it is a portal tab. Otherwise the ONE portal tab in
 * the window is used: the run is launched from the VisaAI tab, so requiring the
 * portal to be the active tab failed every first attempt (prod 2026-10-15,
 * extension_bind_timeout). Two or more portal tabs and none active is
 * ambiguous, and we never guess which form to write into.
 */
export function pickPortalTab(tabs: TabLike[]): number | null {
  const active = tabs.find((t) => t.active)
  if (active?.id != null && isPortalUrl(active.url)) return active.id
  const portals = tabs.filter((t) => t.id != null && isPortalUrl(t.url))
  return portals.length === 1 ? portals[0].id! : null
}

/**
 * The portal tab IN FRONT, or null. A fill binds only to this.
 *
 * Chrome freezes background tabs: a run bound to the one portal tab while the
 * VisaAI tab was in front could not read the page ("Could not read the portal
 * page", dry run 2026-10-17). The panel now waits for the applicant to bring
 * the portal tab to the front (sidepanel.ts), so the background fallback of
 * pickPortalTab is not needed to start a run.
 */
export function pickActivePortalTab(tabs: TabLike[]): number | null {
  const active = tabs.find((t) => t.active)
  return active?.id != null && isPortalUrl(active.url) ? active.id : null
}

/**
 * The portal tab to bring to the front when VisaAI hands off a launch.
 *
 * Live 2026-10-17: Launch stored the session, but the applicant stayed on the
 * VisaAI tab, the panel waited for a portal tab in front, and "Launch
 * assistant didn't do anything". Chrome lets the extension switch tabs
 * without a click, so it switches to the portal: a form page first, else a
 * sign-in / account page (where the panel says what to do), the most recently
 * used of them. Null when the window has no portal tab.
 *
 * `pages` are the pages this application's fill covers. A form page of ANOTHER
 * application is never chosen: live 2026-10-17, a leftover eTA tab (a form
 * page on its own host) won over the visitor-visa draft's account tab. Without
 * `pages` (an older web build) any form page counts.
 */
export function pickPortalTabToFocus(tabs: TabLike[], pages?: string[]): number | null {
  const portals = tabs.filter((t) => t.id != null && isPortalUrl(t.url))
  if (portals.length === 0) return null
  const recent = (a: TabLike, b: TabLike) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
  const forms = portals.filter((t) => classifyPortalPage(t.url).kind === 'form').sort(recent)
  const others = portals.filter((t) => classifyPortalPage(t.url).kind !== 'form').sort(recent)
  if (!pages) return (forms[0] ?? others[0]).id!
  const roots = new Set(pages.map(rootOf))
  // 1. A page this fill covers. 2. Sign-in / account pages. 3. A form page
  // we do not map yet ('/review'), unless it is plainly another application.
  const ours = forms.find((t) => roots.has(rootOf(pathOf(t.url))))
  const foreign = (t: TabLike) => (rootOf(pathOf(t.url)) === 'eta') !== roots.has('eta')
  return (ours ?? others[0] ?? forms.find((t) => !foreign(t)))?.id ?? null
}

function pathOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').pathname
  } catch {
    return ''
  }
}

/** First path segment: 'doc-upload' for '/doc-upload', 'eta' for '/eta/welcome'. */
function rootOf(path: string): string {
  return path.split('/')[1] ?? ''
}
