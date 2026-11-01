import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DocumentTemplateStore,
  type DocumentTemplateRow,
} from './doc-template.store';
import {
  documentTemplatesForApplication,
  documentTemplatesForCountry,
  documentTemplatesForUnclaimedRoute,
  documentTemplatesForRoute,
  type RequiredDocumentTemplate,
} from './doc-template.catalog';
import type { DocumentTemplateKind } from '../../strategies/types';
import { strategyRegistry } from '../../strategies/strategy.registry';
import { assessFreshness, type FreshnessLevel } from '../forms/freshness';

/**
 * The bytes are proxied through the API rather than handed over as a Supabase
 * Storage signed URL — see FormsService for the measurement. In short:
 * `SUPABASE_URL` on the VPS is `http://127.0.0.1:54421`, so every signed URL
 * pointed at the server's own loopback and was unreachable from a browser.
 */
export const DOC_FILE_ROUTE = (applicationId: string, templateCode: string) =>
  `/document-templates/${applicationId}/file/${encodeURIComponent(templateCode)}`;

export interface DeliveredDocumentTemplate {
  /**
   * The destination country this artifact was resolved for. Carried because a
   * template code is only unique WITHIN a country — 'ICAO-PHOTO' exists for 29
   * Schengen states — so the file route needs it to fetch the right row.
   */
  countryCode: string;
  templateCode: string;
  templateName: string;
  kind: DocumentTemplateKind;
  /** The required document this supports, or null when it covers the whole application. */
  documentCode: string | null;
  versionLabel: string | null;
  /**
   * API path that streams the cached copy, or null when none is cached.
   * RELATIVE: the client prefixes NEXT_PUBLIC_API_URL, and the API has no
   * reliable knowledge of its own public origin.
   */
  downloadPath: string | null;
  /** The authority's own page. Always present as a fallback and a check. */
  officialUrl: string;
  source: 'cache' | 'official-link';
  /**
   * How recently the cached copy was confirmed against the authority.
   * 'unverified' still serves the download — a copy beats nothing — but stops
   * presenting it as current, and the UI leads with the official page.
   */
  freshness: FreshnessLevel;
  /** ISO date of that last confirmation, or null if never confirmed. */
  verifiedAt: string | null;
}

/**
 * The request path for official document artifacts. Reads the cache only —
 * never the internet.
 *
 * Delivery is a READ and writes nothing into `public.documents`, for the same
 * reason the forms path does not: that table is applicant evidence.
 * vri/graphs/nodes/load-vri-data.ts scores every row in it and
 * documents/graphs/nodes/check-docs-ready.ts waits for all rows to reach a
 * terminal ocr_status, so inserting a blank checklist there would inflate the
 * readiness score and — with no OCR job ever enqueued for it — block
 * cross-verification for that application permanently.
 */
@Injectable()
export class DocTemplatesService {
  private readonly log = new Logger(DocTemplatesService.name);

  constructor(private readonly store: DocumentTemplateStore) {}

