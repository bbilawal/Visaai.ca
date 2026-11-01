import type { FetchLike } from '../http';

export interface DiscoveredForm {
  /** Absolute URL of the current PDF. Versioned; changes when IRCC revises. */
  pdfUrl: string;
  /** Revision marker, e.g. '01-09-2023'. Null when the portal exposes none. */
  versionLabel: string | null;
}

/**
 * One per government portal.
 *
 * `http` is injected rather than imported so a portal that needs a headless
 * browser can be added later without changing this interface — a Playwright
 * strategy would ignore the parameter and drive a page instead. canada.ca
 * serves the link in plain HTML, so nothing needs that today. The seam exists
 * so the first portal that DOES need it is an added file, not a refactor.
 */
export interface PortalDiscoveryStrategy {
  readonly portalId: string;
  /**
   * `formCode`, when supplied, lets a strategy verify it found the PDF for
   * THIS form rather than trusting "the first PDF link on the page" — a page
   * that links to more than one PDF (e.g. a nav/brochure link above the
   * actual form) would otherwise silently cache the wrong document as 'ok'.
   * Optional so a strategy that has no way to disambiguate (or a page that
   * never has more than one PDF) can ignore it.
   */
  discover(
    landingUrl: string,
    http: FetchLike,
    formCode?: string,
  ): Promise<DiscoveredForm | null>;
}
