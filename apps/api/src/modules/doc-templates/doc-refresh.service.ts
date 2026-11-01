import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RobotsGate } from '../forms/robots';
import { FORM_FETCH_USER_AGENT, type FetchLike } from '../forms/http';
import { FORM_HTTP } from '../forms/form-refresh.service';
import {
  discoverDocument,
  newDiscoveryCache,
  type DiscoveryCache,
} from './doc-discovery';
import {
  DocumentTemplateStore,
  documentStoragePathFor,
} from './doc-template.store';
import { TemplateRevisionStore } from '../forms/template-revision.store';
import {
  allCatalogedDocumentTemplates,
  type RequiredDocumentTemplate,
} from './doc-template.catalog';

export type DocRefreshStatus =
  | 'ok'
  | 'unchanged'
  | 'link-only'
  | 'stale'
  | 'blocked'
  | 'error';

export interface DocRefreshOutcome {
  countryCode: string;
  program: string;
  templateCode: string;
  status: DocRefreshStatus;
  message?: string;
}

/** A document already fetched in THIS run, reusable by any later entry. */
interface SharedDownload {
  sha256: string;
  byteSize: number;
  storagePath: string;
  versionLabel: string | null;
  contentType: string | null;
  reuseCount: number;
}

/**
 * All network I/O for official document artifacts, behind the scheduled job.
 * Nothing on a user request path calls this class.
 *
 * The invariant is the one FormRefreshService establishes and this half must
 * not weaken: a failure NEVER removes a working cached copy. A refresh that
 * cannot reach the authority downgrades the row to `stale` and leaves
 * storage_path/sha256 exactly as they were, so delivery keeps serving the last
 * good PDF. Only an artifact that never cached successfully ends up `error`,
 * and either way the applicant still gets the official link — today's
 * behaviour, which this feature can only improve on.
 */
@Injectable()
export class DocRefreshService {
  private readonly log = new Logger(DocRefreshService.name);

  constructor(
    private readonly store: DocumentTemplateStore,
    private readonly robots: RobotsGate,
    @Inject(FORM_HTTP) private readonly http: FetchLike,
    private readonly revisions: TemplateRevisionStore,
  ) {}

  /**
   * Every artifact for ONE country, in that country's morning. Shares the
   * per-run maps for the same reason refreshAll needs them: one country can
   * require the same document under several programs.
   */
  async refreshCountry(countryCode: string): Promise<DocRefreshOutcome[]> {
    const code = countryCode.toUpperCase();
    const work = allCatalogedDocumentTemplates().filter(
      (t) => t.countryCode.toUpperCase() === code,
    );
    return this.refreshList(work, `document template refresh (${code})`);
  }

  async refreshAll(): Promise<DocRefreshOutcome[]> {
    return this.refreshList(
      allCatalogedDocumentTemplates(),
      'document template refresh',
    );
  }

  private async refreshList(
    work: RequiredDocumentTemplate[],
    label: string,
  ): Promise<DocRefreshOutcome[]> {
    const out: DocRefreshOutcome[] = [];
    // Per-run dedupe keyed by resolved PDF URL. This matters more here than it
    // does for forms: the ICAO photograph guidelines are one document shared by
    // 29 Schengen countries across two programs each, so a naive pass would
    // pull the same file from the European Commission 58 times in one night.
    const shared = new Map<string, SharedDownload>();
    // One landing-page fetch per URL, not per entry — see DiscoveryCache. The
    // `shared` map below saves the DOWNLOAD; without this the discovery request
    // that precedes it still ran 58 times against one host and got us a 429.
    const discovered = newDiscoveryCache();
    for (const tpl of work) {
      out.push(await this.refreshOne(tpl, shared, discovered));
    }

    const reused = [...shared.values()].reduce((n, s) => n + s.reuseCount, 0);
    if (reused > 0) {
      this.log.log(
        `${label}: ${reused} of ${out.length} entries reused an already-fetched document`,
      );
    }
    const failed = out.filter(
      (o) =>
        o.status === 'error' || o.status === 'stale' || o.status === 'blocked',
    );
    this.log.log(`${label}: ${out.length} checked, ${failed.length} degraded`);
    for (const f of failed) {
      this.log.warn(
        `${f.countryCode}/${f.templateCode}: ${f.status} — ${f.message}`,
      );
    }
    return out;
  }

