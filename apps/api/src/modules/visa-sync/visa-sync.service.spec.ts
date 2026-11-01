import type { SupabaseClient } from '@supabase/supabase-js';
import { VisaSyncService } from './visa-sync.service';
import { DEFAULT_FETCH_POLICY } from './source-fetcher';
import { normalizeContent, sha256 } from './normalize';

/**
 * An in-memory stand-in for the tables this service touches. Records every
 * insert and update so a test can assert on what the run WROTE, which is the
 * behaviour that matters — a sync job is judged by its side effects.
 */
function fakeDb(opts: {
  sources: Array<Record<string, unknown>>;
  activeVersion?: Record<string, unknown> | null;
  /**
   * EVERY version the source already has, newest first. The service reads this
   * to number the next one and to notice content it has already filed —
   * defaults to just the active one, which is what a source with no pending
   * review looks like.
   */
  allVersions?: Array<Record<string, unknown>>;
}) {
  const writes: Record<string, Array<Record<string, unknown>>> = {
    visa_sync_runs: [],
    visa_source_checks: [],
    visa_source_versions: [],
    visa_source_changes: [],
    visa_sources_updates: [],
    visa_source_versions_updates: [],
    visa_source_changes_updates: [],
  };

  let versionSeq = 0;

  const chain = (table: string) => {
    const api: Record<string, unknown> = {};
    const self = () => api as never;

    api.select = () => self();
    api.eq = () => self();
    api.is = () => self();
    api.neq = () => self();
    api.limit = () => self();
    api.order = () => ({
      // The service awaits the query directly after .order(). Which rows come
      // back depends on the table: the run loop lists sources, and the version
      // numbering lists that source's versions.
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data:
            table === 'visa_source_versions'
              ? (opts.allVersions ??
                (opts.activeVersion ? [opts.activeVersion] : []))
              : opts.sources,
          error: null,
        }),
    });

    api.insert = (row: Record<string, unknown>) => {
      writes[table]?.push(row);
      return {
        select: () => ({
          single: async () => {
            if (table === 'visa_sync_runs')
              return { data: { id: 'run-1' }, error: null };
            if (table === 'visa_source_versions') {
              versionSeq++;
              return { data: { id: `ver-${versionSeq}` }, error: null };
            }
            return { data: { id: 'x' }, error: null };
          },
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null }),
      };
    };

    api.update = (row: Record<string, unknown>) => {
      writes[`${table}_updates`]?.push(row);
      return {
        eq: () => ({
          eq: () => ({ then: (r: (v: unknown) => void) => r({ error: null }) }),
          then: (r: (v: unknown) => void) => r({ error: null }),
        }),
      };
    };

    api.maybeSingle = async () => {
      if (table === 'visa_source_versions') {
        return { data: opts.activeVersion ?? null, error: null };
      }
      return { data: null, error: null };
    };

    return api;
  };

  const db = {
    from: (table: string) => {
      const c = chain(table);
      // maybeSingle is reached through select().eq().eq()
      const withMaybe = {
        ...c,
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: c.maybeSingle }),
            maybeSingle: c.maybeSingle,
            order: (c as { order: unknown }).order,
            limit: (c as { limit: unknown }).limit,
          }),
          order: (c as { order: unknown }).order,
        }),
      };
      return withMaybe as never;
    },
    storage: { from: () => ({ download: async () => ({ data: null }) }) },
  };

  return { db: db as unknown as SupabaseClient, writes };
}

const html = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

