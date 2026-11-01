import { Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_FETCH_POLICY,
  fetchSource,
  type FetchPolicy,
} from './source-fetcher';
import { isAllowed } from './robots';
import {
  EXTRACTOR_VERSION,
  type ChangeAnalysis,
  classifyChange,
  detectSiteWideChanges,
  looksClientRendered,
  normalizeContent,
  sha256,
} from './normalize';

/**
 * The morning synchronization run.
 *
 * Checks every due official source, versions what it finds, and files a review
 * item for anything that materially changed. It never edits a live requirement:
 * the most it can do is put a row in `visa_source_changes` for a human, or
 * auto-promote a change it has classified as editorial.
 *
 * THREE INVARIANTS, each of which is a way this could go wrong:
 *
 *   1. A government edit never reaches an applicant unreviewed. Material and
 *      structural changes always set requires_review; only editorial ones
 *      auto-promote. Getting this backwards would let a scraper silently
 *      rewrite what VisaAI tells people a government demands.
 *
 *   2. History is append-only. A new version is inserted and the previous one
 *      marked superseded; nothing is updated in place and nothing is deleted.
 *      Without the old version there is no diff, and without the diff there is
 *      no way to tell a fee change from a CSS refresh.
 *
 *   3. A failure degrades one source, never the run. A government site being
 *      down, blocked or slow is the normal case at this scale — 98 sources
 *      across four countries — and one 503 must not cost the other 97 their
 *      check.
 *
 * Politeness is not optional here. robots.txt is evaluated per URL per run, a
 * 403/429 stops that source rather than triggering a retry, and there is a
 * fixed delay between requests to the same host.
 */

export interface SyncOptions {
  trigger?: 'schedule' | 'manual' | 'backfill';
  /** Cap the run. Used by the manual trigger and by tests. */
  limit?: number;
  fetchPolicy?: FetchPolicy;
  /** Milliseconds between requests to the SAME host. */
  perHostDelayMs?: number;
}

export interface SyncSummary {
  runId: string;
  sourcesChecked: number;
  ok: number;
  changed: number;
  unavailable: number;
  blocked: number;
  parseErrors: number;
  /**
   * Pages that served a 200 with no server-rendered text. Counted apart from
   * parseErrors because that bucket means "a VisaAI bug in the parser backlog",
   * and no parser change reads a page whose body is a script mount point.
   */
  clientRendered: number;
  redirected: number;
  changesRaisedForReview: number;
  durationMs: number;
}

interface SourceRow {
  id: string;
  country_id: string;
  visa_type_id: string | null;
  source_url: string;
  canonical_url: string;
  robots_state: string;
  failure_streak: number;
}

interface VersionRow {
  id: string;
  version_number: number;
  normalized_sha256: string;
}

@Injectable()
export class VisaSyncService {
  private readonly log = new Logger(VisaSyncService.name);

  constructor(private readonly db: SupabaseClient) {}

