import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RobotsGate } from './robots';
import { FORM_FETCH_USER_AGENT, type FetchLike } from './http';
import { resolveDiscoveryStrategy } from './discovery/discovery.registry';
import {
  probeFormCapability,
  type FormCapability,
} from './capability/form-capability.probe';
import { FormTemplateStore, storagePathFor } from './form-template.store';
import { TemplateRevisionStore } from './template-revision.store';
import { allCatalogedForms, type RequiredForm } from './form-catalog';
import type { DiscoveredForm } from './discovery/discovery.types';

/** DI token for the injected fetch implementation. See the DI note above. */
export const FORM_HTTP = Symbol('FORM_HTTP');

export type RefreshStatus = 'ok' | 'unchanged' | 'stale' | 'blocked' | 'error';

export interface RefreshOutcome {
  countryCode: string;
  program: string;
  formCode: string;
  status: RefreshStatus;
  message?: string;
}

type CatalogedForm = RequiredForm & { countryCode: string };

/**
 * What a (landing url, form code) pair resolved to in THIS run.
 *
 * MEASURED IN PRODUCTION, 2026-08-13: the `shared` download map below is keyed
 * by the RESOLVED pdf url, which discovery has to run to produce — so the
 * landing page was fetched once per catalog entry even though the harmonised
 * Schengen form names ONE page for 58 of them. The European Commission
 * answered HTTP 429, and the sibling document job's rows all failed.
 *
 * The key includes the form code because a portal page can serve more than one
 * form (USCIS lists i-130.pdf, i-130a.pdf and i-130instr.pdf side by side);
 * keying on the url alone would hand a form the wrong file. Same url AND same
 * code resolves identically by definition, so memoising that is safe.
 *
 * A FAILED resolution is memoised too: once a host has rate-limited us,
 * retrying it 57 more times in the same loop is what caused the incident.
 */
type DiscoveryMemo = Map<string, DiscoveredForm | null>;

const memoKey = (landingUrl: string, formCode: string) =>
  `${landingUrl}\u0000${formCode}`;

/**
 * A document already fetched during THIS run, reusable by any later entry that
 * resolves to the same URL. Holds the results of the expensive work — the
 * download, the checksum, the probe, and the upload — so a second entry writes
 * its row and nothing else.
 */
interface SharedDownload {
  sha256: string;
  byteSize: number;
  capability: FormCapability;
  fieldCount: number;
  storagePath: string;
  versionLabel: string | null;
  reuseCount: number;
}

/**
 * All network I/O for form fetching lives here, behind the scheduled job.
 * Nothing on a user request path calls this class.
 *
 * The invariant that shapes every branch: a failure NEVER removes a working
 * cached copy. A refresh that cannot reach the government site downgrades the
 * row to `stale` and leaves storage_path, sha256, and capability exactly as
 * they were, so delivery keeps serving the last good PDF. Only a form that
 * never cached successfully ends up `error`.
 */
@Injectable()
export class FormRefreshService {
  private readonly log = new Logger(FormRefreshService.name);

  constructor(
    private readonly store: FormTemplateStore,
    private readonly robots: RobotsGate,
    @Inject(FORM_HTTP) private readonly http: FetchLike,
    private readonly revisions: TemplateRevisionStore,
  ) {}

  /**
   * Every form for ONE country, in that country's morning.
   *
   * Sharing refreshAll's per-run maps matters even for a single country: Canada
   * requires IMM 5257 under two programs, so a naive per-country pass would
   * still fetch it twice.
   */
  async refreshCountry(countryCode: string): Promise<RefreshOutcome[]> {
    const code = countryCode.toUpperCase();
    const work = allCatalogedForms().filter(
      (f) => f.countryCode.toUpperCase() === code,
    );
    return this.refreshList(work, `form refresh (${code})`);
  }

  async refreshAll(): Promise<RefreshOutcome[]> {
    // Per-run dedupe, keyed by resolved PDF URL. One form can be required by
    // many countries and programs: the harmonised Schengen form is identical
    // across 29 member states by law, and IMM 5257 is required by two
    // Canadian programs, so a naive pass makes 58 identical requests to the
    // European Commission every night and stores the same 291 KB file 58
    // times. The plan's constraint is "one fetch serves all applicants" —
    // that has to hold WITHIN a run, not just across users.
    return this.refreshList(allCatalogedForms(), 'form refresh');
  }