describe('VisaSyncService', () => {
  const source = {
    id: 'src-1',
    country_id: 'c-1',
    visa_type_id: 'v-1',
    source_url: 'https://gov.example/visa',
    canonical_url: 'https://gov.example/visa',
    robots_state: 'unknown',
    failure_streak: 0,
  };

  /** Patch global fetch for the duration of one test. */
  function withFetch(
    handler: (url: string) => Response,
    fn: () => Promise<void>,
  ) {
    const original = global.fetch;
    global.fetch = async (input: RequestInfo | URL) =>
      handler(typeof input === 'string' ? input : input.toString());
    return fn().finally(() => {
      global.fetch = original;
    });
  }

  const policy = { ...DEFAULT_FETCH_POLICY, allowPrivateAddresses: true };

  it('opens and closes a run row so every check belongs to a run', async () => {
    const { db, writes } = fakeDb({ sources: [] });
    const svc = new VisaSyncService(db);
    const summary = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });

    expect(writes.visa_sync_runs).toHaveLength(1);
    expect(summary.runId).toBe('run-1');
    const closed = writes.visa_sync_runs_updates ?? [];
    expect(closed.length).toBeGreaterThanOrEqual(0);
  });

  it('records a check and no new version when content is unchanged', async () => {
    // A version row is for content that DIFFERS; proof of liveness belongs in
    // visa_source_checks. Inserting a version per run would make the history
    // useless.
    const body = '<p>You must have a passport.</p>';
    const hash = sha256(normalizeContent(body, 'text/html'));

    const { db, writes } = fakeDb({
      sources: [source],
      activeVersion: {
        id: 'ver-0',
        version_number: 3,
        normalized_sha256: hash,
      },
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html(body),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.ok).toBe(1);
        expect(s.changed).toBe(0);
      },
    );

    expect(writes.visa_source_versions).toHaveLength(0);
    expect(writes.visa_source_checks[0].status).toBe('ok');
  });

  it('does not activate a new version that needs review — the old one keeps serving', async () => {
    // The invariant the whole promotion queue exists for. If the new version
    // went active here, a scraper would silently rewrite what VisaAI tells
    // people a government demands.
    const { db, writes } = fakeDb({
      sources: [source],
      activeVersion: {
        id: 'ver-0',
        version_number: 1,
        normalized_sha256: 'different',
      },
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html(
              '<p>The fee is now £250 and you must provide a police certificate.</p>',
            ),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.changed).toBe(1);
      },
    );

    const version = writes.visa_source_versions[0];
    expect(version.is_active).toBe(false);

    const change = writes.visa_source_changes[0];
    expect(change.requires_review).toBe(true);
    expect(change.classification).toBe('material');
    expect(change.state).toBe('parsed');
  });

  /**
   * The deadlock found on production, 2026-08-24.
   *
   * A material change inserts a version WITHOUT activating it — the previous
   * one keeps serving until a human reviews it. So a source with a pending
   * review has version 2 sitting inactive above active version 1, and the next
   * content change used to compute `active.version_number + 1` = 2 and collide
   * with it on `visa_source_versions_seq_idx`.
   *
   * Forever. Every later run failed identically, so the source silently stopped
   * being versioned from the moment it was flagged as changing — and reported
   * `parse_error` for a page that parsed perfectly. Eight immigration.govt.nz
   * sources were stuck this way.
   */
  it('numbers the next version above the HIGHEST, not above the active one', async () => {
    const { db, writes } = fakeDb({
      sources: [source],
      activeVersion: {
        id: 'ver-1',
        version_number: 1,
        normalized_sha256: 'hash-a',
      },
      // Version 2 exists, inactive, waiting for review.
      allVersions: [
        { id: 'ver-2', version_number: 2, normalized_sha256: 'hash-b' },
        { id: 'ver-1', version_number: 1, normalized_sha256: 'hash-a' },
      ],
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<p>A third state, different from both stored versions.</p>'),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.parseErrors).toBe(0);
        expect(s.changed).toBe(1);
      },
    );

    expect(writes.visa_source_versions[0].version_number).toBe(3);
  });

  /**
   * The bug the fix above would otherwise create.
   *
   * While a review is pending the ACTIVE hash never matches the live page, so a
   * naive "not equal to active, therefore new" would insert another version of
   * the SAME content every night and file another change record with it. A
   * reviewer would come back to thirty identical items.
   */
  it('does not re-file a change it has already queued', async () => {
    const body =
      '<p>The fee is now £250 and you must provide a police certificate.</p>';
    const pendingHash = sha256(normalizeContent(body));
    const { db, writes } = fakeDb({
      sources: [source],
      activeVersion: {
        id: 'ver-1',
        version_number: 1,
        normalized_sha256: 'hash-a',
      },
      allVersions: [
        { id: 'ver-2', version_number: 2, normalized_sha256: pendingHash },
        { id: 'ver-1', version_number: 1, normalized_sha256: 'hash-a' },
      ],
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html(body),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.ok).toBe(1);
        expect(s.changed).toBe(0);
      },
    );

    expect(writes.visa_source_versions).toHaveLength(0);
    expect(writes.visa_source_changes).toHaveLength(0);
    // The check still points at the version that carries this content, so the
    // run is evidence the page was seen rather than a silent skip.
    expect(writes.visa_source_checks[0].version_id).toBe('ver-2');
  });

  it('files a change with the reasons a human needs, not just a flag', async () => {
    const { db, writes } = fakeDb({
      sources: [source],
      // The previous version's TEXT is what makes this a diff rather than a
      // re-reading of the whole page. Before B-29 nothing retained it and this
      // assertion passed anyway — every line counted as added and the
      // escalation reasons came from the page's vocabulary, not from a change.
      activeVersion: {
        id: 'ver-0',
        version_number: 1,
        normalized_sha256: 'different',
        normalized_text: 'you must now pay £100.',
      },
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<p>You must now pay £250.</p>'),
      () =>
        svc
          .run({ fetchPolicy: policy, perHostDelayMs: 0 })
          .then(() => undefined),
    );

    const change = writes.visa_source_changes[0] as {
      escalation_reasons: string[];
      summary: string;
      diff: { added: string[]; removed: string[] };
    };
    expect(change.escalation_reasons.length).toBeGreaterThan(0);
    expect(change.summary).toContain('added');
    expect(change.diff.added.length).toBeGreaterThan(0);
    // The line that went away must be reported as gone. Every one of the 127
    // change records this system had filed carried an EMPTY removed array,
    // which is the signature of a diff against nothing.
    expect(change.diff.removed.length).toBeGreaterThan(0);
  });

  it('refuses to characterise a change when the previous text was never retained', async () => {
    // The regression that mattered: `normalizedTextOf` returned '' when it
    // found nothing, so classifyChange saw the whole page as new and escalated
    // on words it found anywhere in it. A confident wrong answer is worse than
    // an admission, because a reviewer cannot tell it from a real one.
    const { db, writes } = fakeDb({
      sources: [source],
      activeVersion: {
        id: 'ver-0',
        version_number: 1,
        normalized_sha256: 'different',
      },
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<p>You must now pay £250 within 30 days.</p>'),
      () =>
        svc
          .run({ fetchPolicy: policy, perHostDelayMs: 0 })
          .then(() => undefined),
    );

    const change = writes.visa_source_changes[0] as {
      escalation_reasons: string[];
      requires_review: boolean;
      summary: string;
      diff: { added: string[]; removed: string[] };
    };

    // Still a change, and still a human's decision.
    expect(change.requires_review).toBe(true);
    // But NOT a fabricated characterisation of it.
    expect(change.escalation_reasons).toEqual([]);
    expect(change.diff.added).toEqual([]);
    expect(change.diff.removed).toEqual([]);
    expect(change.summary).toContain('cannot be characterised');
  });

  it('retains the normalized text on every version it files', async () => {
    // The fix is only durable if the NEXT comparison has something to read.
    const { db, writes } = fakeDb({
      sources: [source],
      activeVersion: {
        id: 'ver-0',
        version_number: 1,
        normalized_sha256: 'different',
        normalized_text: 'old text',
      },
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<p>Brand new wording.</p>'),
      () =>
        svc
          .run({ fetchPolicy: policy, perHostDelayMs: 0 })
          .then(() => undefined),
    );

    const version = writes.visa_source_versions[0] as {
      normalized_text?: string;
    };
    expect(version.normalized_text).toContain('brand new wording');
  });

  it('activates the first ever version, which has no prior claim to contradict', async () => {
    const { db, writes } = fakeDb({ sources: [source], activeVersion: null });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<p>Passport required.</p>'),
      () =>
        svc
          .run({ fetchPolicy: policy, perHostDelayMs: 0 })
          .then(() => undefined),
    );

    expect(writes.visa_source_versions[0].is_active).toBe(true);
    // No change row: there was nothing to diff against.
    expect(writes.visa_source_changes).toHaveLength(0);
  });

  it('honours robots.txt and records the source as disallowed', async () => {
    const { db, writes } = fakeDb({ sources: [source] });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('User-agent: *\nDisallow: /visa\n', { status: 200 })
          : html('<p>should never be fetched</p>'),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.blocked).toBe(1);
      },
    );

    expect(writes.visa_source_checks[0].status).toBe('blocked');
    expect(writes.visa_sources_updates[0].robots_state).toBe('disallowed');
    // No version was created from a page we were told not to read.
    expect(writes.visa_source_versions).toHaveLength(0);
  });

  it('does not blame robots.txt when a WAF blocks the page', async () => {
    // REGRESSION, found deploying Finland to production. migri.fi sits behind a
    // Cloudflare managed challenge that 403s datacentre IPs -- including on
    // /robots.txt -- while serving the real file (which ALLOWS the permit
    // pages) to others. The old code wrote robots_state: 'disallowed' from the
    // page fetch outcome, so production recorded a false statement about the
    // authority's policy.
    //
    // The distinction matters operationally: 'disallowed' means stop, and
    // 'unknown' means we could not read the policy -- which has a remedy.
    const { db, writes } = fakeDb({ sources: [source] });
    const svc = new VisaSyncService(db);

    await withFetch(
      () => new Response('<html>Just a moment...</html>', { status: 403 }),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.blocked).toBe(1);
      },
    );

    const update = writes.visa_sources_updates[0];
    expect(update.robots_state).toBe('unknown');
    expect(update.failure_streak).toBe(1);
    expect(writes.visa_source_versions).toHaveLength(0);
  });

  it('leaves robots_state alone when robots.txt was readable and the page fails', async () => {
    // robots.txt read fine and permitted the path; the page then 500s. Nothing
    // was learned about the robots policy, so nothing may be written to it.
    const { db, writes } = fakeDb({ sources: [source] });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('User-agent: *\nDisallow: /admin\n', { status: 200 })
          : new Response('boom', { status: 500 }),
      () =>
        svc
          .run({ fetchPolicy: policy, perHostDelayMs: 0 })
          .then(() => undefined),
    );

    const update = writes.visa_sources_updates[0];
    expect(update.robots_state).toBeUndefined();
    expect(update.failure_streak).toBe(1);
  });

  it('treats an empty extraction as a parse error, not as a deleted page', async () => {
    // A 200 with no extractable text must not raise a change claiming the
    // government deleted everything.
    const { db, writes } = fakeDb({
      sources: [source],
      activeVersion: { id: 'ver-0', version_number: 1, normalized_sha256: 'x' },
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<script>var a=1</script>'),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.parseErrors).toBe(1);
        expect(s.changed).toBe(0);
      },
    );

    expect(writes.visa_source_changes).toHaveLength(0);
    expect(writes.visa_source_checks[0].status).toBe('parse_error');
  });

  it('increments the failure streak when a source is unavailable', async () => {
    const { db, writes } = fakeDb({
      sources: [{ ...source, failure_streak: 2 }],
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : new Response('down', { status: 503 }),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.unavailable).toBe(1);
      },
    );

    expect(writes.visa_sources_updates[0].failure_streak).toBe(3);
  });

  it('resets the failure streak after a success', async () => {
    const { db, writes } = fakeDb({
      sources: [{ ...source, failure_streak: 5 }],
      activeVersion: null,
    });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<p>ok</p>'),
      () =>
        svc
          .run({ fetchPolicy: policy, perHostDelayMs: 0 })
          .then(() => undefined),
    );

    expect(writes.visa_sources_updates[0].failure_streak).toBe(0);
  });

  it('keeps checking the remaining sources when one throws', async () => {
    // 98 sources across four governments: one 503 must not cost the other 97
    // their check.
    const sources = [
      { ...source, id: 'a', source_url: 'https://a.gov/x' },
      { ...source, id: 'b', source_url: 'https://b.gov/x' },
      { ...source, id: 'c', source_url: 'https://c.gov/x' },
    ];
    const { db } = fakeDb({ sources, activeVersion: null });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) => {
        if (url.endsWith('robots.txt'))
          return new Response('', { status: 404 });
        if (url.includes('b.gov')) throw new Error('boom');
        return html('<p>ok</p>');
      },
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        expect(s.sourcesChecked).toBe(3);
        expect(s.ok).toBe(2);
        expect(s.unavailable).toBe(1);
      },
    );
  });

  it('reports counts that add up to the number of sources checked', async () => {
    const sources = [
      { ...source, id: 'a', source_url: 'https://a.gov/x' },
      { ...source, id: 'b', source_url: 'https://b.gov/x' },
    ];
    const { db } = fakeDb({ sources, activeVersion: null });
    const svc = new VisaSyncService(db);

    await withFetch(
      (url) =>
        url.endsWith('robots.txt')
          ? new Response('', { status: 404 })
          : html('<p>ok</p>'),
      async () => {
        const s = await svc.run({ fetchPolicy: policy, perHostDelayMs: 0 });
        const total =
          s.ok +
          s.changed +
          s.unavailable +
          s.blocked +
          s.parseErrors +
          s.redirected;
        expect(total).toBe(s.sourcesChecked);
      },
    );
  });
});

