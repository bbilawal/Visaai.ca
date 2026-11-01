import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateRule } from '../visa-rules/rule-evaluator';
import type { RuleNode } from '../visa-rules/rule.types';
import { profileToRuleFacts } from '../visa-rules/profile-to-rule-facts';
import { FormTemplateStore, type FormTemplateRow } from './form-template.store';
import {
  requiredFormsFor,
  formsForCountry,
  type RequiredForm,
} from './form-catalog';
import type { FormCapability } from './capability/form-capability.probe';
import { assessFreshness, type FreshnessLevel } from './freshness';

/**
 * WHY THE BYTES ARE PROXIED AND NOT SIGNED
 *
 * This used to hand the browser a Supabase Storage signed URL. MEASURED in
 * production 2026-08-13: `SUPABASE_URL` on the VPS is `http://127.0.0.1:54421`
 * — Kong listens on loopback only, with no nginx route and no public hostname.
 * supabase-js builds a signed URL from that base, so every download link the
 * API returned pointed at the SERVER'S OWN loopback and was unreachable from
 * any browser. The forms feature looked live and was not.
 *
 * Serving the bytes through the API fixes it without exposing Supabase Storage
 * to the internet: the file never leaves our origin, authorization stays in
 * JwtGuard + the RLS-scoped application check, and these are small blank
 * government PDFs (0.3-2.8 MB) fetched rarely, so proxying costs nothing that
 * matters.
 */
export const FORM_FILE_ROUTE = (applicationId: string, formCode: string) =>
  `/forms/${applicationId}/file/${encodeURIComponent(formCode)}`;

export interface DeliveredForm {
  formCode: string;
  formName: string;
  capability: FormCapability;
  versionLabel: string | null;
  /**
   * API path that streams the cached blank form, or null when none is cached.
   * RELATIVE on purpose — the client prefixes it with NEXT_PUBLIC_API_URL, and
   * the API has no reliable knowledge of its own public origin.
   */
  downloadPath: string | null;
  /** The government landing page. Always present as a fallback and a check. */
  officialUrl: string | null;
  source: 'cache' | 'official-link';
  /** Can VisaAI produce a filled copy? False for XFA forms. */
  prefillable: boolean;
  /**
   * How recently the cached copy was confirmed against the government site.
   * 'unverified' means we are still serving it — a copy beats nothing — but
   * we no longer claim it is current, and the UI leads with the official page.
   */
  freshness: FreshnessLevel;
  /** ISO date of that last confirmation, or null if never confirmed. */
  verifiedAt: string | null;
}

/**
 * The request path. Reads the cache only — never the internet.
 *
 * Delivery is a READ, not a write into `public.documents`. That table is
 * applicant evidence: vri/graphs/nodes/load-vri-data.ts scores every row, and
 * documents/graphs/nodes/check-docs-ready.ts waits for all rows to reach a
 * terminal ocr_status. Inserting a blank form there would inflate the
 * readiness score and, since no OCR job is enqueued for it, block
 * cross-verification for that application permanently.
 *
 * Degradation is deliberate: `blocked`, missing, and errored rows all fall
 * back to the official landing link, which is exactly what the applicant does
 * today. The feature can only improve on the status quo, never break it.
 */
@Injectable()
export class FormsService {
  private readonly log = new Logger(FormsService.name);

  constructor(private readonly store: FormTemplateStore) {}

