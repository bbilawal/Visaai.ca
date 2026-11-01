/**
 * The VisaAI Portal Assistant exists under two ids:
 *  - the Chrome Web Store listing, whose id the store issues, and
 *  - the self-hosted package (`build.mjs --selfhost`), whose id is derived from
 *    the manifest `key` and configured as NEXT_PUBLIC_EXTENSION_ID.
 *
 * The page used to message only NEXT_PUBLIC_EXTENSION_ID, so anyone who
 * installed from the Web Store was reported as "not installed" forever.
 * Detection now tries every candidate and remembers the one that answers.
 */
export const CHROME_WEB_STORE_ID = 'hmeanjdifblcjofiapfhgigiinhdejaa'

export const CHROME_WEB_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL ||
  `https://chromewebstore.google.com/detail/visaai-portal-assistant/${CHROME_WEB_STORE_ID}`

/** Web Store id first (what the install button installs), then the self-host id. */
export function extensionIdCandidates(configured: string | undefined | null): string[] {
  const ids = [CHROME_WEB_STORE_ID]
  if (configured && !ids.includes(configured)) ids.push(configured)
  return ids
}

/** First id whose extension answers `ping` with `{ ok: true }`, else null. */
export async function findInstalledExtension(
  ids: string[],
  ping: (id: string) => Promise<{ ok?: boolean } | null>,
): Promise<string | null> {
  for (const id of ids) {
    const pong = await ping(id)
    if (pong?.ok) return id
  }
  return null
}
