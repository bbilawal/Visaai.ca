import { FormRefreshService, FORM_HTTP } from './form-refresh.service';
import { RobotsGate } from './robots';
import { FormTemplateStore } from './form-template.store';
import { TemplateRevisionStore } from './template-revision.store';
import type { FetchLike, HttpResponse } from './http';
import '../../strategies';

/**
 * Counts the requests a refresh run actually makes.
 *
 * This test exists because the first attempt at the rate-limit fix (commit
 * 6cb25d5) threaded a memo through this service and then never read it — the
 * call site had been reformatted, so the edit silently did not apply. The
 * document half was fixed and the form half was not, and every existing test
 * still passed because none of them counted requests. Asserting the COUNT is
 * the only thing that catches it.
 */

function res(body: string, contentType = 'text/html'): HttpResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

const store = {
  find: () => Promise.resolve(null),
  upsert: () => Promise.resolve(),
  putBytes: () => Promise.resolve(),
} as unknown as FormTemplateStore;

const revisions = {
  record: () => Promise.resolve(),
} as unknown as TemplateRevisionStore;

describe('form refresh discovery memo', () => {
  it('fetches each landing page once per run, not once per catalog entry', async () => {
    const landingHits = new Map<string, number>();
    const http: FetchLike = (url) => {
      if (url.endsWith('/robots.txt')) {
        return Promise.resolve(res('User-agent: *\nDisallow:', 'text/plain'));
      }
      if (url.endsWith('.pdf')) {
        // Not a real PDF body: the run degrades after download, which is fine.
        // What this test measures is how many times each PAGE was requested.
        return Promise.resolve(res('', 'application/pdf'));
      }
      landingHits.set(url, (landingHits.get(url) ?? 0) + 1);
      return Promise.resolve(
        res('<a href="https://example.gov/doc.pdf">form</a>'),
      );
    };

    const svc = new FormRefreshService(
      store,
      new RobotsGate(http),
      http,
      revisions,
    );

    await svc.refreshAll();

    // The Schengen application form is ONE page shared by 29 member states x 2
    // programs. Anything above 1 here is the shape that earned us an HTTP 429
    // from the European Commission on 2026-08-13.
    for (const [url, hits] of landingHits) {
      expect(`${url} fetched ${hits}x`).toBe(`${url} fetched 1x`);
    }
    expect(landingHits.size).toBeGreaterThan(0);
  });
});

// Keeps the FORM_HTTP token referenced so an import-only regression (the token
// being dropped from the module) still shows up as a compile error here.
void FORM_HTTP;