  async listForApplication(
    db: SupabaseClient,
    applicationId: string,
    // Deliberately unused for authorization: the RLS-scoped `db` client above
    // is the sole gate (a foreign application simply returns no row). A future
    // edit must NOT turn this into a manual `user_id` comparison — a second,
    // hand-rolled check could drift from RLS and either over- or under-grant.
    _userId: string,
  ): Promise<DeliveredForm[]> {
    // The caller-scoped client enforces RLS: an application belonging to
    // someone else returns no row, so this doubles as the authorization check.
    const { data: app, error } = await db
      .from('applications')
      .select(
        'id, destination_country, visa_type_id, country_frameworks(country_code, visa_type)',
      )
      .eq('id', applicationId)
      .single();

    // PGRST116 ("Cannot coerce the result to a single JSON object", 0 rows) is
    // MEASURED (2026-08-11, local Supabase stack, postgrest/14.5) as the code
    // `.single()` returns for both a genuine miss and an RLS-hidden row — the
    // two cases we must NOT distinguish in the response (uniform 404 is
    // anti-enumeration hygiene). Any OTHER code is a real backend failure and
    // must not be silently reported as "application not found".
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

    // Resolution order:
    //   0. The sourced registry, keyed on the visa type the applicant actually
    //      chose. Every row is quoted from a government page, so this is the
    //      only source that can say "these forms, for THIS route" — the
    //      country fallback below answers a different, blunter question.
    //   1. An explicit framework (country + a SPECIFIC program) is
    //      authoritative when present.
    //   2. Otherwise fall back to destination_country, which IS populated by
    //      the real intake path (intake.service.ts) even though framework_id
    //      never is — see formsForCountry's doc comment for why the union of
    //      every program's forms, not a guess at one program, is the safe
    //      default here.
    //   3. Neither present: nothing to offer.
    const visaTypeId = (app as { visa_type_id?: string | null }).visa_type_id;
    const fromRegistry = visaTypeId
      ? await this.registryForms(db, visaTypeId, applicationId)
      : [];

    let countryCode: string;
    let required: RequiredForm[];
    if (fromRegistry.length > 0) {
      // The country still matters for the cache lookup even when the form list
      // came from the registry.
      countryCode = framework?.country_code ?? destinationCountry ?? '';
      required = fromRegistry;
    } else if (visaTypeId && !framework) {
      // A ROUTE IS CHOSEN AND THE REGISTRY HAS NO FORMS FOR IT.
      //
      // The country fallback answers a different question — "every form this
      // country uses, across all its programs" — and offering that as this
      // application's forms is a wrong answer, not a thin one. Observed on
      // production 2026-09-03: a Super visa application was handed IMM 1294
      // (study permit) and IMM 1295 (work permit) because neither the registry
      // nor a framework named its forms.
      //
      // An applicant who downloads and fills the wrong government form loses
      // real time and may file it. Nothing is the honest answer until the
      // registry covers the route; the surface renders no section at all.
      return [];
    } else if (framework) {
      countryCode = framework.country_code;
      required = requiredFormsFor(framework.country_code, framework.visa_type);
    } else if (destinationCountry) {
      countryCode = destinationCountry;
      required = formsForCountry(destinationCountry);
    } else {
      return [];
    }

    const out: DeliveredForm[] = [];
    for (const form of required) {
      // A cache read failure must not cost the applicant the whole page: this
      // one form degrades to the official link — today's behaviour — while
      // the rest of the loop still serves whatever it can. Logged so the
      // failure is visible to us even though the applicant never sees it.
      let row: FormTemplateRow | null = null;
      try {
        row = form.program
          ? await this.store.find({
              // Uppercased at the lookup site: the strategy registry resolves a
              // country code case-insensitively, but the Postgres `.eq()` filter
              // does not — a lowercase 'ca' must not silently miss the cached
              // row and degrade every form to the official link (M1).
              countryCode: countryCode.toUpperCase(),
              program: form.program,
              formCode: form.formCode,
            })
          : // A registry-sourced form carries no program — the registry is
            // keyed on visa type, and `form_templates` is keyed on the legacy
            // program ids. Look the cached copy up by code, which is what the
            // renderer registry is keyed on anyway.
            await this.store.findByFormCode(form.formCode);
      } catch (err) {
        this.log.warn(
          `form_templates lookup failed for ${form.formCode}: ${
            err instanceof Error ? err.message : String(err)
          } — falling back to the official link`,
        );
        row = null;
      }

      // No network call and nothing to fail: the path is derived from the row
      // we already read, and the bytes are fetched only if the user asks for
      // them. The old signed-URL mint was one Storage round trip per form on
      // every page load, and it silently produced unreachable links.
      const cached =
        row?.storage_path && (row.status === 'ok' || row.status === 'stale');
      const downloadPath = cached
        ? FORM_FILE_ROUTE(applicationId, form.formCode)
        : null;

      // Age is assessed on the row, not on whether a signed URL was minted:
      // a cached copy we have not been able to re-confirm for a month is the
      // case this gate exists for, and it looks identical to a healthy one
      // from the storage layer's point of view.
      const freshness = row
        ? assessFreshness({
            status: row.status,
            lastVerifiedAt: row.last_verified_at,
          })
        : { level: 'unverified' as const, ageDays: null, verifiedAt: null };

      out.push({
        formCode: form.formCode,
        formName: form.formName,
        capability: row?.capability ?? 'unknown',
        versionLabel: row?.version_label ?? null,
        downloadPath,
        officialUrl: form.landingUrl,
        source: downloadPath ? 'cache' : 'official-link',
        prefillable: row?.capability === 'acroform',
        freshness: freshness.level,
        verifiedAt: freshness.verifiedAt,
      });
    }
    return out;
  }

