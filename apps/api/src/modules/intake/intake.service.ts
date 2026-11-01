import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { strategyRegistry } from '../../strategies';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { AiCacheService } from '../shared/ai/ai-cache.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';
import { buildIntakeGraph } from './graphs/intake.graph';
import {
  makeUpdateChecklistNode,
  type DiscoveryProgress,
} from './graphs/nodes/update-checklist';
import { makeLoadFrameworkNode } from './graphs/nodes/load-framework';
import { checkComplete } from './graphs/nodes/check-complete';
import { chatModelForTask } from '../shared/ai/model-factory';
import type { AskQuestionHooks } from './graphs/nodes/ask-question';
import { classifyIntakeMessage } from './scope-guard';
import type { IntakeState } from './graphs/intake.state';
import type { Env } from '../../config/configuration';
import type { Database } from '@visaai/types';

/**
 * Columns selected from `visa_types`, pinned to the generated schema.
 *
 * `satisfies` makes a wrong column name a COMPILE error. It exists because a
 * wrong one shipped: this query originally asked for `name` and `active`, and
 * `visa_types` has neither — it has `official_name` and `lifecycle_state`. The
 * unit tests could not catch it, because a hand-written Supabase stub returns
 * its fixture regardless of which columns were requested. Only the database
 * knows, so the type is the only place that check can live.
 */
const VISA_TYPE_COLUMNS = [
  'id',
  'visaai_id',
  'official_name',
  'official_code',
  'category',
  'data_quality',
  'lifecycle_state',
] as const satisfies readonly (keyof Database['public']['Tables']['visa_types']['Row'])[];

/**
 * Long enough to cover a slow opening generation, short enough that a crashed
 * holder does not block the next attempt for long.
 */
const START_LOCK_TTL_SECONDS = 180;
/** How long a losing caller waits for the winner's checkpoint before giving up. */
const START_WAIT_MS = 90_000;
const START_POLL_MS = 750;
const MESSAGE_LOCK_TTL_SECONDS = 180;

/** The checklist as `getChecklist` returns it. Derived from that method rather
 *  than restated, so the in-flight cache below can never drift from it. */
type Checklist = Awaited<ReturnType<IntakeService['getChecklist']>>;

@Injectable()
export class IntakeService {
  private readonly openaiKey: string;

  /**
   * Rebuilds currently running, keyed by application id.
   *
   * PERF-002: the rebuild is a structured model generation measured at 9-21s,
   * and NOTHING stopped two of them running at once for the same application.
   * The freshness guard below cannot: it reads `checklistBuiltAt`, which is
   * only written when a build FINISHES, so every request arriving inside the
   * window sails past it and starts its own generation. Measured on production
   * 2026-09-06: two rebuilds of application 85b16b26 started 1.9s apart and
   * took 12.6s and 11.8s -- the same list, derived twice from the same profile,
   * at twice the model spend, while the applicant watched an empty vault.
   * Opening the documents page twice in twelve seconds is enough to do it.
   *
   * Callers arriving mid-build now await the build already running instead of
   * starting another. The API runs in pm2 fork mode (a single process), so an
   * in-process map is the whole coordination surface; behind multiple workers
   * this would need to move to Redis, which is where `checkpoint` already
   * lives.
   */
  private readonly rebuildsInFlight = new Map<string, Promise<Checklist>>();

  constructor(
    private supabase: SupabaseService,
    private checkpoint: CheckpointService,
    private config: ConfigService<Env>,
    private bus: AssignmentEventBus,
    private meter: AiUsageMeter,
    @Optional() private readonly analytics?: AnalyticsEventBus,
    @Optional() private readonly aiCache?: AiCacheService,
  ) {
    this.openaiKey = this.config.get('OPENAI_API_KEY', { infer: true })!;
  }