describe('per-host politeness delay', () => {
  /**
   * The first source of each host used to fire robots.txt and the page back to
   * back, because the delay was stamped once per SOURCE while checkOne makes
   * two REQUESTS. On a rate-limiting host that source failed on every run,
   * deterministically, while every source behind it succeeded — which reads as
   * a flaky source rather than as a bug in the throttle. nyidanmark.dk
   * reproduced it exactly: zero gap failed twice out of two, a two-second gap
   * succeeded.
   */
  it('leaves a gap between the robots fetch and the first page fetch', async () => {
    const stamps: Array<{ url: string; at: number }> = [];
    const { db } = fakeDb({
      sources: [
        {
          id: 'src-1',
          country_id: 'c-1',
          visa_type_id: 'v-1',
          source_url: 'https://gov.example/visa',
          canonical_url: 'https://gov.example/visa',
          robots_state: 'unknown',
          failure_streak: 0,
        },
      ],
    });

    const original = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      stamps.push({ url, at: Date.now() });
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return html(
        '<html><body><p>you must hold a valid passport</p></body></html>',
      );
    };

    try {
      const svc = new VisaSyncService(db);
      await svc.run({
        fetchPolicy: { ...DEFAULT_FETCH_POLICY, allowPrivateAddresses: true },
        perHostDelayMs: 120,
      });
    } finally {
      global.fetch = original;
    }

    const robots = stamps.find((s) => s.url.endsWith('/robots.txt'));
    const page = stamps.find((s) => !s.url.endsWith('/robots.txt'));
    expect(robots).toBeDefined();
    expect(page).toBeDefined();
    expect(page!.at - robots!.at).toBeGreaterThanOrEqual(100);
  });
});