  async run(opts: SyncOptions = {}): Promise<SyncSummary> {
    const startedAt = Date.now();
    const policy = opts.fetchPolicy ?? DEFAULT_FETCH_POLICY;
    const perHostDelayMs = opts.perHostDelayMs ?? 2_000;

    const { data: runRow, error: runErr } = await this.db
      .from('visa_sync_runs')
      .insert({ trigger: opts.trigger ?? 'schedule', status: 'running' })
      .select('id')
      .single();
    if (runErr || !runRow) {
      throw new Error(`could not open a sync run: ${runErr?.message}`);
    }
    const runId = runRow.id;

    const summary: SyncSummary = {
      runId,
      sourcesChecked: 0,
      ok: 0,
      changed: 0,
      unavailable: 0,
      blocked: 0,
      parseErrors: 0,
      clientRendered: 0,
      redirected: 0,
      changesRaisedForReview: 0,
      durationMs: 0,
    };

    try {
      // Oldest check first, so a source that keeps failing cannot starve the
      // rest: it goes to the back of the queue as soon as it is attempted.
      let query = this.db
        .from('visa_sources')
        .select(
          'id, country_id, visa_type_id, source_url, canonical_url, robots_state, failure_streak',
        )
        .eq('active', true)
        .order('last_checked_at', { ascending: true, nullsFirst: true });
      if (opts.limit) query = query.limit(opts.limit);

      const { data: sources, error } = await query;
      if (error) throw new Error(`could not list sources: ${error.message}`);

      const robotsCache = new Map<string, string | null>();
      const lastHitByHost = new Map<string, number>();

      /**
       * Politeness delay, per host rather than global: four countries' sites
       * should not be serialized behind each other.
       *
       * THIS IS PER REQUEST, NOT PER SOURCE, AND THAT DISTINCTION IS A BUG FIX.
       *
       * It used to be stamped once here, before checkOne. But checkOne makes up
       * to TWO requests — robots.txt, then the page — so the first source of
       * each host fired both back to back with no gap at all. On a host that
       * rate-limits, that source failed on EVERY run while the nine behind it
       * succeeded, because they were the only ones the delay actually covered.
       *
       * It presented as a flaky source rather than as a bug: the failure was
       * deterministic per run but attached to whichever source happened to be
       * checked first, and re-running "fixed" nothing because that source was
       * still first. nyidanmark.dk reproduces it exactly — zero gap fails twice
       * out of two, a two-second gap succeeds.
       */
      const waitForHost = async (host: string): Promise<void> => {
        const since = Date.now() - (lastHitByHost.get(host) ?? 0);
        if (since < perHostDelayMs) {
          await new Promise((r) => setTimeout(r, perHostDelayMs - since));
        }
        lastHitByHost.set(host, Date.now());
      };

      for (const source of (sources ?? []) as SourceRow[]) {
        summary.sourcesChecked++;
        try {
          const outcome = await this.checkOne(
            source,
            runId,
            policy,
            robotsCache,
            waitForHost,
          );
          summary[outcome]++;
          if (outcome === 'changed') summary.changesRaisedForReview++;
        } catch (err) {
          // One source's failure is one source's failure.
          this.log.warn(
            `source ${source.id} check threw: ${err instanceof Error ? err.message : 'unknown'}`,
          );
          summary.unavailable++;
        }
      }

      await this.flagSiteWideChanges(runId);

      summary.durationMs = Date.now() - startedAt;
      await this.db
        .from('visa_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: 'completed',
          sources_checked: summary.sourcesChecked,
          ok_count: summary.ok,
          changed_count: summary.changed,
          unavailable_count: summary.unavailable,
          blocked_count: summary.blocked,
          parse_error_count: summary.parseErrors,
          client_rendered_count: summary.clientRendered,
        })
        .eq('id', runId);

      return summary;
    } catch (err) {
      summary.durationMs = Date.now() - startedAt;
      await this.db
        .from('visa_sync_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: 'failed',
          error_message: err instanceof Error ? err.message : 'unknown',
          sources_checked: summary.sourcesChecked,
        })
        .eq('id', runId);
      throw err;
    }
  }

  /**
   * Name the changes that are one site-wide edit seen from several pages.
   *
   * WHY THIS EXISTS
   *
   * A production sync on 2026-08-24 raised EIGHT material changes for review.
   * Every one was `immigration.govt.nz`, every one was "N lines added, 0
   * removed", and every one was flagged for "obligation wording changed",
   * "a duration or deadline changed" or "fee wording changed".
   *
   * Not one requirement had changed. INZ had added a service banner and some
   * navigation to every page:
   *
   *   "planned upgrade ... from 08:00 to 21:00 sunday 23 august (nzst), you
   *    cannot access some applications and online forms"
   *   "call 0508 558 855 (toll free from nz landlines)"
   *
   * "sunday 23 august" trips the duration marker. "toll free" trips the fee
   * marker. All 88 New Zealand excerpts still verified verbatim afterwards.
   *
   * `classifyChange` cannot see this and should not try: it compares ONE page
   * against its own previous version, and from there a banner is
   * indistinguishable from a new obligation. Being conservative there is right
   * — a false 'cosmetic' ships a stale requirement to every applicant.
   *
   * The run, however, CAN see it. A line added to several different sources in
   * one sync is site chrome by construction, and if NOT ONE added line is
   * unique to a page, then nothing on that page's own text changed.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO
   *
   * It does not clear the review, downgrade the classification, or
   * auto-promote. A genuine site-wide policy change — "all applicants must now
   * provide biometrics", added to every page at once — has exactly this shape,
   * and auto-promoting it is the one mistake this whole subsystem exists to
   * prevent. What it does is give the reviewer the fact that turns eight
   * separate investigations into one: these changes are the same edit.
   */
  private async flagSiteWideChanges(runId: string): Promise<void> {
    const { data, error } = await this.db
      .from('visa_source_changes')
      .select('id, source_id, escalation_reasons, diff')
      .eq('run_id', runId);

    if (error || !data || data.length < 2) return;

    for (const flagged of detectSiteWideChanges(data)) {
      await this.db
        .from('visa_source_changes')
        .update({ escalation_reasons: flagged.escalationReasons })
        .eq('id', flagged.id);
    }
  }

  /** Returns the summary key to increment. */
  private async checkOne(
    source: SourceRow,
    runId: string,
    policy: FetchPolicy,
    robotsCache: Map<string, string | null>,
    waitForHost: (host: string) => Promise<void> = async () => {},
  ): Promise<
    | 'ok'
    | 'changed'
    | 'unavailable'
    | 'blocked'
    | 'parseErrors'
    | 'clientRendered'
    | 'redirected'
  > {
    const startedAt = Date.now();
    const url = new URL(source.source_url);
    const origin = `${url.protocol}//${url.host}`;

    // robots.txt is fetched once per host per run and re-evaluated per URL. A
    // cached "disallowed" on the source row is not trusted across runs: an
    // authority that opens up should be picked up the next morning.
    if (!robotsCache.has(origin)) {
      await waitForHost(url.host);
      const r = await fetchSource(`${origin}/robots.txt`, policy);
      robotsCache.set(origin, r.status === 'ok' ? r.body : null);
    }
    const robotsTxt = robotsCache.get(origin) ?? null;
    // Whether we could READ the policy, which is a different question from what
    // the policy says. migri.fi returns a Cloudflare challenge (403) on
    // robots.txt to datacentre IPs while serving the real file to others: the
    // authority permits these paths, and we simply cannot see that it does.
    const robotsReadable = robotsTxt !== null;
    const verdict = isAllowed(robotsTxt, source.source_url, policy.userAgent);

    if (!verdict.allowed) {
      await this.recordCheck(source.id, runId, {
        status: 'blocked',
        durationMs: Date.now() - startedAt,
        error: `robots.txt: ${verdict.matchedRule ?? 'disallowed'}`,
      });
      await this.db
        .from('visa_sources')
        .update({
          robots_state: 'disallowed',
          last_checked_at: new Date().toISOString(),
        })
        .eq('id', source.id);
      return 'blocked';
    }

    await waitForHost(url.host);
    const result = await fetchSource(source.source_url, policy);

    if (result.status === 'blocked' || result.status === 'unavailable') {
      await this.recordCheck(source.id, runId, {
        status: result.status === 'blocked' ? 'blocked' : 'unavailable',
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        error: result.reason,
      });
      await this.db
        .from('visa_sources')
        .update({
          last_checked_at: new Date().toISOString(),
          failure_streak: source.failure_streak + 1,
          // A block on the PAGE says nothing about the authority's robots
          // policy, so it must not be written into robots_state. This used to
          // set 'disallowed' here, which made a false claim: migri.fi's
          // robots.txt ALLOWS the permit pages, and a WAF blocks our egress IP.
          // An operator reading 'disallowed' concludes "we are not permitted
          // and must stop"; the truth is "our IP is challenged", which has a
          // remedy (docs/operations/SOURCE_ACCESS.md). The only honest thing a
          // failed page fetch can say about robots is what we learned when we
          // tried to read it.
          ...(robotsReadable ? {} : { robots_state: 'unknown' }),
        })
        .eq('id', source.id);
      return result.status === 'blocked' ? 'blocked' : 'unavailable';
    }

    if (result.status === 'redirected') {
      await this.recordCheck(source.id, runId, {
        status: 'redirected',
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        redirectUrl: result.redirectUrl,
      });
      return 'redirected';
    }

    const normalized = normalizeContent(result.body, result.contentType);
    if (normalized.length === 0) {
      // A 200 with no extractable text is not a content change — treating it as
      // one would raise a review item claiming the government deleted the whole
      // page. But it is not automatically OUR failure either.
      //
      // `parse_error` means "this IS a VisaAI bug and belongs in the parser
      // backlog", which is exactly what the coverage matrix reports it as.
      // esta.cbp.dhs.gov filed one on every run — 34 in a week — for a page
      // whose body is a single <app-root> and three script tags. Nothing in a
      // parser backlog fixes a page with no text to parse, and a permanently
      // red signal is one people stop reading; the eight real New Zealand
      // failures behind B-23 sat in this same bucket.
      const clientRendered = looksClientRendered(result.body);
      await this.recordCheck(source.id, runId, {
        status: clientRendered ? 'client_rendered' : 'parse_error',
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        error: clientRendered
          ? 'no server-rendered text: the page renders its content with script'
          : 'normalization produced no text',
      });
      // The streak still advances. A client-rendered page is genuinely
      // unreadable, and resetting the streak because we now understand WHY
      // would make an unreadable source look healthy. The status carries the
      // explanation; the streak carries the fact.
      await this.db
        .from('visa_sources')
        .update({
          last_checked_at: new Date().toISOString(),
          failure_streak: source.failure_streak + 1,
        })
        .eq('id', source.id);
      return clientRendered ? 'clientRendered' : 'parseErrors';
    }

    const normalizedHash = sha256(normalized);
    const rawHash = sha256(result.body);

    const { data: activeVersion } = await this.db
      .from('visa_source_versions')
      .select('id, version_number, normalized_sha256')
      .eq('source_id', source.id)
      .eq('is_active', true)
      .maybeSingle();
    const previous = activeVersion;

    /**
     * EVERY version this source has ever had, newest first.
     *
     * Two things need it, and using the ACTIVE version for either was a bug
     * that deadlocked a source the moment it mattered most.
     *
     * 1. THE NEXT VERSION NUMBER. It used to be `active.version_number + 1`.
     *    But a material change inserts a version WITHOUT activating it — the
     *    previous one keeps serving until a human reviews it, which is the
     *    entire point of the promotion queue. So a source with a pending review
     *    has version 2 sitting inactive above active version 1, and the next
     *    content change computes 1 + 1 = 2 and collides with it on
     *    `visa_source_versions_seq_idx`. FOREVER: every subsequent run fails
     *    the same way, and the source silently stops being versioned from the
     *    moment it was flagged as changing.
     *
     *    Found on production 2026-08-24, on the eight immigration.govt.nz
     *    sources that had raised the service-banner change two runs earlier.
     *    They reported `parse_error` — a page that parsed fine.
     *
     * 2. WHETHER THIS EXACT CONTENT IS ALREADY FILED. Without that check the
     *    fix above turns one bug into another: while a review is pending, the
     *    active hash never matches the live page, so every nightly run would
     *    insert yet another version of the SAME content and raise yet another
     *    change record. A reviewer would arrive to thirty identical items.
     */
    const { data: allVersions } = await this.db
      .from('visa_source_versions')
      .select('id, version_number, normalized_sha256')
      .eq('source_id', source.id)
      .order('version_number', { ascending: false });
    const versions = (allVersions ?? []) as VersionRow[];
    const highestVersionNumber = versions[0]?.version_number ?? 0;

    const nowIso = new Date().toISOString();

    // Unchanged: record the successful check and stop. No new version row —
    // versions are for content that differs, not for proof of liveness, which
    // is what visa_source_checks is for.
    if (previous && previous.normalized_sha256 === normalizedHash) {
      await this.recordCheck(source.id, runId, {
        status: 'ok',
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        versionId: previous.id,
      });
      await this.db
        .from('visa_sources')
        .update({
          last_checked_at: nowIso,
          last_success_at: nowIso,
          failure_streak: 0,
          robots_state: 'allowed',
        })
        .eq('id', source.id);
      return 'ok';
    }

    /**
     * The change is already in the queue: this exact normalized content was
     * versioned on an earlier run and is waiting for a person. Record a
     * successful check against it and stop. Inserting again would file a
     * duplicate change every night for as long as the review takes.
     */
    const alreadyFiled = versions.find(
      (v) => v.normalized_sha256 === normalizedHash,
    );
    if (alreadyFiled) {
      await this.recordCheck(source.id, runId, {
        status: 'ok',
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        versionId: alreadyFiled.id,
      });
      await this.db
        .from('visa_sources')
        .update({
          last_checked_at: nowIso,
          last_success_at: nowIso,
          failure_streak: 0,
          robots_state: 'allowed',
        })
        .eq('id', source.id);
      return 'ok';
    }

    const { data: inserted, error: versionErr } = await this.db
      .from('visa_source_versions')
      .insert({
        source_id: source.id,
        version_number: highestVersionNumber + 1,
        raw_sha256: rawHash,
        normalized_sha256: normalizedHash,
        http_status: result.httpStatus,
        content_type: result.contentType,
        byte_size: result.bytes,
        extractor_version: EXTRACTOR_VERSION,
        // Retained so the NEXT version has something real to diff against.
        // Its absence is what made every change in this system's history a
        // comparison against the empty string.
        normalized_text: normalized,
        fetched_at: nowIso,
        // NOT active yet. The previous version keeps serving until this one has
        // been through the change workflow — that is the whole point of the
        // promotion queue, and flipping it here would make the queue decorative.
        is_active: previous === null,
      })
      .select('id')
      .single();

    if (versionErr || !inserted) {
      await this.recordCheck(source.id, runId, {
        status: 'parse_error',
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        // Not a parse error — the page parsed. `visa_source_checks.status` has
        // no value for "the database refused the row", and adding one is a
        // migration for a case that should no longer happen now the version
        // numbering is fixed. The message says what actually failed so the next
        // occurrence is not misread as unparseable HTML, which is exactly how
        // the numbering deadlock hid for two runs.
        error: `version insert failed (NOT a parse failure): ${versionErr?.message}`,
      });
      this.log.error(
        `source ${source.id} parsed fine but its version row was rejected: ${versionErr?.message}`,
      );
      return 'parseErrors';
    }
    const newVersionId = inserted.id;

    // First ever version: nothing to diff against, so it becomes active
    // directly. There is no previous claim it could contradict.
    if (!previous) {
      await this.recordCheck(source.id, runId, {
        status: 'ok',
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        versionId: newVersionId,
      });
      await this.db
        .from('visa_sources')
        .update({
          last_checked_at: nowIso,
          last_success_at: nowIso,
          last_changed_at: nowIso,
          failure_streak: 0,
          robots_state: 'allowed',
        })
        .eq('id', source.id);
      return 'ok';
    }

    // A real change — the hashes differ. Whether it can be CHARACTERISED is a
    // separate question, and answering it wrongly is what B-29 was.
    const previousText = await this.normalizedTextOf(previous.id);

    const analysis: ChangeAnalysis =
      previousText === null
        ? {
            // No retained text for the previous version, so there is nothing to
            // compare against. Passing "" here — which is what this code used
            // to do implicitly — produces a diff in which the entire page is
            // new, and escalation reasons drawn from the page's vocabulary
            // rather than from any change. That is not a degraded answer, it is
            // a confident wrong one.
            classification: 'material',
            escalationReasons: [],
            requiresReview: true,
            addedLines: [],
            removedLines: [],
            addedTotal: 0,
            removedTotal: 0,
            summary:
              'Content changed, but the previous version’s text was not retained, ' +
              'so the change cannot be characterised. Compare against the ' +
              'authority’s page directly. Versions filed from 2026-08-24 onward ' +
              'retain their text, so this is a one-time gap per source.',
          }
        : classifyChange(previousText, normalized);

    await this.db.from('visa_source_changes').insert({
      source_id: source.id,
      from_version_id: previous.id,
      to_version_id: newVersionId,
      run_id: runId,
      state: 'parsed',
      classification: analysis.classification,
      escalation_reasons: analysis.escalationReasons,
      requires_review: analysis.requiresReview,
      summary: analysis.summary,
      diff: {
        added: analysis.addedLines,
        removed: analysis.removedLines,
        // The arrays above are a SAMPLE. Storing the true counts is what lets
        // `detectSiteWideChanges` tell 50 lines from the first 50 of 426, and
        // decline to claim "all of them appeared elsewhere" when it cannot see
        // all of them.
        added_total: analysis.addedTotal,
        removed_total: analysis.removedTotal,
      },
    });

    // Editorial changes auto-promote: no obligation, amount, form identifier
    // or page structure moved, so serving the new wording is strictly better
    // than serving the old. Everything else waits for a person, and the
    // PREVIOUS version keeps serving in the meantime — a stale-but-reviewed
    // requirement beats a fresh-but-unreviewed one.
    if (!analysis.requiresReview) {
      await this.promote(previous.id, newVersionId, source.id);
    }

    await this.recordCheck(source.id, runId, {
      status: 'changed',
      httpStatus: result.httpStatus,
      durationMs: Date.now() - startedAt,
      versionId: newVersionId,
    });
    await this.db
      .from('visa_sources')
      .update({
        last_checked_at: nowIso,
        last_success_at: nowIso,
        last_changed_at: nowIso,
        failure_streak: 0,
        robots_state: 'allowed',
      })
      .eq('id', source.id);

    return 'changed';
  }

  /**
   * Make `next` the active version and mark `prev` superseded.
   *
   * Ordering matters: the partial unique index allows exactly one active
   * version per source, so the old one must be cleared before the new one is
   * set or the second write violates it.
   */
  private async promote(
    prevVersionId: string,
    nextVersionId: string,
    sourceId: string,
  ): Promise<void> {
    await this.db
      .from('visa_source_versions')
      .update({ is_active: false, superseded_by: nextVersionId })
      .eq('id', prevVersionId);
    await this.db
      .from('visa_source_versions')
      .update({ is_active: true })
      .eq('id', nextVersionId);
    await this.db
      .from('visa_source_changes')
      .update({ state: 'active' })
      .eq('to_version_id', nextVersionId)
      .eq('source_id', sourceId);
  }

  /**
   * The normalized text of a stored version.
   *
   * Only the HASH is stored, not the text, unless caching was permitted — so
   * for the common case the previous text is unavailable and the diff would be
   * meaningless. Returning the CURRENT text in that case makes classifyChange
   * see no line-level difference and fall back to 'cosmetic'... which would be
   * wrong, so instead an empty string is returned: every line reads as added,
   * the material markers fire on whatever the page actually says, and the
   * change is escalated to a human. Over-escalating a first diff is the safe
   * direction.
   */
  /**
   * The previous version's normalized text, or NULL when it was never retained.
   *
   * The null matters more than the text. This used to return the empty string
   * when it could not find anything, and `storage_path` — the only place it
   * looked — has never been written by anything: 0 of 283 version rows carry
   * one. So every change ever classified by this service was diffed against "",
   * which makes every line an addition, nothing ever a removal, and every
   * escalation flag a reaction to words found somewhere in the whole page
   * rather than in what changed.
   *
   * 127 change records, 127 with an empty `removed` array, 125 marked material
   * and sent for human review. Returning "" is not a graceful degradation; it
   * is a confident wrong answer, and a reviewer cannot tell it from a real one.
   */
  private async normalizedTextOf(versionId: string): Promise<string | null> {
    const { data } = await this.db
      .from('visa_source_versions')
      .select('normalized_text, storage_path')
      .eq('id', versionId)
      .maybeSingle();
    const row = data as {
      normalized_text?: string | null;
      storage_path?: string | null;
    } | null;

    if (row?.normalized_text) return row.normalized_text;

    // Bucket fallback, kept for versions filed under the original design.
    const path = row?.storage_path;
    if (!path) return null;
    const { data: file } = await this.db.storage
      .from('visa-sources')
      .download(path);
    if (!file) return null;
    return normalizeContent(await file.text());
  }

  private async recordCheck(
    sourceId: string,
    runId: string,
    info: {
      status: string;
      httpStatus?: number | null;
      durationMs?: number;
      versionId?: string;
      redirectUrl?: string;
      error?: string;
    },
  ): Promise<void> {
    await this.db.from('visa_source_checks').insert({
      source_id: sourceId,
      run_id: runId,
      status: info.status,
      http_status: info.httpStatus ?? null,
      duration_ms: info.durationMs ?? null,
      version_id: info.versionId ?? null,
      redirect_url: info.redirectUrl ?? null,
      error_message: info.error?.slice(0, 2000) ?? null,
    });
  }
}