  async createApplication(
    db: SupabaseClient,
    userId: string,
    input: { country?: string; state?: string; frameworkId?: string },
  ): Promise<string> {
    const siteMode = this.config.get('SITE_MODE', { infer: true }) ?? 'global';
    if (siteMode === 'canada' && !input.country) {
      throw new BadRequestException('A Canadian destination country is required');
    }
    if (!input.frameworkId && !input.country) {
      throw new BadRequestException(
        'Either a destination country or a framework is required',
      );
    }

    // Backend enforcement of the supported-country set. The registry is the
    // single source of truth (same one GET /countries exposes to the UI), so a
    // direct API call cannot create an application for a country we do not
    // actually support — even if the dropdown is bypassed. Resolve to the
    // canonical code (e.g. 'ca' -> 'CA') so stored values stay consistent with
    // consultant_countries / strategy lookups.
    let destinationCountry: string | null = null;
    if (input.country) {
      const strategy = strategyRegistry.getCountry(input.country);
      if (!strategy) {
        throw new BadRequestException(
          `Unsupported destination country: ${input.country}`,
        );
      }
      if (siteMode === 'canada' && strategy.code !== 'CA') {
        throw new BadRequestException(
          `This site only supports Canadian applications: ${input.country}`,
        );
      }
      // Non-selectable strategies (e.g. the legacy 'SCHENGEN' bloc) stay
      // registered so existing rows keep resolving, but must not be used to
      // CREATE new applications — the UI offers the 27 members instead. Blocks
      // a direct/bypass API call from minting new bloc-coded rows.
      if (strategy.selectable === false) {
        throw new BadRequestException(
          `Destination country is no longer selectable: ${input.country}`,
        );
      }
      destinationCountry = strategy.code;
    }

    const { data, error } = await db
      .from('applications')
      .insert({
        user_id: userId,
        framework_id: input.frameworkId ?? null,
        destination_country: destinationCountry,
        destination_state: input.state ?? null,
      })
      .select('id')
      .single();

    if (error || !data) throw new Error('Failed to create application');

    await db.from('application_profiles').insert({ application_id: data.id });

    // Real-time: a new application enters every eligible consultant's queue.
    this.bus.emit({
      type: 'APPLICATION_CREATED',
      application_id: data.id,
      destination_country: destinationCountry,
      previous_consultant_id: null,
      new_consultant_id: null,
    });

    // Analytics: allowlisted non-PII fields only (ids/enums — no profile data).
    this.analytics?.emitSafe(
      makeServerEvent('application.created', {
        user_id: userId,
        application_id: data.id,
        props: {
          country: destinationCountry,
          state: input.state ?? null,
          framework_id: input.frameworkId ?? null,
        },
      }),
    );

    return data.id;
  }

  /**
   * The visa routes an applicant may choose for this application.
   *
   * Returns EVERY registered visa type for the destination country, each
   * carrying how many sourced requirements it has — not only the covered ones.
   *
   * Filtering to covered routes was the tempting version and it is wrong. A
   * person applying for an Australian student visa does not stop needing one
   * because a WAF blocks our monitor; hiding the option would silently tell
   * them VisaAI does not do that, when the truth is that we do not yet have
   * its requirements. Showing the count lets the surface say which is which,
   * and picking an uncovered route is harmless — load-framework falls through
   * to discovery mode exactly as it does today.
   */
  async listVisaTypesForApplication(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    const app = await this.getApplication(db, applicationId, userId);
    if (!app) throw new ForbiddenException('Access denied');

    if (!app.destination_country) return [];

    const { data: country } = await db
      .from('visa_countries')
      .select('id')
      .eq('code', app.destination_country)
      .maybeSingle();
    if (!country) return [];

    const { data, error } = await db
      .from('visa_types')
      .select(VISA_TYPE_COLUMNS.join(', '))
      // 'active' is a lifecycle_state value, not a boolean column. A retired
      // visa type stays in the table so existing applications keep resolving.
      .eq('country_id', country.id)
      .eq('lifecycle_state', 'active')
      .order('official_name');
    if (error || !data) return [];

    const { data: counts } = await db
      .from('visa_requirements')
      .select('visa_type_id')
      .eq('status', 'active')
      .in(
        'visa_type_id',
        data.map((t) => (t as unknown as { id: string }).id),
      );

    const tally = new Map<string, number>();
    for (const row of counts ?? []) {
      const id = row.visa_type_id;
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }

    return data.map((t) => {
      // Cast through `unknown`: VISA_TYPE_COLUMNS is joined at runtime, and
      // supabase-js can only infer row shapes from a LITERAL select string, so
      // it widens these to GenericStringError. The column names themselves are
      // still checked at compile time by the `satisfies` on VISA_TYPE_COLUMNS.
      const row = t as unknown as {
        id: string;
        visaai_id: string;
        official_name: string;
        official_code: string | null;
        category: string | null;
        data_quality: string | null;
      };
      return {
        id: row.id,
        visaaiId: row.visaai_id,
        name: row.official_name,
        officialCode: row.official_code,
        category: row.category,
        dataQuality: row.data_quality,
        /** Sourced requirements behind this route. 0 means discovery mode. */
        requirementCount: tally.get(row.id) ?? 0,
      };
    });
  }

