/** Government portal hosts the side panel will bind a fill to. */
export const PORTAL_HOSTS = [/\.cic\.gc\.ca$/, /\.canada\.ca$/, /^cic\.gc\.ca$/, /^canada\.ca$/]

export interface TabLike {
  id?: number
  url?: string
  active?: boolean
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
