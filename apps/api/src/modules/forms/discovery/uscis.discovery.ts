import { defaultHttp, FORM_FETCH_USER_AGENT, type FetchLike } from '../http';
import type {
  DiscoveredForm,
  PortalDiscoveryStrategy,
} from './discovery.types';

/**
 * USCIS (United States).
 *
 * WHY THIS PORTAL NEEDS ITS OWN STRATEGY
 *
 * A USCIS form page publishes the form alongside its instructions and its
 * supplements, and every one of those filenames CONTAINS the form number.
 * Measured on the live /i-130 page (2026-08-12), in document order:
 *
 *   Fact_Sheet_Adoption_in_US_Courts_...pdf   <- unrelated fact sheet
 *   i-130.pdf                                 <- the form
 *   i-130a.pdf                                <- supplemental form, NOT it
 *   i-130instr.pdf                            <- instructions, NOT it
 *
 * So first-match grabs a fact sheet, and the IRCC strategy's "filename
 * contains the form code" rule matches all three of i-130 / i-130a /
 * i-130instr. Today it happens to return the right one only because i-130.pdf
 * is listed first — MEASURED: reorder those three links and that rule returns
 * `i-130instr.pdf`, handing an applicant the instructions booklet labelled as
 * their application form. Correctness must not depend on the page's link
 * order, so this strategy does not use a substring test.
 *
 * This strategy requires the filename to be the form number EXACTLY —
 * `i-130.pdf`, never `i-130a.pdf` or `i-130instr.pdf`.
 *
 * NOTE ON PARSING: the live I-130 loads in pdf-lib but throws from
 * getPageCount(), the same shape as IRCC's IMM 5645. The probe reports
 * `parsed: true, capability: 'unknown'`, so it caches correctly and is served
 * as a blank download with prefillable=false.
 */

/** 'I-130' -> 'i-130'; 'I 130' -> 'i-130'. */
function normalize(formCode: string): string {
  return formCode.trim().toLowerCase().replace(/\s+/g, '-');
}

export function extractUscisFormLink(
  html: string,
  landingUrl: string,
  formCode?: string,
): DiscoveredForm | null {
  const hrefs = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => m[1]);
  if (hrefs.length === 0) return null;

  let chosen: string | undefined;
  if (formCode) {
    const want = `${normalize(formCode)}.pdf`;
    // Exact filename match only. A substring test would also accept
    // i-130a.pdf and i-130instr.pdf.
    chosen = hrefs.find((h) => {
      const file = h.split('/').pop()?.split('?')[0]?.toLowerCase();
      return file === want;
    });
    // No exact match means we did not find THIS form. Returning the first PDF
    // instead would cache the wrong document under the right name.
    if (!chosen) return null;
  } else {
    chosen = hrefs[0];
  }

  try {
    // USCIS revises forms by edition date printed inside the PDF, not in the
    // path, so there is no label to extract; sha256 carries revision detection.
    return {
      pdfUrl: new URL(chosen, landingUrl).toString(),
      versionLabel: null,
    };
  } catch {
    return null;
  }
}

export const uscisDiscovery: PortalDiscoveryStrategy = {
  portalId: 'us-ceac-ds160',
  async discover(landingUrl, http: FetchLike = defaultHttp, formCode?: string) {
    try {
      const res = await http(landingUrl, {
        headers: { 'user-agent': FORM_FETCH_USER_AGENT },
      });
      if (!res.ok) return null;
      return extractUscisFormLink(await res.text(), landingUrl, formCode);
    } catch {
      return null;
    }
  },
};
