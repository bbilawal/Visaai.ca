import { NextResponse } from 'next/server'

/**
 * iOS Universal Links verification (MOB-001).
 *
 * `apps/mobile/app.config.ts` sets `associatedDomains: ['applinks:visaai.co']`.
 * iOS fetches this file over HTTPS at install time; without it Universal Links
 * silently never open the app.
 *
 * The Apple Team ID is NOT hardcoded — it is account data, it differs between
 * the personal and organisation teams, and a wrong prefix fails exactly as
 * silently as a missing file. Set APPLE_TEAM_ID (Apple Developer -> Membership)
 * and optionally IOS_BUNDLE_ID.
 *
 * Paths are scoped deliberately. `applinks` with `"*"` would claim every URL on
 * the domain, so a visitor tapping a marketing or pricing link would be yanked
 * into the app. Only the paths that have a real in-app destination are claimed;
 * this mirrors the Android intent filter.
 *
 * Served with Content-Type application/json and NO extension, which is what
 * iOS requires. It must not redirect — iOS does not follow redirects here,
 * which is why `/.well-known` is excluded from the locale proxy.
 */
const BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'co.visaai.app'

/** Kept in sync with the Android intentFilters in apps/mobile/app.config.ts. */
export const DEEP_LINK_PATHS = [
  '/applications/*',
  '/my-applications/*',
  '/messages/*',
  '/invite/*',
  '/reset-password',
]

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim()
  if (!teamId) {
    return new NextResponse(null, { status: 404 })
  }

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${teamId}.${BUNDLE_ID}`],
            components: DEEP_LINK_PATHS.map((path) => ({
              '/': path,
              comment: 'Opens the corresponding screen in the VisaAI app',
            })),
          },
        ],
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    },
  )
}
