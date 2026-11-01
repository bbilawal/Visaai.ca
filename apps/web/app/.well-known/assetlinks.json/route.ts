import { NextResponse } from 'next/server'

/**
 * Android App Links verification (MOB-001).
 *
 * `apps/mobile/app.config.ts` declares an intent filter with `autoVerify: true`
 * for `https://visaai.co/*`, and its own comment says "assetlinks.json must be
 * served by the web app". It never was — there was no `.well-known` anywhere in
 * this repo. Android therefore fails verification silently and refuses to route
 * those links to the app; every https link opens in the browser instead.
 *
 * The SHA-256 signing fingerprint is NOT hardcoded here. It lives in the Play
 * Console / EAS credentials, differs between the upload key and the Play App
 * Signing key, and a wrong value fails verification just as silently as a
 * missing file. Committing a placeholder would be worse than serving nothing:
 * it would look configured.
 *
 * Set ANDROID_CERT_FINGERPRINTS to the colon-separated SHA-256 of the release
 * signing certificate, exactly as Play Console shows it. Multiple certificates
 * (upload key + Play App Signing key, or staging + production) are comma
 * separated.
 *
 *   Play Console -> your app -> Setup -> App signing
 *   or: eas credentials -p android
 *
 * Until it is set this route 404s, which is the same state as today — the app
 * links simply do not verify — but the reason is now discoverable rather than
 * invisible.
 */
const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME ?? 'co.visaai.app'

function fingerprints(): string[] {
  return (process.env.ANDROID_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean)
}

export function GET() {
  const certs = fingerprints()
  if (certs.length === 0) {
    return new NextResponse(null, { status: 404 })
  }

  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: certs,
        },
      },
    ],
    {
      headers: {
        'Content-Type': 'application/json',
        // Android re-checks periodically; a long cache delays recovery from a
        // bad fingerprint by exactly that long.
        'Cache-Control': 'public, max-age=300',
      },
    },
  )
}
