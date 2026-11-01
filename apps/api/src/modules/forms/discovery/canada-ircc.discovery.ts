import { defaultHttp, FORM_FETCH_USER_AGENT, type FetchLike } from '../http';
import type {
  DiscoveredForm,
  PortalDiscoveryStrategy,
} from './discovery.types';

/**
 * canada.ca / IRCC.
 *
 * The landing URL (…/application-forms-guides/imm5257.html) is stable; the PDF
 * it links to is not — IRCC puts the revision date in the path
 * (…/forms/imm5257/01-09-2023/imm5257e.pdf), so a hardcoded deep link rots
 * silently at the next revision. That is exactly what happened to
 * modules/prefill/forms/imm5257.ts, whose URL now returns text/html.
 *
 * The link sits in server-rendered HTML, so a regex over the body is
 * sufficient and a headless browser would buy nothing.
 */
/** A path segment like 01-09-2023 or 2023-09-01 — IRCC's revision marker. */
const DATED_SEGMENT = /^\d{2,4}-\d{2}-\d{2,4}$/;

/** 'IMM 5257' -> 'imm5257' — matches how IRCC names its PDF files. */
function normalizeFormCodeForMatch(code: string): string {
  return code.toLowerCase().replace(/\s+/g, '');
}

/**
 * `formCode`, when given, disambiguates a page that links to more than one
 * PDF (a nav/brochure link above the actual form): the chosen href must
 * contain the normalized form code, or discovery returns null rather than
 * guessing (Important 5). Without a formCode, the first PDF href wins — the
 * historical behaviour, unchanged so existing callers keep working.
 */
export function extractPdfLink(
  html: string,
  landingUrl: string,
  formCode?: string,
): DiscoveredForm | null {
  const hrefs: string[] = [];
  const HREF_PDF_G = /href\s*=\s*"([^"]+\.pdf)"/gi;
  let m: RegExpExecArray | null;
  while ((m = HREF_PDF_G.exec(html))) {
    hrefs.push(m[1]);
  }
  if (hrefs.length === 0) return null;

  let chosen: string;
  if (formCode) {
    const needle = normalizeFormCodeForMatch(formCode);
    const match = hrefs.find((h) => h.toLowerCase().includes(needle));
    if (!match) return null;
    chosen = match;
  } else {
    chosen = hrefs[0];
  }

  let pdfUrl: string;
  try {
    pdfUrl = new URL(chosen, landingUrl).toString();
  } catch {
    return null;
  }

  const segments = new URL(pdfUrl).pathname.split('/');
  const versionLabel = segments.find((s) => DATED_SEGMENT.test(s)) ?? null;

  return { pdfUrl, versionLabel };
}

export const canadaIrccDiscovery: PortalDiscoveryStrategy = {
  portalId: 'ircc',
  async discover(landingUrl, http: FetchLike = defaultHttp, formCode?: string) {
    try {
      const res = await http(landingUrl, {
        headers: { 'user-agent': FORM_FETCH_USER_AGENT },
      });
      if (!res.ok) return null;
      return extractPdfLink(await res.text(), landingUrl, formCode);
    } catch {
      return null;
    }
  },
};