  async refreshOne(
    tpl: RequiredDocumentTemplate,
    shared: Map<string, SharedDownload> = new Map(),
    discovered: DiscoveryCache = newDiscoveryCache(),
  ): Promise<DocRefreshOutcome> {
    const id = {
      countryCode: tpl.countryCode,
      program: tpl.program,
      templateCode: tpl.templateCode,
    };
    try {
      return await this.run(tpl, id, shared, discovered);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`refresh threw for ${tpl.templateCode}: ${message}`);
      // Best effort: record that we tried, so last_checked_at does not freeze
      // while the row keeps advertising a healthy status. Swallowing a failure
      // HERE is correct — the throw already reported above is the signal, and a
      // second failure must not mask it.
      try {
        const existing = await this.store.find(id);
        await this.store.upsert({
          ...this.identity(tpl),
          resolved_pdf_url: existing?.resolved_pdf_url ?? null,
          version_label: existing?.version_label ?? null,
          storage_path: existing?.storage_path ?? null,
          sha256: existing?.sha256 ?? null,
          byte_size: existing?.byte_size ?? null,
          content_type: existing?.content_type ?? null,
          fetched_at: existing?.fetched_at ?? null,
          // Preserved explicitly: a failed run must not re-stamp the clock the
          // freshness gate reads (that would make a broken row look freshly
          // verified) nor null it (that would condemn a healthy cached copy on
          // the first transient blip).
          last_verified_at: existing?.last_verified_at ?? null,
          last_checked_at: new Date().toISOString(),
          status:
            existing?.storage_path && existing?.sha256 ? 'stale' : 'error',
          error_message: message.slice(0, 1000),
        });
      } catch {
        // Store unreachable entirely; the logged error above is the record.
      }
      return { ...id, status: 'error', message };
    }
  }

  private identity(tpl: RequiredDocumentTemplate) {
    return {
      country_code: tpl.countryCode,
      program: tpl.program,
      template_code: tpl.templateCode,
      template_name: tpl.templateName,
      kind: tpl.kind,
      document_code: tpl.documentCode ?? null,
      source_url: tpl.sourceUrl,
      last_checked_at: new Date().toISOString(),
    };
  }

  private async run(
    tpl: RequiredDocumentTemplate,
    id: Pick<DocRefreshOutcome, 'countryCode' | 'program' | 'templateCode'>,
    shared: Map<string, SharedDownload>,
    discovered: DiscoveryCache,
  ): Promise<DocRefreshOutcome> {
    const existing = await this.store.find(id);
    const base = this.identity(tpl);

    // Preserve whatever is already cached, so a failure path can write a status
    // without destroying a working copy.
    const kept = {
      resolved_pdf_url: existing?.resolved_pdf_url ?? null,
      version_label: existing?.version_label ?? null,
      storage_path: existing?.storage_path ?? null,
      sha256: existing?.sha256 ?? null,
      byte_size: existing?.byte_size ?? null,
      content_type: existing?.content_type ?? null,
      fetched_at: existing?.fetched_at ?? null,
      // See the catch block above: preserved, never re-stamped, never nulled.
      last_verified_at: existing?.last_verified_at ?? null,
    };
    const hasCachedCopy = Boolean(existing?.storage_path && existing?.sha256);
    const degraded: 'stale' | 'error' = hasCachedCopy ? 'stale' : 'error';

    const fail = async (
      status: 'stale' | 'error',
      message: string,
    ): Promise<DocRefreshOutcome> => {
      await this.store.upsert({
        ...base,
        ...kept,
        status,
        error_message: message.slice(0, 1000),
      });
      return { ...id, status, message };
    };

    // Declared link-only: the authority publishes a web page, or robots.txt
    // disallows the file. Record the row so delivery can show it with its real
    // name and kind, and never touch the network for it.
    if (tpl.resolve === 'link') {
      await this.store.upsert({
        ...base,
        ...kept,
        status: 'link_only',
        error_message: null,
      });
      return { ...id, status: 'link-only' };
    }

    const found = await discoverDocument(tpl, this.http, discovered);
    if (!found) {
      return fail(degraded, `could not resolve a PDF from ${tpl.sourceUrl}`);
    }

    // Already fetched in this run by another country/program pointing at the
    // same document (the Schengen photograph guidelines, shared 58 ways).
    // Reuse its bytes and stored object: write this row and make no further
    // network or storage calls.
    const already = shared.get(found.pdfUrl);
    if (already) {
      already.reuseCount++;
      await this.store.upsert({
        ...base,
        resolved_pdf_url: found.pdfUrl,
        version_label: already.versionLabel,
        storage_path: already.storagePath,
        sha256: already.sha256,
        byte_size: already.byteSize,
        content_type: already.contentType,
        fetched_at: new Date().toISOString(),
        // Reusing another entry's bytes IS a verification: they came from the
        // authority in this same run.
        last_verified_at: new Date().toISOString(),
        status: 'ok',
        error_message: null,
      });
      return { ...id, status: 'ok' };
    }

    // robots.txt is checked against the RESOLVED PDF URL, not the landing page:
    // canada.ca allows the page that links a form while disallowing the file
    // itself (IMM 5476 is exactly that case).
    //
    // 'unknown' and 'disallowed' are kept apart deliberately. Reporting a
    // transient robots.txt fetch failure as "robots.txt disallows <url>" is a
    // lie, and one that would look permanent in the row's error_message.
    const robotsResult = await this.robots.check(found.pdfUrl);
    if (robotsResult === 'unknown') {
      return fail(
        degraded,
        `robots.txt unreachable for ${new URL(found.pdfUrl).origin} — cached copy retained`,
      );
    }
    if (robotsResult === 'disallowed') {
      const message = `robots.txt disallows ${found.pdfUrl}`;
      // Bytes preserved via `...kept`: if the rule is later lifted the next
      // refresh picks the row back up cleanly. Delivery must still treat a
      // 'blocked' row as uncached — it does.
      await this.store.upsert({
        ...base,
        ...kept,
        resolved_pdf_url: found.pdfUrl,
        status: 'blocked',
        error_message: message.slice(0, 1000),
      });
      return { ...id, status: 'blocked', message };
    }

    let bytes: Uint8Array;
    let contentType: string | null = null;
    try {
      const res = await this.http(found.pdfUrl, {
        headers: { 'user-agent': FORM_FETCH_USER_AGENT },
      });
      if (!res.ok) return fail(degraded, `download failed: HTTP ${res.status}`);
      contentType = res.headers.get('content-type');
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(degraded, `download failed: ${message}`);
    }

    // A 200 is not proof of a PDF — canada.ca has served an HTML error page
    // with a 200 for a form URL before. Gate on the %PDF magic bytes before
    // hashing and uploading; this also rejects a zero-byte 200, which would
    // otherwise violate the byte_size check constraint AFTER the object had
    // already been written to storage.
    const isPdf =
      bytes.length > 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46; // %PDF
    if (!isPdf) {
      return fail(
        degraded,
        `not a PDF: content-type ${contentType ?? 'unknown'}, ${bytes.length} bytes`,
      );
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');

    // Both must match. The label alone misses a silent re-issue under the same
    // path, which for a document checklist means an applicant gathering last
    // year's evidence list.
    if (
      existing?.sha256 === sha256 &&
      existing?.version_label === found.versionLabel &&
      existing?.storage_path
    ) {
      // Publish to the run's dedupe map even on the unchanged path. Without
      // this, a steady-state run never populates the map, so a newly added
      // country sharing this same document downloads its own byte-identical
      // copy — measured in the forms job when Canada gained business_visa.
      if (!shared.has(found.pdfUrl)) {
        shared.set(found.pdfUrl, {
          sha256,
          byteSize: existing.byte_size ?? bytes.length,
          storagePath: existing.storage_path,
          versionLabel: existing.version_label,
          contentType: existing.content_type,
          reuseCount: 0,
        });
      }
      // Unchanged is a SUCCESSFUL verification — that is exactly what
      // last_verified_at records, and what the freshness gate reads.
      await this.store.upsert({
        ...base,
        ...kept,
        last_verified_at: new Date().toISOString(),
        status: 'ok',
        error_message: null,
      });
      return { ...id, status: 'unchanged' };
    }

    const storagePath = documentStoragePathFor(id, found.versionLabel, sha256);
    await this.store.putBytes(storagePath, bytes);
    shared.set(found.pdfUrl, {
      sha256,
      byteSize: bytes.length,
      storagePath,
      versionLabel: found.versionLabel,
      contentType: contentType ?? 'application/pdf',
      reuseCount: 0,
    });
    await this.store.upsert({
      ...base,
      resolved_pdf_url: found.pdfUrl,
      version_label: found.versionLabel,
      storage_path: storagePath,
      sha256,
      byte_size: bytes.length,
      content_type: contentType ?? 'application/pdf',
      fetched_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
      status: 'ok',
      error_message: null,
    });

    // Ledger AFTER the cache write, and never able to fail the run: the
    // applicant-visible outcome is the cached document, and an audit insert
    // must not turn a successful fetch into a degraded row. No field counts —
    // a checklist is never filled, so there is no mapping to review.
    await this.revisions.record({
      source: 'document',
      countryCode: tpl.countryCode,
      program: tpl.program,
      code: tpl.templateCode,
      name: tpl.templateName,
      previousSha256: existing?.sha256 ?? null,
      newSha256: sha256,
      previousVersionLabel: existing?.version_label ?? null,
      newVersionLabel: found.versionLabel,
      resolvedUrl: found.pdfUrl,
      byteSize: bytes.length,
      storagePath,
    });

    return { ...id, status: 'ok' };
  }
}
