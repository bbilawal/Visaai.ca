import { defaultHttp, FORM_FETCH_USER_AGENT, type FetchLike } from '../http';
import type {
  DiscoveredForm,
  PortalDiscoveryStrategy,
} from './discovery.types';

/**
 * European Commission — the harmonised Schengen visa application form.
 *
 * WHY THIS PORTAL NEEDS ITS OWN STRATEGY
 *
 * The IRCC strategy takes the first `.pdf` href on the page, optionally
 * preferring one whose filename contains the form code. Neither rule works
 * here, and the failure would be silent:
 *
 *   1. The landing page carries FIVE PDFs and the form is THIRD in document
 *      order, behind `annex_7a_atv_common_list_en.pdf` (the airport-transit
 *      common list). First-match would cache a policy annex as the visa
 *      application form.
 *   2. The form's filename is "Visa Application Form.pdf". It contains no form
 *      code, so code-matching cannot rescue it either.
 *
 * So this strategy matches on the filename itself. Measured against the live
 * page on 2026-08-12: the link is
 * `/document/download/<uuid>_en?filename=Visa%20Application%20Form.pdf`.
 *
 * ONE FORM, TWENTY-NINE COUNTRIES
 *
 * The form is laid down in Annex I of the Visa Code (Regulation (EC)
 * No 810/2009) and is identical across every member state by law, so one
 * cached copy serves all of them. Member states also host their own copies on
 * individual consulate sites, but those are per-jurisdiction and often
 * bilingual for one market — the Commission's copy is the neutral canonical
 * one.
 *
 * Measured: 200 application/pdf, ~291 KB, 4 pages, 0 AcroForm fields. It is a
 * flat PDF, so capability probes as `unknown` and delivery serves the blank
 * form with prefillable=false. That is correct, not a degradation.
 */

/** The document-download link whose filename is the application form itself. */
const FORM_HREF =
  /href="([^"]*document\/download\/[^"]*filename=[^"]*visa[^"]*application[^"]*form[^"]*\.pdf)"/i;

/**
 * The Commission versions this document by UUID rather than by a dated path,
 * so there is no label to extract. Revision detection falls back to the
 * sha256 the refresh job already computes.
 */
export function extractEuFormLink(
  html: string,
  landingUrl: string,
): DiscoveredForm | null {
  const m = FORM_HREF.exec(html);
  if (!m) return null;
  try {
    return { pdfUrl: new URL(m[1], landingUrl).toString(), versionLabel: null };
  } catch {
    return null;
  }
}

export const euHomeAffairsDiscovery: PortalDiscoveryStrategy = {
  portalId: 'schengen-consulate',
  async discover(landingUrl, http: FetchLike = defaultHttp) {
    try {
      const res = await http(landingUrl, {
        headers: { 'user-agent': FORM_FETCH_USER_AGENT },
      });
      if (!res.ok) return null;
      return extractEuFormLink(await res.text(), landingUrl);
    } catch {
      return null;
    }
  },
};