  private async refreshList(
    work: CatalogedForm[],
    label: string,
  ): Promise<RefreshOutcome[]> {
    const out: RefreshOutcome[] = [];
    const shared = new Map<string, SharedDownload>();
    // One discovery request per (page, form code) — see DiscoveryMemo. `shared`
    // saves the DOWNLOAD; without this the request that PRECEDES it still ran
    // once per entry.
    const memo: DiscoveryMemo = new Map();
    for (const form of work) {
      out.push(await this.refreshOne(form, shared, memo));
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
        `${f.countryCode}/${f.formCode}: ${f.status} — ${f.message}`,
      );
    }
    return out;
  }

  async refreshOne(
    form: CatalogedForm,
    shared: Map<string, SharedDownload> = new Map(),
    memo: DiscoveryMemo = new Map(),
  ): Promise<RefreshOutcome> {
    const id = {
      countryCode: form.countryCode,
      program: form.program,
      formCode: form.formCode,
    };
    try {
      return await this.run(form, id, shared, memo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`refresh threw for ${form.formCode}: ${message}`);
      // Best-effort: record that we tried, so last_checked_at does not silently
      // freeze while the row keeps advertising a healthy status. Swallowing a
      // failure HERE is correct — the throw we are already reporting is the
      // signal, and a second failure must not mask it.
      try {
        const existing = await this.store.find({
          countryCode: form.countryCode,
          program: form.program,
          formCode: form.formCode,
        });
        await this.store.upsert({
          country_code: form.countryCode,
          program: form.program,
          form_code: form.formCode,
          form_name: form.formName,
          landing_url: form.landingUrl ?? '',
          resolved_pdf_url: existing?.resolved_pdf_url ?? null,
          version_label: existing?.version_label ?? null,
          storage_path: existing?.storage_path ?? null,
          sha256: existing?.sha256 ?? null,
          byte_size: existing?.byte_size ?? null,
          capability: existing?.capability ?? 'unknown',
          field_count: existing?.field_count ?? null,
          fetched_at: existing?.fetched_at ?? null,
          // Preserved explicitly: a failed run must not reset the clock the
          // freshness gate reads, in either direction. Re-stamping it would
          // make a broken row look freshly verified; nulling it would condemn
          // a healthy cached copy on the first transient blip.
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

  private async run(
    form: CatalogedForm,
    id: Pick<RefreshOutcome, 'countryCode' | 'program' | 'formCode'>,
    shared: Map<string, SharedDownload>,
    memo: DiscoveryMemo,
  ): Promise<RefreshOutcome> {
    const existing = await this.store.find({
      countryCode: form.countryCode,
      program: form.program,
      formCode: form.formCode,
    });

    const base = {
      country_code: form.countryCode,
      program: form.program,
      form_code: form.formCode,
      form_name: form.formName,
      landing_url: form.landingUrl ?? '',
      last_checked_at: new Date().toISOString(),
    };

    // Preserve whatever is already cached, so a failure path can write a
    // status without destroying a working copy.
    const kept = {
      resolved_pdf_url: existing?.resolved_pdf_url ?? null,
      version_label: existing?.version_label ?? null,
      storage_path: existing?.storage_path ?? null,
      sha256: existing?.sha256 ?? null,
      byte_size: existing?.byte_size ?? null,
      capability: existing?.capability ?? ('unknown' as const),
      field_count: existing?.field_count ?? null,
      fetched_at: existing?.fetched_at ?? null,
      // See the catch block above: preserved, never re-stamped and never
      // nulled, so the freshness gate keeps telling the truth about age.
      last_verified_at: existing?.last_verified_at ?? null,
    };
    const hasCachedCopy = Boolean(existing?.storage_path && existing?.sha256);
    const degraded: 'stale' | 'error' = hasCachedCopy ? 'stale' : 'error';

    const fail = async (
      status: 'stale' | 'error',
      message: string,
    ): Promise<RefreshOutcome> => {
      await this.store.upsert({
        ...base,
        ...kept,
        status,
        error_message: message.slice(0, 1000),
      });
      return { ...id, status, message };
    };

    if (!form.landingUrl) {
      return fail(degraded, 'no landing URL for this form');
    }

    const strategy = resolveDiscoveryStrategy(form.portalId);
    if (!strategy) {
      return fail(
        degraded,
        `no discovery strategy for portal ${form.portalId}`,
      );
    }

    // Pass the form code so a portal page that links to more than one PDF
    // (a nav/brochure link above the actual form) does not get the wrong one
    // cached as 'ok' and handed to an applicant (Important 5).
    //
    // Memoised per (page, form code) — see DiscoveryMemo. The harmonised
    // Schengen form names ONE European Commission page for 58 catalog entries,
    // and without this the page was fetched 58 times per run.
    const key = memoKey(form.landingUrl, form.formCode);
    let found: DiscoveredForm | null;
    if (memo.has(key)) {
      found = memo.get(key)!;
    } else {
      found = await strategy.discover(
        form.landingUrl,
        this.http,
        form.formCode,
      );
      memo.set(key, found);
    }
    if (!found) {
      return fail(
        degraded,
        `could not discover a PDF link on ${form.landingUrl}`,
      );
    }

    // robots.txt is checked against the RESOLVED PDF URL, not the landing
    // page: canada.ca disallows individual form PDFs by filename while
    // allowing the page that links to them.
    //
    // The tri-state result matters here: 'disallowed' and 'unknown' ("we
    // could not read robots.txt at all") are NOT the same failure and must
    // not share a status. Collapsing them (Important 1) meant a transient
    // robots.txt fetch failure was reported as "robots.txt disallows <url>"
    // — a lie — and, worse, RobotsGate used to cache that failure forever,
    // so one bad fetch blacked out the feature until a process restart.
    // Already fetched in this run by another country/program pointing at the
    // same document. Reuse its bytes, probe and stored object: write this
    // entry's row and make no further network or storage calls.
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
        capability: already.capability,
        field_count: already.fieldCount,
        fetched_at: new Date().toISOString(),
        // Reusing another entry's bytes IS a verification: those bytes were
        // fetched from the authority in this same run.
        last_verified_at: new Date().toISOString(),
        status: 'ok',
        error_message: null,
      });
      return { ...id, status: 'ok' };
    }

    const robotsResult = await this.robots.check(found.pdfUrl);
    if (robotsResult === 'unknown') {
      return fail(
        degraded,
        `robots.txt unreachable for ${new URL(found.pdfUrl).origin} — cached copy retained`,
      );
    }
    if (robotsResult === 'disallowed') {
      const message = `robots.txt disallows ${found.pdfUrl}`;
      // Bytes are preserved deliberately (via `...kept`): if the portal's
      // Disallow rule is later lifted, the next refresh picks the row back up
      // cleanly, and a previously cached copy stays available for a manual
      // recovery path. Delivery must still treat this row as unavailable
      // while status is 'blocked' — it does not serve blocked rows.
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
      if (!res.ok) {
        return fail(degraded, `download failed: HTTP ${res.status}`);
      }
      contentType = res.headers.get('content-type');
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(degraded, `download failed: ${message}`);
    }

    // A 200 is not proof of a PDF: this very portal has served a text/html
    // error page with a 200 for a form URL (see modules/prefill/forms/imm5257.ts).
    // Gate on the %PDF magic bytes BEFORE the sha256/probe/putBytes work below —
    // this also rejects a zero-byte 200, which would otherwise violate
    // form_templates_byte_size_check and throw on upsert AFTER putBytes had
    // already run.
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
    // path — the case where a stale field mapping would fill the wrong boxes.
    if (
      existing?.sha256 === sha256 &&
      existing?.version_label === found.versionLabel &&
      existing?.storage_path
    ) {
      // Publish to the run's dedupe map before returning. Without this the
      // map is only ever populated by a FULL fetch, so on a steady-state run
      // — where every existing row is unchanged — a newly added program
      // sharing this same document finds nothing to reuse and downloads its
      // own copy. Observed exactly that when Canada gained business_visa:
      // IMM 5257 landed at a second storage path with byte-identical content.
      if (!shared.has(found.pdfUrl)) {
        shared.set(found.pdfUrl, {
          sha256,
          byteSize: existing.byte_size ?? bytes.length,
          capability: existing.capability,
          fieldCount: existing.field_count ?? 0,
          storagePath: existing.storage_path,
          versionLabel: existing.version_label,
          reuseCount: 0,
        });
      }
      // Unchanged is a SUCCESSFUL verification — the whole point of
      // last_verified_at is that this case, not just a byte change, proves the
      // cached copy is still what the authority publishes.
      await this.store.upsert({
        ...base,
        ...kept,
        last_verified_at: new Date().toISOString(),
        status: 'ok',
        error_message: null,
      });
      return { ...id, status: 'unchanged' };
    }

    const probe = await probeFormCapability(bytes);
    // The %PDF magic-byte gate above only proves the response STARTS with
    // those four bytes — a truncated or otherwise corrupt body can still
    // pass it. probeFormCapability already computes exactly the signal that
    // catches this: PDFDocument.load() throwing surfaces as
    // { capability: 'unknown', fieldCount: 0, pageCount: 0 }. A legitimate
    // flat PDF with zero form fields still has pageCount >= 1, so this check
    // targets only the "did not actually parse" case (Important 2) — without
    // it, a truncated download gets a new content-addressed storage path,
    // storage_path is repointed at it, and the row is written 'ok',
    // functionally destroying a working cached copy.
    // Gate on `parsed`, NOT on capability+pageCount. The live IMM 5645 loads
    // as a real PDF but has a broken page tree, so it reports
    // capability 'unknown' with pageCount 0 — indistinguishable from garbage
    // under the old condition, which discarded the form outright in production
    // on 2026-08-12. `parsed` separates "not a PDF" from "a PDF pdf-lib cannot
    // fully introspect"; only the former is a failed download.
    if (!probe.parsed) {
      return fail(degraded, 'downloaded bytes did not parse as a PDF');
    }

    // Content-addressed: two different byte-sets under the SAME version label
    // (a silent re-issue, or IRCC reusing a label) must not collide at the
    // same storage key. putBytes uses upsert:true, so a colliding path would
    // destroy the live cached object out from under a signed URL already
    // handed to a user.
    const storagePath = storagePathFor(
      {
        countryCode: form.countryCode,
        program: form.program,
        formCode: form.formCode,
      },
      found.versionLabel,
      sha256,
    );

    await this.store.putBytes(storagePath, bytes);
    shared.set(found.pdfUrl, {
      sha256,
      byteSize: bytes.length,
      capability: probe.capability,
      fieldCount: probe.fieldCount,
      storagePath,
      versionLabel: found.versionLabel,
      reuseCount: 0,
    });
    await this.store.upsert({
      ...base,
      resolved_pdf_url: found.pdfUrl,
      version_label: found.versionLabel,
      storage_path: storagePath,
      sha256,
      byte_size: bytes.length,
      capability: probe.capability,
      field_count: probe.fieldCount,
      fetched_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
      status: 'ok',
      error_message: null,
    });

    // Ledger AFTER the cache write, and never in a way that can fail the run:
    // the applicant-visible outcome is the cached form, and an audit insert
    // must not be able to turn a successful fetch into a degraded row.
    // field_count is carried because a field-count move on a prefillable form
    // is the signal that a mapping review is due.
    await this.revisions.record({
      source: 'form',
      countryCode: form.countryCode,
      program: form.program,
      code: form.formCode,
      name: form.formName,
      previousSha256: existing?.sha256 ?? null,
      newSha256: sha256,
      previousVersionLabel: existing?.version_label ?? null,
      newVersionLabel: found.versionLabel,
      previousFieldCount: existing?.field_count ?? null,
      newFieldCount: probe.fieldCount,
      resolvedUrl: found.pdfUrl,
      byteSize: bytes.length,
      storagePath,
    });

    return { ...id, status: 'ok' };
  }
}