  /**
   * The official forms this visa type requires, straight from the registry.
   *
   * `kind = 'form'` rows carry `official_form_code` and `official_form_url` —
   * a code to look a cached blank up by and the government page it came from.
   * Rows without a code are skipped: a form we cannot name is not one the
   * applicant can be handed.
   *
   * Returns [] on any failure. This is an ADDITIONAL source in front of two
   * existing ones; a registry read that fails must fall through to them, never
   * empty the list.
   */
  private async registryForms(
    db: SupabaseClient,
    visaTypeId: string,
    applicationId: string,
  ): Promise<RequiredForm[]> {
    const { data, error } = await db
      .from('visa_requirements')
      .select('official_form_code, official_form_url, label, requirement_code, rule')
      .eq('visa_type_id', visaTypeId)
      .eq('kind', 'form')
      .eq('status', 'active')
      .order('display_order', { ascending: true });

    if (error) {
      this.log.warn(
        `registry form lookup failed for visa type ${visaTypeId}: ${error.message} — no official forms will be offered for this route`,
      );
      return [];
    }

    // A form whose rule the applicant's answers rule OUT is not theirs: the
    // common-law declaration (IMM 5409) was listed for a married study permit
    // applicant (live E2E 2026-10-20). Same verdicts as the checklist: only a
    // definite 'false' drops it; an unanswered fact keeps it listed.
    const rows = (data ?? []) as Array<{
      official_form_code: string | null;
      official_form_url: string | null;
      label: string | null;
      requirement_code: string;
      rule?: unknown;
    }>;
    const facts = rows.some((r) => r.rule)
      ? profileToRuleFacts(await this.profileOf(db, applicationId))
      : {};

    const seen = new Set<string>();
    const out: RequiredForm[] = [];
    for (const r of rows) {
      const formCode = r.official_form_code?.trim();
      if (!formCode || seen.has(formCode)) continue;
      if (evaluateRule((r.rule ?? null) as RuleNode | null, facts) === 'false') continue;
      seen.add(formCode);
      out.push({
        formCode,
        formName: r.label?.trim() || formCode,
        landingUrl: r.official_form_url,
        portalId: '',
        // Empty on purpose: see the cache lookup in listForApplication.
        program: '',
      });
    }
    return out;
  }

  /** The application's intake profile, or {} when it cannot be read. */
  private async profileOf(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await db
      .from('application_profiles')
      .select('profile_json')
      .eq('application_id', applicationId)
      .maybeSingle();
    if (error) {
      // Unknown facts keep every form listed — today's behaviour.
      this.log.warn(
        `profile lookup failed for ${applicationId}: ${error.message} — conditional forms stay listed`,
      );
      return {};
    }
    return ((data as { profile_json?: Record<string, unknown> } | null)?.profile_json ?? {});
  }

  /**
   * The cached bytes for one form, for the streaming route.
   *
   * Authorization is the SAME RLS-scoped application read the listing does — a
   * foreign application returns no row and this answers 404, so the file route
   * cannot be used to reach a form for someone else's application (blank
   * government forms are not secret, but the route must not become a way to
   * probe which application ids exist).
   */
  async fileFor(
    db: SupabaseClient,
    applicationId: string,
    formCode: string,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    const delivered = await this.listForApplication(db, applicationId, '');
    const match = delivered.find((f) => f.formCode === formCode);
    if (!match || !match.downloadPath) {
      throw new NotFoundException('Form not available');
    }

    const row = await this.store.findByFormCode(formCode);
    if (!row?.storage_path) throw new NotFoundException('Form not available');

    const bytes = await this.store.getBytes(row.storage_path);
    if (!bytes) {
      // The row promised bytes that storage does not have. That is a real
      // inconsistency worth an ERROR line, not a silent 404 to the applicant.
      this.log.error(
        `form ${formCode}: storage_path ${row.storage_path} has no object`,
      );
      throw new NotFoundException('Form not available');
    }

    const safe = formCode.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { bytes, filename: `${safe}.pdf` };
  }
}