  /**
   * Record which visa the application is for.
   *
   * This is the write that the whole sourced registry was waiting on. Until it
   * existed, `applications` had no column naming a route (see migration
   * 20260821170000), so there was no key to look a requirement set up by and
   * 293 verified requirements served only the public marketing pages.
   *
   * The visa type MUST belong to the application's destination country. A
   * caller who posts a Canadian visa type onto a UK application is either
   * confused or probing, and accepting it would build a checklist of the wrong
   * country's documents — which reads as authoritative because it comes from
   * the registry.
   */
  async setVisaType(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    visaTypeId: string | null,
  ) {
    const app = await this.getApplication(db, applicationId, userId);
    if (!app) throw new ForbiddenException('Access denied');

    if (visaTypeId !== null) {
      const { data: visaType } = await db
        .from('visa_types')
        .select('id, lifecycle_state, visa_countries!inner(code)')
        .eq('id', visaTypeId)
        .maybeSingle();

      if (!visaType) throw new BadRequestException('Unknown visa type');

      const row = visaType as unknown as {
        lifecycle_state: string;
        visa_countries: { code: string } | { code: string }[];
      };
      if (row.lifecycle_state !== 'active') {
        throw new BadRequestException('That visa type is no longer offered');
      }
      const joined = Array.isArray(row.visa_countries)
        ? row.visa_countries[0]
        : row.visa_countries;
      if (joined?.code !== app.destination_country) {
        throw new BadRequestException(
          'That visa type belongs to a different country than this application',
        );
      }
    }

    const previous = (app.visa_type_id as string | null) ?? null;
    if (previous === visaTypeId) return { visaTypeId, changed: false };

    const { error } = await db
      .from('applications')
      .update({ visa_type_id: visaTypeId })
      .eq('id', applicationId)
      .eq('user_id', userId);
    if (error) {
      // The message, code and hint, not just "it failed".
      //
      // This threw a bare 'Failed to set visa type' and dropped everything
      // PostgREST said. A live 500 on this route turned out to be
      // "infinite recursion detected in policy for relation applications" —
      // a broken RLS policy, diagnosable in seconds from that string and
      // invisible without it. The route answered 500 for weeks saying nothing.
      //
      // Safe to log: these are schema-level diagnostics (code, constraint,
      // policy), never row data.
      throw new Error(
        `Failed to set visa type: ${error.message}` +
          (error.code ? ` [${error.code}]` : '') +
          (error.hint ? ` — ${error.hint}` : ''),
      );
    }

    // The saved checkpoint holds requirementsJson built for the OLD route. Left
    // in place, the graph would resume with the previous visa's documents and
    // never re-read the registry. Dropping the checkpoint costs the applicant a
    // re-derivation, not their answers: profile_json, checklist_items and the
    // message history all live in Postgres, not in the checkpoint.
    await this.checkpoint.delete(applicationId);
    await this.retireStaleRouteItems(db, applicationId);

    this.analytics?.emitSafe(
      makeServerEvent('application.visa_type_set', {
        user_id: userId,
        application_id: applicationId,
        props: {
          country: (app.destination_country as string | null) ?? null,
          visa_type_id: visaTypeId,
          changed_from: previous,
        },
      }),
    );

    return { visaTypeId, changed: true };
  }