  async listForApplication(
    db: SupabaseClient,
    applicationId: string,
    // Deliberately unused for authorization: the RLS-scoped `db` below is the
    // sole gate (a foreign application simply returns no row). A future edit
    // must NOT turn this into a manual `user_id` comparison — a second,
    // hand-rolled check could drift from RLS and either over- or under-grant.
    _userId: string,
  ): Promise<DeliveredDocumentTemplate[]> {
    const { data: app, error } = await db
      .from('applications')
      .select(
        'id, destination_country, visa_type_id, visa_types(visaai_id), country_frameworks(country_code, visa_type)',
      )
      .eq('id', applicationId)
      .single();

    // PGRST116 is what `.single()` returns for BOTH a genuine miss and an
    // RLS-hidden row — the two cases we must not distinguish (uniform 404 is
    // anti-enumeration hygiene). Any other code is a real backend failure and
    // must not be reported as "application not found".
    if (error && error.code !== 'PGRST116') {
      this.log.error(
        `applications lookup failed for ${applicationId}: ${error.message}`,
      );
      throw new ServiceUnavailableException(
        'Could not load your application right now',
      );
    }
    if (!app) throw new NotFoundException('Application not found');

    const framework = app.country_frameworks as unknown as {
      country_code: string;
      visa_type: string;
    } | null;
    const destinationCountry = app.destination_country as string | null;

    // Same resolution order as the forms path: an explicit framework wins;
    // otherwise destination_country (which the real intake path DOES populate)
    // and the union of every program's artifacts; otherwise nothing.
    const visaaiId = (
      app as { visa_types?: { visaai_id?: string | null } | null }
    ).visa_types?.visaai_id;
    const routed = strategyRegistry.resolveRoute(destinationCountry, visaaiId);

    let required: RequiredDocumentTemplate[];
    if (routed && !framework) {
      // A PROGRAM CLAIMS THIS ROUTE: it gets the artifacts the program itself
      // names, and none when it names none (the Canada eTA). The country
      // fallback is "every artifact this country uses across all its
      // programs" — for a claimed route that is the wrong answer (dry run
      // 2026-10-16: an eTA applicant was handed visitor-visa artifacts).
      // Unclaimed routes keep the country fallback below.
      required = documentTemplatesForRoute(
        destinationCountry!,
        routed.program,
        visaaiId!,
      );
    } else if (framework) {
      required = documentTemplatesForApplication(
        framework.country_code,
        framework.visa_type,
      );
    } else if (destinationCountry && visaaiId) {
      // A KNOWN route no program claims: only what applies to every program
      // in the country. The union is reserved for an application whose route
      // is unknown — handing a known route other programs' checklists was the
      // bug (a Canada TRV applicant saw the study and work permit lists).
      required = documentTemplatesForUnclaimedRoute(destinationCountry);
    } else if (destinationCountry) {
      required = documentTemplatesForCountry(destinationCountry);
    } else {
      return [];
    }

    const out: DeliveredDocumentTemplate[] = [];
    for (const tpl of required) {
      // A cache read failure must not cost the applicant the whole page: this
      // one artifact degrades to the official link — today's behaviour — while
      // the rest of the loop still serves whatever it can.
      let row: DocumentTemplateRow | null = null;
      try {
        row = await this.store.find({
          // Uppercased at the lookup site: the strategy registry resolves a
          // country code case-insensitively but the Postgres `.eq()` filter
          // does not, so a lowercase 'ca' would silently miss every cached row.
          countryCode: tpl.countryCode.toUpperCase(),
          program: tpl.program,
          templateCode: tpl.templateCode,
        });
      } catch (err) {
        this.log.warn(
          `document_templates lookup failed for ${tpl.templateCode}: ${
            err instanceof Error ? err.message : String(err)
          } — falling back to the official link`,
        );
        row = null;
      }

      // Derived from the row we already read: no Storage round trip on a page
      // load, and no way to mint a link the browser cannot follow.
      const cached =
        row?.storage_path && (row.status === 'ok' || row.status === 'stale');
      const downloadPath = cached
        ? DOC_FILE_ROUTE(applicationId, tpl.templateCode)
        : null;

      // Assessed on the row, not on whether a signed URL was minted: a copy we
      // have not re-confirmed in a month is exactly the case this gate exists
      // for, and it is indistinguishable from a healthy one at the storage layer.
      const freshness = row
        ? assessFreshness({
            status: row.status,
            lastVerifiedAt: row.last_verified_at,
          })
        : { level: 'unverified' as const, ageDays: null, verifiedAt: null };

      out.push({
        countryCode: tpl.countryCode,
        templateCode: tpl.templateCode,
        templateName: tpl.templateName,
        kind: tpl.kind,
        documentCode: tpl.documentCode ?? null,
        versionLabel: row?.version_label ?? null,
        downloadPath,
        officialUrl: tpl.sourceUrl,
        source: downloadPath ? 'cache' : 'official-link',
        freshness: freshness.level,
        verifiedAt: freshness.verifiedAt,
      });
    }
    return out;
  }

  /**
   * The cached bytes for one artifact, for the streaming route.
   *
   * Authorization is the same RLS-scoped application read the listing does, so
   * the file route cannot be used to probe which application ids exist.
   */
  async fileFor(
    db: SupabaseClient,
    applicationId: string,
    templateCode: string,
  ): Promise<{ bytes: Uint8Array; filename: string; contentType: string }> {
    const delivered = await this.listForApplication(db, applicationId, '');
    const match = delivered.find((t) => t.templateCode === templateCode);
    if (!match?.downloadPath) {
      throw new NotFoundException('Document not available');
    }

    // Country-scoped: 'ICAO-PHOTO' exists for 29 Schengen states, and the row
    // this applicant is entitled to is the one for THEIR destination — which
    // the listing already resolved, so it is taken from the match rather than
    // re-derived.
    const row = await this.store.findByTemplateCode(
      match.countryCode,
      templateCode,
    );
    if (!row?.storage_path)
      throw new NotFoundException('Document not available');

    const bytes = await this.store.getBytes(row.storage_path);
    if (!bytes) {
      this.log.error(
        `document ${templateCode}: storage_path ${row.storage_path} has no object`,
      );
      throw new NotFoundException('Document not available');
    }

    const safe = templateCode.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      bytes,
      filename: `${safe}.pdf`,
      contentType: row.content_type ?? 'application/pdf',
    };
  }
}
