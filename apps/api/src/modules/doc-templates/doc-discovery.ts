import { FORM_FETCH_USER_AGENT, type FetchLike } from '../forms/http';
import type { DocumentTemplateSpec } from '../../strategies/types';

export interface DiscoveredDocument {
  /** Absolute URL of the current PDF. */
  pdfUrl: string;
  /** Revision marker taken from the path, e.g. '01-05-2026'. Null when none. */
  versionLabel: string | null;
}

/**
 * One discovery routine for every portal, driven by the SPEC instead of by a
 * per-portal strategy.
 *
 * WHY NOT REUSE PortalDiscoveryStrategy
 *
 * Those strategies answer one question — "where is THE application form for
 * this portal?" — and each encodes an assumption that only holds for that
 * question: the IRCC one matches a form code inside the filename, the EU one
 * hardcodes the words "visa application form", the USCIS one demands the
 * filename be exactly the form number. Every one of those would return the
 * WRONG file for a document checklist on the same portal (asking canada.ca for
 * IMM 5484 via the form strategy works; asking the EU page for the photograph
 * guidelines returns the application form, silently).
 *
 * The artifacts here are heterogeneous by nature, so the disambiguator belongs
 * on the artifact, not on the portal. `spec.match` carries it, and the
 * fallback — derive a filename hint from templateCode — reproduces the IRCC
 * rule that already works ('IMM 5484' → 'imm5484' → imm5484e.pdf).
 *
 * The rule is FAIL CLOSED throughout: if nothing matches, return null. Never
 * "the first PDF on the page". A page that changed under us must degrade to
 * the official link, never to the wrong document served under the right name.
 */

/** A path segment like 01-05-2026 or 2026-05-01 — IRCC's revision marker. */
const DATED_SEGMENT = /^\d{2,4}-\d{2}-\d{2,4}$/;

/** 'IMM 5484' -> 'imm5484'; 'I-130INSTR' -> 'i-130instr'. */
export function filenameHint(templateCode: string): string {
  return templateCode.trim().toLowerCase().replace(/\s+/g, '');
}

export function isDirectPdfUrl(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

/**
 * The filename a link points at, including the `?filename=` form the European
 * Commission uses (its hrefs are /document/download/<uuid>_en?filename=x.pdf,
 * so the path alone carries no name at all).
 */
export function filenameOf(href: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(href);
    } catch {
      return href;
    }
  })();
  const fromQuery = /[?&]filename=([^&]+)/i.exec(decoded);
  if (fromQuery) return fromQuery[1].toLowerCase();
  return decoded.split('?')[0].split('/').pop()?.toLowerCase() ?? '';
}

export function extractDocumentLink(
  html: string,
  landingUrl: string,
  spec: Pick<DocumentTemplateSpec, 'templateCode' | 'match'>,
): DiscoveredDocument | null {
  const hrefs = [...html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)].map(
    (m) => m[1],
  );
  if (hrefs.length === 0) return null;

  const want =
    spec.match?.filename?.toLowerCase() ?? filenameHint(spec.templateCode);
  // `exact` is for portals that publish a family of near-identical filenames
  // (USCIS: i-130.pdf, i-130a.pdf, i-130instr.pdf). Substring is for portals
  // that decorate the name (IRCC: imm5484e.pdf; EC: icao_photograph_guidelines_en.pdf).
  const exact = spec.match?.exact === true;
  const chosen = hrefs.find((h) => {
    const file = filenameOf(h);
    return exact ? file === want : file.includes(want);
  });
  if (!chosen) return null;

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

/**
 * Per-run memo of what has already been fetched.
 *
 * WHY THIS EXISTS — MEASURED IN PRODUCTION, 2026-08-13
 *
 * The download dedupe in the refresh service is keyed by the RESOLVED pdf url,
 * which discovery has to run to produce. So the landing page was fetched once
 * per catalog entry even when 58 entries name the same page: the European
 * Commission answered HTTP 429 and every Schengen photograph-specification row
 * failed on the first production run.
 *
 * The memo is the PAGE, not the resolution. That distinction is the whole
 * point: a USCIS landing page serves FOUR different specs (i-130.pdf,
 * i-130a.pdf, i-130instr.pdf and the form itself), so memoising "what this url
 * resolved to" would hand I-130A the instructions booklet. Memoising the HTML
 * and re-running each spec's own match against it is both correct and one
 * request per page.
 *
 * A FAILED fetch is memoised too, deliberately: once a host has rate-limited
 * us, hammering it 57 more times in the same loop is the behaviour that caused
 * the incident.
 */
export interface DiscoveryCache {
  /** landing url → response body, or null when the fetch failed. */
  html: Map<string, string | null>;
  /** direct pdf url → the confirmation result. */
  direct: Map<string, DiscoveredDocument | null>;
}

export function newDiscoveryCache(): DiscoveryCache {
  return { html: new Map(), direct: new Map() };
}

/**
 * Resolve a spec to a downloadable PDF.
 *
 * A spec whose sourceUrl IS the PDF (Home Affairs publishes stable,
 * unversioned form URLs and a JS-rendered index with no hrefs to discover) is
 * confirmed rather than parsed: fetch it, require a PDF content-type, and use
 * it. Everything else is a landing page.
 */
export async function discoverDocument(
  spec: Pick<DocumentTemplateSpec, 'templateCode' | 'match' | 'sourceUrl'>,
  http: FetchLike,
  cache?: DiscoveryCache,
): Promise<DiscoveredDocument | null> {
  if (isDirectPdfUrl(spec.sourceUrl)) {
    if (cache?.direct.has(spec.sourceUrl)) {
      return cache.direct.get(spec.sourceUrl)!;
    }
    let result: DiscoveredDocument | null = null;
    try {
      const res = await http(spec.sourceUrl);
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && /pdf/i.test(type)) {
        result = { pdfUrl: spec.sourceUrl, versionLabel: null };
      }
    } catch {
      result = null;
    }
    cache?.direct.set(spec.sourceUrl, result);
    return result;
  }

  let html: string | null;
  if (cache?.html.has(spec.sourceUrl)) {
    html = cache.html.get(spec.sourceUrl)!;
  } else {
    try {
      const res = await http(spec.sourceUrl, {
        headers: { 'user-agent': FORM_FETCH_USER_AGENT },
      });
      html = res.ok ? await res.text() : null;
    } catch {
      html = null;
    }
    cache?.html.set(spec.sourceUrl, html);
  }
  if (html === null) return null;

  return extractDocumentLink(html, spec.sourceUrl, spec);
}