  /**
   * The application, scoped to its owner — or null when there is no such row
   * for this user.
   *
   * Null MUST mean "no row", and nothing else. This used to return `data`
   * while discarding `error`, so every transport-level failure — PostgREST
   * unreachable, an access token that expired mid-session, a 5xx under load —
   * arrived at the caller as `null` and was reported to the applicant as
   * `Access denied`, a permanent-sounding refusal for a condition that a
   * retry one second later resolves. Observed in production 2026-09-03: an
   * intake died on `intake:start failed: Access denied` while the very next
   * REST call on the same application, same user, answered 200.
   *
   * `.single()` signals the empty result with PGRST116; that is the only code
   * that means denied. Anything else is a fault and is thrown, so the socket
   * layer can classify it as retryable instead of fatal.
   */
  async getApplication(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    const { data, error } = await db
      .from('applications')
      .select('*, country_frameworks(country_code, visa_type, purpose)')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[intake] getApplication query failed', {
        applicationId,
        code: error.code,
        message: error.message,
        details: error.details,
      });
      throw new ServiceUnavailableException(
        `Could not read the application (${error.code ?? 'unknown'})`,
      );
    }

    return data;
  }

  /**
   * Build the document checklist for this application, now.
   *
   * The interview no longer does this. Outside Canada the checklist comes from
   * `discoveryChecklist`, a structured generation measured at 9.4–10.0s, and it
   * used to fire on every single turn — rebuilding a list the applicant is not
   * looking at while they are still answering questions. One intake of a dozen
   * turns paid for a dozen of them.
   *
   * It is called instead when the documents surface is opened, which is the
   * first moment the list is actually read. `getChecklist` stays the cheap
   * read-only path; this is the one that regenerates.
   *
   * Runs the node directly rather than the graph: the graph's other nodes would
   * append to the transcript and re-decide completion, neither of which belongs
   * in "show me my documents".
   */
  async rebuildChecklist(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    /**
     * Notified with each batch of items the model finishes writing, so a caller
     * that can render progressively does not have to wait out the whole
     * generation. Only the caller that STARTS the build is streamed to: one
     * joining an in-flight build gets the finished list, which is what it would
     * have got before any of this existed.
     */
    onProgress?: DiscoveryProgress,
  ): Promise<Checklist> {
    // Authorization is per-caller and stays OUTSIDE the shared work below: a
    // second caller must prove they own this application before they are
    // allowed to await someone else's build of it.
    const app = await this.getApplication(db, applicationId, userId);
    if (!app) throw new ForbiddenException('Access denied');

    const running = this.rebuildsInFlight.get(applicationId);
    if (running) {
      console.log('[intake:timing] rebuild_checklist joined in-flight build');
      return running;
    }

    const build = this.buildChecklist(
      db,
      app,
      applicationId,
      userId,
      onProgress,
    );
    this.rebuildsInFlight.set(applicationId, build);
    try {
      return await build;
    } finally {
      // Cleared whether the build resolved or threw, so a failure does not
      // pin every later caller to the same rejection.
      this.rebuildsInFlight.delete(applicationId);
    }
  }

  /** The actual rebuild. Callers go through `rebuildChecklist`, which
   *  authorizes them and coalesces concurrent builds onto one run. */
  private async buildChecklist(
    db: SupabaseClient,
    app: Awaited<ReturnType<IntakeService['getApplication']>>,
    applicationId: string,
    userId: string,
    onProgress?: DiscoveryProgress,
  ): Promise<Checklist> {
    const saved = (await this.checkpoint.load(
      applicationId,
    )) as IntakeState | null;

    // A MISSING CHECKPOINT IS NOT AN EMPTY APPLICATION.
    //
    // This used to return the stored list and build nothing, reasoning that no
    // interview had run so there was nothing to derive from. That closed the
    // door on precisely the applicant who most needs a checklist, because
    // `setVisaType` DELETES the checkpoint by design — it holds requirements
    // for the old route.
    //
    // So the sequence a new applicant actually takes was a dead end: choose a
    // visa type, land on the documents page, rebuild finds no checkpoint,
    // returns nothing, and the vault stays empty however many times it is
    // opened. Observed live on 2026-09-04: an Express Entry application with a
    // route chosen, 17 active requirements in the registry, and 0
    // checklist_items. The comment below claiming a route change "forces a
    // rebuild for free" had it exactly backwards — deleting the checkpoint did
    // not force a rebuild, it disabled rebuilding entirely.
    //
    // Everything the derivation needs is in Postgres: the route and country on
    // `applications`, the answers so far in `application_profiles`. Rehydrate
    // from there instead of giving up.
    const base: IntakeState =
      saved ?? (await this.blankIntakeState(db, applicationId));

    // Only regenerate when the answer would actually differ.
    //
    // The documents surface calls this on every open, and the generation costs
    // 9–21s of model time — three visits in two minutes was observed live, all
    // three rebuilding the same list from the same profile. The interview is
    // the only thing that can change the answer, so a build is stale exactly
    // when the profile has moved since the last one.
    //
    // `checklistBuiltAt` rides on the checkpoint, which `setVisaType` deletes
    // when the route changes. A rehydrated state therefore carries null here,
    // which makes `isFresh` false and forces the build — the case that most
    // needs one, and the case that previously returned early with nothing.
    const existing = await this.getChecklist(db, applicationId, userId);
    const { data: profileRow } = await db
      .from('application_profiles')
      .select('last_updated_at')
      .eq('application_id', applicationId)
      .maybeSingle();
    const profileAt = profileRow?.last_updated_at;
    const builtAt = base.checklistBuiltAt ?? null;
    const isFresh =
      existing.length > 0 &&
      builtAt !== null &&
      (!profileAt || profileAt <= builtAt);
    if (isFresh) {
      console.log('[intake:timing] rebuild_checklist skipped (fresh)');
      return existing;
    }

    const language = await this.getUserLanguage(db, userId);
    const node = makeUpdateChecklistNode(
      db,
      // Not `intake_answer_extraction`: that task is budgeted for turning one
      // short answer into facts (1,024 output tokens), and this node emits a
      // whole checklist. Borrowing it truncated the response mid-structure and
      // the applicant got an empty vault.
      chatModelForTask('intake_checklist_discovery', {
        apiKey: this.openaiKey,
        meter: this.meter,
        ctx: { applicationId, userId },
      }),
      language,
      // Shared across applicants for the no-answers case only — see the node.
      // Optional in the service too, so a deployment without Redis simply does
      // the work every time rather than failing.
      this.aiCache,
      onProgress,
    );

    // The route may have been chosen since the checkpoint was written, and it
    // is what decides registry-sourced vs discovered requirements.
    const withRoute: IntakeState = {
      ...base,
      visaTypeId:
        (app.visa_type_id as string | null) ?? base.visaTypeId ?? null,
    };

    // `updateChecklist` reads `requirementsJson` to decide between the sourced
    // registry and discovery, and a rehydrated state has none — it lives only
    // on the checkpoint. Load it the same way the graph's first node does, so
    // both paths derive from the same requirements.
    const state: IntakeState = saved
      ? withRoute
      : {
          ...withRoute,
          ...(await makeLoadFrameworkNode(db)(withRoute)),
        };

    const startedAt = Date.now();
    try {
      const result = await node(state);
      await this.checkpoint.save(applicationId, {
        ...state,
        ...result,
        checklistBuiltAt: new Date().toISOString(),
      });
    } catch (err) {
      // A failed rebuild must not deny the applicant the documents they already
      // have. Fall through to the stored list — and leave `checklistBuiltAt`
      // alone, so the next open retries rather than trusting a build that never
      // finished.
      console.error(
        '[intake] checklist rebuild failed:',
        err instanceof Error ? err.message : err,
      );
    } finally {
      console.log(
        `[intake:timing] rebuild_checklist ${Date.now() - startedAt}ms`,
      );
    }

    return this.getChecklist(db, applicationId, userId);
  }

  /**
   * Drop the previous route's registry-derived checklist items.
   *
   * Changing the route re-derives the checklist, but `update-checklist` only
   * ever ADDS — it never removes what is already there. So the old route's
   * documents stayed on the list next to the new route's, and the applicant was
   * shown documents for a visa they are not applying for.
   *
   * Observed on production 2026-09-04: a Study permit application whose vault
   * listed "A valid email address", "An accepted credit or debit card to pay
   * the eTA fee" and "A valid passport from a visa-exempt country or
   * territory". All three belong to the Electronic travel authorization route,
   * which that application had been set to earlier. Nothing was wrong with the
   * derivation — `load-framework` is correctly scoped to one visa type — the
   * items were simply left behind.
   *
   * This is the same failure the forms surface already fixed once ("never
   * answer a chosen route with another route's forms"). The checklist had the
   * same hole.
   *
   * ONLY `base_*` ITEMS, AND ONLY UNUSED ONES.
   *
   * `base_form` and `base_requirement` are the registry-derived rows, so they
   * are the ones the new route will regenerate. `discovery*` items came from
   * the applicant's own answers and are not route-derived.
   *
   * Anything the applicant has already uploaded against is kept, whatever its
   * reason. Deleting it would cascade the document away, and losing an
   * uploaded passport to a dropdown change is far worse than showing one stale
   * row — which the applicant can see and we can explain.
   */
  private async retireStaleRouteItems(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<void> {
    try {
      const { data: items } = await db
        .from('checklist_items')
        .select('id, added_reason')
        .eq('application_id', applicationId);
      if (!items || items.length === 0) return;

      const derived = (items as Array<{ id: string; added_reason: string }>)
        .filter((i) => i.added_reason?.startsWith('base_'))
        .map((i) => i.id);
      if (derived.length === 0) return;

      const { data: linked } = await db
        .from('documents')
        .select('checklist_item_id')
        .eq('application_id', applicationId);
      const used = new Set(
        (linked ?? [])
          .map((d) => d.checklist_item_id)
          .filter((id): id is string => Boolean(id)),
      );

      const removable = derived.filter((id) => !used.has(id));
      if (removable.length === 0) return;

      const { error } = await db
        .from('checklist_items')
        .delete()
        .in('id', removable);
      if (error) {
        console.warn(
          `[intake] stale route items not removed: ${error.message}`,
        );
      }
    } catch (err) {
      // Never fail the route change over cleanup. A stale row is visible and
      // recoverable; refusing to let someone change their visa type is not.
      console.warn(
        '[intake] stale route item cleanup failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * The state a rebuild starts from when no checkpoint exists.
   *
   * Only the fields the checklist derivation reads are filled from the
   * database — the route, the country and the answers so far. The rest are the
   * empty values the graph would have started with, NOT invented content: an
   * empty `messages` means no conversation happened, which is true, and
   * `checklistBuiltAt: null` keeps the freshness check honest so the next open
   * still rebuilds if this one fails.
   */
  private async blankIntakeState(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<IntakeState> {
    const { data: app } = await db
      .from('applications')
      .select(
        'destination_country, destination_state, visa_type_id, framework_id',
      )
      .eq('id', applicationId)
      .maybeSingle();

    const { data: profile } = await db
      .from('application_profiles')
      .select('profile_json')
      .eq('application_id', applicationId)
      .maybeSingle();

    const row = (app ?? {}) as {
      destination_country?: string | null;
      destination_state?: string | null;
      visa_type_id?: string | null;
      framework_id?: string | null;
    };

    return {
      applicationId,
      frameworkId: row.framework_id ?? null,
      visaTypeId: row.visa_type_id ?? null,
      destinationCountry: row.destination_country ?? null,
      destinationState: row.destination_state ?? null,
      requirementsJson: {},
      profileJson:
        ((profile?.profile_json as Record<string, unknown> | null) ?? {}) || {},
      riskIndicators: [],
      checklistItems: [],
      suggestedVisaTypes: [],
      messages: [],
      isComplete: false,
      currentQuestion: null,
      checklistBuiltAt: null,
    };
  }

  async getChecklist(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    const app = await db
      .from('applications')
      .select('id')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();

    // SEC-103: a bare Error maps to 500. This is an authorization denial — the
    // row is invisible under the caller's RLS scope — so it must answer 403,
    // matching VriService.verifyOwnership. Identical for a foreign id and a
    // nonexistent one, so it is not an existence oracle.
    if (!app.data) throw new ForbiddenException('Access denied');

    const { data } = await db
      .from('checklist_items')
      .select('*')
      .eq('application_id', applicationId)
      .order('added_reason');

    return data ?? [];
  }

  /** Best-effort read of the user's preferred UI language (drives AI response
   *  language). Falls back to null (English) on any error or unset preference. */
  private async getUserLanguage(
    db: SupabaseClient,
    userId: string,
  ): Promise<string | null> {
    try {
      const { data } = await db
        .from('users')
        .select('preferred_language')
        .eq('id', userId)
        .single();
      return (
        (data as { preferred_language?: string | null } | null)
          ?.preferred_language ?? null
      );
    } catch {
      return null;
    }
  }

  async startOrResume(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    /**
     * Whether a newly generated opening turn belongs in the transcript.
     *
     * False when the session is being re-opened underneath a message the
     * applicant has already sent: their answer is written next and the graph
     * replies to it, so persisting the opening question here would slot a
     * question they never saw in between, immediately above their own answer
     * to a different one.
     */
    opts: { persistOpening?: boolean } = {},
  ): Promise<IntakeState> {
    const { persistOpening = true } = opts;
    const app = await this.getApplication(db, applicationId, userId);
    if (!app) throw new ForbiddenException('Access denied');

    const saved = (await this.checkpoint.load(
      applicationId,
    )) as IntakeState | null;

    // Resume: return cached state untouched. Re-invoking the graph on every
    // reload would append a fresh AIMessage (last message is AI → ask_question)
    // and corrupt the transcript.
    if (saved && saved.currentQuestion) {
      return saved;
    }

    // The check above is not enough on its own. It answers "has this been
    // started?" by loading the checkpoint, and the checkpoint is not written
    // until AFTER the graph has run — which takes an LLM call, tens of seconds.
    // Every start arriving in that window still sees "no", runs the graph, and
    // appends its own opening message.
    //
    // That window is hit routinely, not rarely: the browser emits intake:start
    // from its socket `connect` handler, and socket.io fires `connect` again on
    // every reconnect — a dropped connection, or an API restart, is enough.
    // Observed in production as two identical opening messages 77s apart.
    //
    // So: exactly one caller may generate. The others wait for that caller's
    // checkpoint and resume from it, which is what a reconnecting client wanted
    // in the first place.
    const gotLock = await this.checkpoint.acquireStartLock(
      applicationId,
      START_LOCK_TTL_SECONDS,
    );
    if (!gotLock) {
      const resumed = await this.awaitStartedElsewhere(applicationId);
      if (resumed) return resumed;
      // The holder died or is slower than we are willing to wait. Fall through
      // and generate: a duplicate opening line is a better failure than an
      // intake that never opens.
    }

    const { data: profile } = await db
      .from('application_profiles')
      .select('profile_json, risk_indicators_json')
      .eq('application_id', applicationId)
      .single();

    const { data: checklist } = await db
      .from('checklist_items')
      .select('*')
      .eq('application_id', applicationId);

    // The transcript that already exists for this application.
    //
    // A missing checkpoint does NOT mean a fresh intake. `setVisaType` deletes
    // the checkpoint on purpose — the cached requirements belong to the old
    // route — and the comment there says the applicant only pays for a
    // re-derivation because "profile_json, checklist_items and the message
    // history all live in Postgres". They did live there; nothing read them
    // back. Starting from `messages: []` re-asked the opening question, wrote a
    // SECOND identical opening line into the transcript, and threw away every
    // answer already given as far as the model was concerned.
    //
    // Reproduced in production 2026-09-03: change the visa type once, and the
    // interview restarts from the top with the opening question printed twice.
    const priorMessages = await this.loadTranscript(db, applicationId);

    const initialState: Partial<IntakeState> = saved ?? {
      applicationId,
      // Without this the registry branch of load-framework is unreachable: it
      // returns null on a missing visaTypeId, so every checklist fell through to
      // the legacy table or the model, no matter how much sourced data existed.
      visaTypeId: app.visa_type_id ?? null,
      frameworkId: app.framework_id ?? null,
      destinationCountry: app.destination_country ?? null,
      destinationState: app.destination_state ?? null,
      requirementsJson: {},
      profileJson: (profile?.profile_json as Record<string, unknown>) ?? {},
      riskIndicators: (profile?.risk_indicators_json as string[]) ?? [],
      checklistItems: checklist ?? [],
      suggestedVisaTypes: [],
      messages: priorMessages,
      isComplete: false,
      currentQuestion: null,
    };

    // F1: per-request graph built with the scoped client so nodes run under RLS.
    // i18n: the user's preferred language drives the AI response language.
    const language = await this.getUserLanguage(db, userId);
    const graph = buildIntakeGraph(db, this.openaiKey, language, this.meter, {
      applicationId,
      userId,
    });
    try {
      // INTAKE-004: an unanswered question is still the current question.
      //
      // `setVisaType` deletes the checkpoint on purpose, so re-opening the
      // interview after a route change lands here with `saved === null` and
      // regenerates the opening turn. The model does not reproduce the pending
      // question verbatim — it PARAPHRASES it — so `repeatsLastLine` below,
      // which compares exact strings, never matched and the paraphrase was
      // appended as a new line. Observed live on 2026-09-06: three consecutive
      // assistant turns all asking "What is the purpose of your visit to
      // Canada?", differing only in their examples, because the visa type had
      // been changed twice against an unanswered opener.
      //
      // Nothing about a route change invalidates a question the applicant has
      // not answered yet; it invalidates the cached REQUIREMENTS, which is why
      // the checkpoint is dropped. So restore the requirements from the
      // registry (a ~10ms read) and resume the pending question as-is: no model
      // call, no second phrasing of a question already on screen.
      const pending = priorMessages.at(-1);
      const pendingQuestion =
        !saved &&
        pending instanceof AIMessage &&
        typeof pending.content === 'string'
          ? pending.content.trim()
          : '';
      if (pendingQuestion) {
        const rehydrated: IntakeState = {
          ...(initialState as IntakeState),
          ...(await makeLoadFrameworkNode(db)(initialState as IntakeState)),
        };
        // A COMPLETED intake must not be reopened on its closing line. It is
        // `check_complete` that decides, it is a pure function of the profile,
        // the message count and the framework — no model call — so ask it
        // rather than guessing from the shape of the text.
        const { isComplete } = await checkComplete(rehydrated);
        if (!isComplete) {
          const resumedState: IntakeState = {
            ...rehydrated,
            isComplete: false,
            currentQuestion: pendingQuestion,
          };
          await this.checkpoint.save(applicationId, resumedState);
          return resumedState;
        }
      }

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: applicationId },
      });

      // Save BEFORE persisting the message, and release only after both: a
      // waiter that wakes between the two would resume a state whose opening
      // line is not yet in the transcript.
      await this.checkpoint.save(applicationId, result);
      // Belt and braces for the transcript: even with the history restored, a
      // regenerated turn can land on the same question the applicant is
      // already looking at. Writing it twice makes the interview look broken.
      const lastPrior = priorMessages.at(-1);
      const repeatsLastLine =
        lastPrior instanceof AIMessage &&
        lastPrior.content === result.currentQuestion;
      if (persistOpening && result.currentQuestion && !repeatsLastLine) {
        await this.persistMessage(
          db,
          applicationId,
          'assistant',
          result.currentQuestion,
        );
      }
      return result;
    } finally {
      await this.checkpoint.releaseStartLock(applicationId).catch(() => {
        // A lock we cannot release still expires on its TTL. Never let cleanup
        // fail the turn the applicant is waiting on.
      });
    }
  }

  /**
   * Wait for whoever holds the start lock to publish their checkpoint, so a
   * reconnecting client resumes their transcript instead of generating a rival
   * opening turn. Returns null if they do not finish in time.
   */
  private async awaitStartedElsewhere(
    applicationId: string,
  ): Promise<IntakeState | null> {
    const deadline = Date.now() + START_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, START_POLL_MS));
      const saved = (await this.checkpoint.load(
        applicationId,
      )) as IntakeState | null;
      if (saved?.currentQuestion) return saved;
    }
    return null;
  }

  async sendMessage(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    userText: string,
    /**
     * Live hooks for the assistant's reply. The socket gateway passes both so
     * the browser can paint the answer as it is written (`onToken`) and act on
     * it the moment it is finished (`onReady`), without waiting for the rest of
     * the graph. Every other caller omits them and gets the single-shot
     * generation, delivered from the returned state.
     *
     * `onToken` is NOT a delivery mechanism — a chunk is a preview the caller
     * is free to overwrite. `onReady` IS: it carries the same text that lands
     * on the returned state's `currentQuestion`.
     */
    hooks?: AskQuestionHooks,
  ): Promise<IntakeState> {
    // SEC-104: authorize BEFORE touching the checkpoint.
    //
    // The ownership check used to run second. IntakeGateway passes the
    // client-supplied applicationId straight through, so this service is the
    // only authorization point — and by the time it ran, another user's intake
    // checkpoint (their answers, i.e. their PII) had already been loaded into
    // memory. It was never returned, but "authorize, then act" is not a
    // preference: the next person to add a line between the two would have
    // shipped a leak.
    //
    // It was also observable. Probing a foreign applicationId returned "No
    // active session" when that application had no checkpoint and "Access
    // denied" when it did — an oracle telling an attacker whether someone
    // else's application has a live intake session. Both branches now answer
    // 403 before the checkpoint is read, so the responses are identical.
    const app = await this.getApplication(db, applicationId, userId);
    if (!app) throw new ForbiddenException('Access denied');

    const messageLockToken = randomUUID();
    const gotMessageLock = await this.checkpoint.acquireMessageLock(
      applicationId,
      messageLockToken,
      MESSAGE_LOCK_TTL_SECONDS,
    );
    if (!gotMessageLock) {
      throw new ConflictException(
        'A previous intake message is still being processed; retry shortly',
      );
    }

    try {
      // No checkpoint means `intake:start` never completed — the socket
      // connected, its start failed (a transient read error, an API restart
      // mid-open), and the applicant went on typing into a session that does not
      // exist. Rejecting the turn made that state PERMANENT: the client never
      // re-emits start, so every later message failed the same way and the only
      // escape was a page reload the UI never suggested. Observed in production
      // 2026-09-03 as three consecutive `No active session` failures behind one
      // `Something went wrong` banner.
      //
      // Opening the session here is what the applicant asked for by sending a
      // message. Ownership was already checked above, so this cannot open a
      // session on someone else's application, and startOrResume is idempotent
      // under its own lock — a racing `intake:start` resumes the same state
      // rather than generating a second opening message.
      let saved = (await this.checkpoint.load(
        applicationId,
      )) as IntakeState | null;
      if (!saved) {
        console.warn('[intake] no session for message; opening one', {
          applicationId,
        });
        saved = await this.startOrResume(db, applicationId, userId, {
          persistOpening: false,
        });
      }

      await this.persistMessage(db, applicationId, 'user', userText);

      // Scope gate, BEFORE the graph. An off-topic turn ("write me a Python
      // script") is answered with a fixed redirect and never reaches the model:
      // no token spend, no chance of the prompt rules being argued around, and
      // nothing off-topic written into the transcript that would then be replayed
      // as history on every later turn.
      //
      // The state is returned UNCHANGED apart from the reply — currentQuestion
      // keeps pointing at the question the applicant still has to answer, and no
      // checkpoint is written, so the interview resumes exactly where it was.
      const verdict = classifyIntakeMessage(userText, saved.currentQuestion);
      if (!verdict.inScope) {
        await this.persistMessage(
          db,
          applicationId,
          'assistant',
          verdict.reply!,
        );
        return {
          ...saved,
          messages: [
            ...saved.messages,
            new HumanMessage(userText),
            new AIMessage(verdict.reply!),
          ],
        };
      }

      const stateWithAnswer: IntakeState = {
        ...saved,
        messages: [...saved.messages, new HumanMessage(userText)],
      };

      const language = await this.getUserLanguage(db, userId);

      // The reply is written to the transcript the moment it exists, not after
      // the graph settles. update_checklist is a sibling branch and can outlast
      // ask_question, and until this was hoisted the assistant's own message was
      // unwritten for that whole window — a browser reloaded in it replayed a
      // history missing the answer the applicant had just been shown.
      let persisted = false;
      const graph = buildIntakeGraph(
        db,
        this.openaiKey,
        language,
        this.meter,
        { applicationId, userId },
        {
          onToken: hooks?.onToken,
          onReady: async (question, isComplete) => {
            await this.persistMessage(db, applicationId, 'assistant', question);
            persisted = true;
            await hooks?.onReady?.(question, isComplete);
          },
        },
      );
      const result = await graph.invoke(stateWithAnswer, {
        configurable: { thread_id: applicationId },
      });

      await this.checkpoint.save(applicationId, result);
      // Fallback for the turn that produced a question without going through the
      // node's hook — a completed intake ends at check_complete, and any future
      // path that sets currentQuestion elsewhere must still be recorded.
      if (result.currentQuestion && !persisted) {
        await this.persistMessage(
          db,
          applicationId,
          'assistant',
          result.currentQuestion,
        );
      }
      return result;
    } finally {
      await this.checkpoint
        .releaseMessageLock(applicationId, messageLockToken)
        .catch(() => {
          // The TTL protects the next request if Redis cleanup is unavailable.
        });
    }
  }

  async getMessages(db: SupabaseClient, applicationId: string, userId: string) {
    const app = await this.getApplication(db, applicationId, userId);
    if (!app) throw new ForbiddenException('Access denied');

    const { data, error } = await db
      .from('intake_messages')
      .select('id, role, content, created_at')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  /**
   * The stored transcript as graph messages.
   *
   * Read directly rather than through `getMessages`, which re-checks ownership
   * the callers here have already established.
   */
  private async loadTranscript(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<Array<HumanMessage | AIMessage>> {
    const { data, error } = await db
      .from('intake_messages')
      .select('role, content')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });

    if (error) {
      // A transcript we cannot read is not a reason to refuse to open the
      // interview; it degrades to the old behaviour of starting empty.
      console.error('[intake] failed to load transcript:', error.message);
      return [];
    }

    return (data ?? []).map((m) => {
      const row = m;
      return row.role === 'user'
        ? new HumanMessage(row.content)
        : new AIMessage(row.content);
    });
  }

  private async persistMessage(
    db: SupabaseClient,
    applicationId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<void> {
    const { error } = await db
      .from('intake_messages')
      .insert({ application_id: applicationId, role, content });
    if (error)
      console.error('[intake] failed to persist message:', error.message);
  }
}
