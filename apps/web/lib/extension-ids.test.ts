import { describe, expect, it, vi } from 'vitest'
import {
  CHROME_WEB_STORE_ID,
  CHROME_WEB_STORE_URL,
  extensionIdCandidates,
  findInstalledExtension,
} from './extension-ids'

describe('extension ids', () => {
  it('links the install button to the published Web Store listing', () => {
    expect(CHROME_WEB_STORE_URL).toBe(
      'https://chromewebstore.google.com/detail/visaai-portal-assistant/hmeanjdifblcjofiapfhgigiinhdejaa',
    )
    expect(CHROME_WEB_STORE_URL.endsWith(CHROME_WEB_STORE_ID)).toBe(true)
  })

  // The Web Store issues its own id; the self-hosted zip keeps the manifest
  // key's id. Users may have either, so both must be tried — store first.
  it('tries the Web Store id first, then the configured self-host id, without duplicates', () => {
    expect(extensionIdCandidates('hlpcffbcmecnoonfkalhilacgebgkfcf')).toEqual([
      CHROME_WEB_STORE_ID,
      'hlpcffbcmecnoonfkalhilacgebgkfcf',
    ])
    expect(extensionIdCandidates(CHROME_WEB_STORE_ID)).toEqual([CHROME_WEB_STORE_ID])
    expect(extensionIdCandidates('')).toEqual([CHROME_WEB_STORE_ID])
    expect(extensionIdCandidates(undefined)).toEqual([CHROME_WEB_STORE_ID])
  })

  it('returns the first id whose extension answers the ping', async () => {
    const ping = vi.fn(async (id: string) =>
      id === 'hlpcffbcmecnoonfkalhilacgebgkfcf' ? { ok: true } : null,
    )
    await expect(
      findInstalledExtension(['hmeanjdifblcjofiapfhgigiinhdejaa', 'hlpcffbcmecnoonfkalhilacgebgkfcf'], ping),
    ).resolves.toBe('hlpcffbcmecnoonfkalhilacgebgkfcf')
  })

  it('returns null when none is installed', async () => {
    await expect(findInstalledExtension(['a', 'b'], async () => null)).resolves.toBeNull()
  })
})
