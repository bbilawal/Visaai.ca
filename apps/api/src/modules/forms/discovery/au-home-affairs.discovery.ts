import { defaultHttp, type FetchLike } from '../http';
import type { PortalDiscoveryStrategy } from './discovery.types';

/**
 * Australia — Department of Home Affairs.
 *
 * WHY THIS PORTAL HAS NO LANDING-PAGE STEP
 *
 * Everywhere else the design deliberately refuses to hardcode a deep PDF link,
 * because IRCC versions forms by date in the path and such links rot silently.
 * Home Affairs is the opposite case, and hardcoding is the honest option here:
 *
 *   - Its form URLs are STABLE and unversioned:
 *     /form-listing/forms/<number>.pdf. There is no dated segment to discover.
 *   - Its forms index (/help-support/departmental-forms/pdf-forms) is a
 *     JavaScript-rendered SharePoint page. MEASURED 2026-08-12: 1.28 MB of
 *     HTML containing ZERO .pdf hrefs, so there is nothing for a plain fetch
 *     to extract. Discovering from it would need the headless-browser escape
 *     hatch, for a link that never changes.
 *
 * So `sourceUrl` on an Australian FormSpec IS the PDF, and this strategy just
 * confirms it is reachable and really a PDF before handing it on. Revision
 * detection falls back to the sha256 the refresh job already computes, which
 * is what catches a re-issue under an unchanged URL.
 *
 * ACCESS: this host 403s the conventional crawler User-Agent. See
 * IDENTIFIED_NO_URL_HEADERS in ../http — we stay identified as VisaAI and put
 * the contact address in `From:`. Its robots.txt (readable with that identity)
 * does NOT disallow /form-listing/forms/.
 */
export function isDirectPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

export const auHomeAffairsDiscovery: PortalDiscoveryStrategy = {
  portalId: 'au-immiaccount',
  async discover(landingUrl, http: FetchLike = defaultHttp) {
    // A non-PDF sourceUrl means the FormSpec was written against the old
    // landing-page assumption. Refuse rather than guess — the refresh job
    // records the failure and the applicant keeps the official link.
    if (!isDirectPdfUrl(landingUrl)) return null;
    try {
      const res = await http(landingUrl);
      if (!res.ok) return null;
      const type = res.headers.get('content-type') ?? '';
      if (!/pdf/i.test(type)) return null;
      return { pdfUrl: landingUrl, versionLabel: null };
    } catch {
      return null;
    }
  },
};
