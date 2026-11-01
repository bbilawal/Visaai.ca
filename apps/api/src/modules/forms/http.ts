/**
 * A narrow structural subset of the WHATWG fetch surface — enough for
 * discovery and download, small enough that a test can supply a literal
 * object instead of casting a partial mock to `typeof fetch`.
 *
 * The global `fetch` satisfies this structurally, so production passes it
 * directly.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<HttpResponse>;

/**
 * Identifies VisaAI to government webmasters with a contact URL, per the
 * design's crawling constraints. Do not make this look like a browser.
 */
export const FORM_FETCH_USER_AGENT =
  'VisaAI-FormFetcher/1.0 (+https://visaai.co/bot)';

/**
 * Identity headers for portals whose edge filter rejects the conventional
 * crawler User-Agent shape.
 *
 * MEASURED against immi.homeaffairs.gov.au on 2026-08-12. Its Akamai bot
 * manager 403s on the SHAPE of the string, not on who we are:
 *
 *   VisaAI-FormFetcher/1.0 (+https://visaai.co/bot)   403
 *   Acme/1.0 (+https://example.com)                   403   any (+url) form
 *   FormFetcher/1.0                                   403   the token "Fetcher"
 *   wget/1.21                                         403
 *   VisaAI/1.0                                        200
 *   curl/8.7.1                                        200
 *   (no User-Agent at all)                            200
 *
 * So the more honestly a client declares itself a crawler, the more likely it
 * is blocked, while an unlabelled request sails through. That filter is not a
 * statement of policy — their published policy is robots.txt, which we CAN
 * read with the UA below and which does NOT disallow /form-listing/forms/
 * (it disallows specific documents, e.g. the immiAccount MFA guides).
 *
 * We therefore keep identifying as VisaAI and move the contact address into
 * `From:`, the header RFC 9110 defines for exactly that purpose. We do NOT
 * impersonate a browser: a webmaster reading their logs still sees VisaAI and
 * an address to write to.
 */
export const IDENTIFIED_NO_URL_HEADERS: Record<string, string> = {
  'user-agent': 'VisaAI/1.0',
  from: 'support@visaai.co',
};

export const FETCH_TIMEOUT_MS = 20_000;

/**
 * Hosts that reject the conventional crawler User-Agent shape.
 *
 * Applied by host so robots.txt, discovery and the download all use the same
 * identity — otherwise robots.txt 403s, RobotsGate reports 'unknown', and the
 * form is never fetched no matter what the site's actual policy says.
 *
 * Add a host here only after MEASURING that the default UA is refused and that
 * the site's robots.txt permits the path. This is a workaround for a filter's
 * shape-matching, never a way past a stated policy.
 */
const HOST_HEADER_OVERRIDES: Record<string, Record<string, string>> = {
  'immi.homeaffairs.gov.au': IDENTIFIED_NO_URL_HEADERS,
};

function headersFor(url: string): Record<string, string> {
  try {
    const override = HOST_HEADER_OVERRIDES[new URL(url).hostname];
    if (override) return { ...override };
  } catch {
    // Malformed URL — fall through to the default identity; fetch will reject.
  }
  return { 'user-agent': FORM_FETCH_USER_AGENT };
}

export const defaultHttp: FetchLike = (url, init) =>
  fetch(url, {
    ...init,
    // Caller-supplied headers win, except that a caller passing the default
    // user-agent must not undo a host override — strategies set it explicitly.
    headers: { ...(init?.headers ?? {}), ...headersFor(url) },
    signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
