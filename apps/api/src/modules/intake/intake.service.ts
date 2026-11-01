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
import { routeEligibility, rulesRouteOut } from './graphs/nodes/required-facts';
import type { RouteEligibility } from '../../strategies/visa-program/base-visa-program.strategy';
import { chatModelForTask } from '../shared/ai/model-factory';
import type { AskQuestionHooks } from './graphs/nodes/ask-question';
import { classifyIntakeMessage } from './scope-guard';
import { SAFE_FALLBACK } from '../shared/guardrails/guardrails.service';
import type { IntakeState } from './graphs/intake.state';
import type { Env } from '../../config/configuration';
import type { Database } from '@visaai/types';
import { isIntakeAnswered } from '@visaai/types';
import { linkOrphanDocuments } from '../documents/slot-link';

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

/** Thrown when the lock says an earlier turn on this application is still running. */
export const MESSAGE_IN_PROGRESS =
  'A previous intake message is still being processed; retry shortly';

/**
 * The applicant's message is already stored under this client id: a resend of
 * a message whose receipt was lost. Nothing is written or generated a second
 * time; the caller re-acknowledges it instead.
 */
export class DuplicateIntakeMessageError extends Error {
  constructor(readonly clientMsgId: string) {
    super('Intake message already received');
    this.name = 'DuplicateIntakeMessageError';
  }
}

/**
 * The stored transcript minus guardrail-refused exchanges.
 *
 * A refused turn (legal advice, an approval prediction, help to
 * misrepresent) is stored so the applicant still sees it, but it must never
 * reach the model again: replaying "will I be approved?" and the refusal on
 * every later turn invites the model to argue with its own guardrail. The
 * refusal is the fixed SAFE_FALLBACK text — the only assistant row ever
 * stored with exactly that content (a reply suppressed by the OUTPUT filter
 * is stored as the model wrote it) — so it marks the pair without a schema
 * change: drop it and the applicant message immediately before it.
 */
export function withoutRefusedTurns<
  T extends { role: string; content: string },
>(rows: T[]): T[] {
  const out: T[] = [];
  for (const row of rows) {
    if (row.role === 'assistant' && row.content === SAFE_FALLBACK) {
      if (out.at(-1)?.role === 'user') out.pop();
      continue;
    }
    out.push(row);
  }
  return out;
}

export interface SendMessageOptions {
  /**
   * The browser's id for this message (a UUID). Stored as the row id, so the
   * history hands it back and a resend can be recognised.
   */
  clientMsgId?: string;
  /**
   * Called once the applicant's message is STORED — never before. The gateway
   * acknowledges the message here; acknowledging any earlier told the browser
   * a message was safe when the turn could still fail before writing it (the
   * message lock, the access check, the session open).
   */
  onAccepted?: () => void;
}

/**
 * The profile a turn starts from: the row, with any fact only the checkpoint
 * holds kept.
 *
 * The checkpoint is a snapshot from when the session opened. Documents
 * processed since then write into the row — marriage_date from the nikah
 * nama, children from birth certificates — and update_profile writes every
 * answer there too, so the row is the newer of the two. Starting a turn from
 * the checkpoint alone showed the extractor a profile without the
 * document-filled fact the applicant was correcting (dry run 2026-10-15).
 */
export function withRowProfile(
  checkpoint: Record<string, unknown>,
  row: Record<string, unknown> | null,
): Record<string, unknown> {
  return { ...(checkpoint ?? {}), ...(row ?? {}) };
}

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

    // Whether THIS applicant may use each route, re-read on every call. The
    // selector re-fetches after each interview answer, so a route the profile
    // has since ruled out (a Pakistani passport on Canada's eTA) is flagged
    // where it is changed — without deleting the applicant's choice.
    const profile = await this.readProfileJson(db, applicationId);

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
      const verdict = routeEligibility(
        app.destination_country as string | null,
        row.visaai_id,
        profile,
      );
      return {
        id: row.id,
        visaaiId: row.visaai_id,
        name: row.official_name,
        officialCode: row.official_code,
        category: row.category,
        dataQuality: row.data_quality,
        /** Sourced requirements behind this route. 0 means discovery mode. */
        requirementCount: tally.get(row.id) ?? 0,
        ...(verdict ? { eligibility: publicVerdict(verdict) } : {}),
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

    // Read once, used for the route's eligibility gate and for telling the
    // page whether the interview still has questions for the new route.
    const profile = await this.readProfileJson(db, applicationId);
    let visaaiId: string | null = null;
    let verdict: RouteEligibility | null = null;

    if (visaTypeId !== null) {
      const { data: visaType } = await db
        .from('visa_types')
        .select('id, visaai_id, lifecycle_state, visa_countries!inner(code)')
        .eq('id', visaTypeId)
        .maybeSingle();

      if (!visaType) throw new BadRequestException('Unknown visa type');

      const row = visaType as unknown as {
        visaai_id?: string | null;
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

      // THE ROUTE MUST FIT THE APPLICANT.
      //
      // Dry run 2026-10-16 (app a37a534b): the interview had told a Pakistani
      // applicant they need a visitor visa, and this endpoint still accepted
      // Canada's eTA — the checklist then "Verified" a Pakistani passport as a
      // visa-exempt one. A program that knows who may use it (see
      // VisaProgramStrategy.assessEligibility) is asked here. Only a definite
      // answer refuses: 'unknown' is accepted, because nationality is often
      // not known yet and the interview asks it.
      visaaiId = row.visaai_id ?? null;
      verdict = routeEligibility(
        app.destination_country as string | null,
        visaaiId,
        profile,
      );
      if (rulesRouteOut(verdict)) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'ROUTE_INELIGIBLE',
          message: verdict.recommendedLabel
            ? `${verdict.reason} Choose “${verdict.recommendedLabel}” instead.`
            : verdict.reason,
          eligibility: verdict.status,
          ...(verdict.recommendedVisaaiId
            ? { recommendedVisaaiId: verdict.recommendedVisaaiId }
            : {}),
        });
      }
    }

    // Whether the new route's required answers are all on the profile. The
    // page uses it to stay in the interview instead of jumping to Documents
    // while the route's own questions are still unasked (dry run 2026-10-16).
    const intakeComplete = isIntakeAnswered(profile, {
      country: (app.destination_country as string | null) ?? null,
      visaaiId,
    });

    // An accepted route the program could not yet judge ('unknown' — e.g.
    // the eTA before nationality is known) is accepted WITH its reason, so the
    // page can say eligibility depends on the passport (prod 2026-10-16, app
    // 5d3a17a4: accepted silently, ruled out only later). Absent for routes
    // no program judges.
    const eligibility = verdict ? { eligibility: publicVerdict(verdict) } : {};

    const previous = (app.visa_type_id as string | null) ?? null;
    if (previous === visaTypeId)
      return { visaTypeId, changed: false, intakeComplete, ...eligibility };

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

    return { visaTypeId, changed: true, intakeComplete, ...eligibility };
  }

  /** The stored intake profile, or {} — never throws (a missing row is normal). */
  private async readProfileJson(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const { data } = await db
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', applicationId)
        .maybeSingle();
      const pj = (data as { profile_json?: unknown } | null)?.profile_json;
      return pj && typeof pj === 'object' && !Array.isArray(pj)
        ? (pj as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
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

  /**
   * When the route's registry requirements last changed — any status, so a
   * retirement counts too — or null when unknown (no route, or the read
   * failed; then only the profile decides). The service client: the public
   * read policy shows active rows only, which would hide a retirement.
   */
  private async registryChangedAt(
    db: SupabaseClient,
    visaTypeId: string | null,
  ): Promise<string | null> {
    if (!visaTypeId) return null;
    try {
      const client = this.supabase?.admin ?? db;
      const { data, error } = await client
        .from('visa_requirements')
        .select('updated_at')
        .eq('visa_type_id', visaTypeId)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) {
        console.warn(
          `[intake] registry freshness unreadable for ${visaTypeId}: ${error.message}`,
        );
        return null;
      }
      const at = (data as Array<{ updated_at?: string | null }> | null)?.[0]
        ?.updated_at;
      return at ?? null;
    } catch {
      return null;
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
    // The registry can change the answer too: rows added for the route after
    // the last build (prod 2026-10-20: spousal sponsorship's 15 new documents
    // and forms never reached an application whose profile had not moved).
    const registryAt = await this.registryChangedAt(
      db,
      (app.visa_type_id as string | null) ?? base.visaTypeId ?? null,
    );
    const isFresh =
      existing.length > 0 &&
      builtAt !== null &&
      // As instants: PostgREST writes '+00:00' and microseconds, the
      // checkpoint 'Z' and milliseconds, so the strings do not order.
      (!profileAt || Date.parse(profileAt) <= Date.parse(builtAt)) &&
      (!registryAt || Date.parse(registryAt) <= Date.parse(builtAt));
    if (isFresh) {
      console.log('[intake:timing] rebuild_checklist skipped (fresh)');
      // The list is current, but the files in it may not be settled: a valid
      // file sitting unlinked beside a slot that holds only an expired one,
      // or a slot 'verified' on an expired file (prod app 61f16bb5,
      // 2026-10-16). Data-only — no model call — and never throws, so it runs
      // on every visit to the documents page.
      await linkOrphanDocuments(db, applicationId);
      return this.getChecklist(db, applicationId, userId);
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
    // registry and discovery. Load it the same way the graph's first node does,
    // on EVERY rebuild: a saved checkpoint carries the requirements that were
    // current when the interview ran, so rebuilding from it re-derived the
    // checklist from a registry that had since been corrected (prod 2026-10-16:
    // super visa v2 added passport + insurance, app 61f16bb5 kept the v1 slots).
    // Stamped before the registry is read: a change landing during the
    // 9–21s generation is then newer than this build, not mistaken for it.
    const buildStartedAt = new Date().toISOString();
    const state: IntakeState = {
      ...withRoute,
      ...(await makeLoadFrameworkNode(db)(withRoute)),
    };

    const startedAt = Date.now();
    try {
      const result = await node(state);
      await this.checkpoint.save(applicationId, {
        ...state,
        ...result,
        checklistBuiltAt: buildStartedAt,
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
      profileChanges: [],
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

    // A FINISHED session is only finished while its answers still are — see
    // reopenIfIncomplete. Prod 2026-10-29, app 945eb7f1.
    if (saved?.currentQuestion && saved.isComplete) {
      return this.reopenIfIncomplete(db, applicationId, userId, saved);
    }

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
   * Resume a session whose checkpoint says "complete" — unless it no longer is.
   *
   * `isComplete` is cached when the interview ends. A required fact added
   * since (spouse_name, PR #295) reopened the Intake stage in the nav while
   * the page resumed this checkpoint as "Intake complete" and never asked.
   * Prod 2026-10-29, app 945eb7f1.
   *
   * The decision is the nav's, input for input (progress.service intakeDone):
   * the profile ROW and the application's destination + registry visa type —
   * not the checkpoint's copy of either, so a checkpoint-only fact or a
   * missing `visaai_id` cannot hide a missing answer. When it is incomplete,
   * the graph asks the next missing question from the row's profile.
   *
   * It runs under the MESSAGE lock, re-reading the checkpoint once held: an
   * applicant's turn and a reopen both write the checkpoint and the
   * transcript, and must not interleave (two questions; the last save
   * silently dropping the other's message). A caller that cannot take the
   * lock — a second tab, or a turn already running — waits for that writer's
   * checkpoint instead of returning the stale "complete" one.
   */
  private async reopenIfIncomplete(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    saved: IntakeState,
  ): Promise<IntakeState> {
    const nav = await this.navIntakeView(db, applicationId);
    if (!nav || nav.answered) return saved;

    const token = randomUUID();
    if (
      !(await this.checkpoint.acquireMessageLock(
        applicationId,
        token,
        MESSAGE_LOCK_TTL_SECONDS,
      ))
    ) {
      return (await this.awaitCheckpointChange(applicationId, saved)) ?? saved;
    }
    try {
      const current =
        ((await this.checkpoint.load(applicationId)) as IntakeState | null) ??
        saved;
      // Someone else's turn landed between our read and the lock: theirs
      // already re-decided completeness.
      if (
        !current.isComplete ||
        current.currentQuestion !== saved.currentQuestion
      ) {
        return current;
      }
      const language = await this.getUserLanguage(db, userId);
      const graph = buildIntakeGraph(db, this.openaiKey, language, this.meter, {
        applicationId,
        userId,
      });
      // Last message is the closing AI line → load_framework → ask_question.
      const result = await graph.invoke(
        { ...current, profileJson: nav.profileJson, isComplete: false },
        { configurable: { thread_id: applicationId } },
      );
      await this.checkpoint.save(applicationId, result);
      if (
        result.currentQuestion &&
        result.currentQuestion !== current.currentQuestion
      ) {
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
        .releaseMessageLock(applicationId, token)
        .catch(() => {
          // The TTL frees it.
        });
    }
  }

  /**
   * Intake completeness exactly as the stage nav computes it, or null when it
   * cannot be read (then nothing is reopened). No registry visa type means
   * discovery mode, which is not reopened either.
   */
  private async navIntakeView(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<{
    answered: boolean;
    profileJson: Record<string, unknown>;
  } | null> {
    try {
      const [app, profile] = await Promise.all([
        db
          .from('applications')
          .select('visa_type_id, destination_country, visa_types(visaai_id)')
          .eq('id', applicationId)
          .maybeSingle(),
        db
          .from('application_profiles')
          .select('profile_json')
          .eq('application_id', applicationId)
          .maybeSingle(),
      ]);
      if (app.error || profile.error || !app.data) return null;
      const a = app.data as {
        visa_type_id?: string | null;
        destination_country?: string | null;
        visa_types?:
          | { visaai_id?: string | null }
          | { visaai_id?: string | null }[]
          | null;
      };
      if (!a.visa_type_id) return null;
      const vt = Array.isArray(a.visa_types) ? a.visa_types[0] : a.visa_types;
      const raw = (profile.data as { profile_json?: unknown } | null)
        ?.profile_json;
      const profileJson =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      return {
        answered:
          !!profile.data &&
          isIntakeAnswered(profileJson, {
            country: a.destination_country ?? null,
            visaaiId: vt?.visaai_id ?? null,
          }),
        profileJson,
      };
    } catch (err) {
      console.error('[intake] could not read intake completeness:', err);
      return null;
    }
  }

  /** Wait for whoever holds the message lock to write a different checkpoint. */
  private async awaitCheckpointChange(
    applicationId: string,
    seen: IntakeState,
  ): Promise<IntakeState | null> {
    const deadline = Date.now() + START_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, START_POLL_MS));
      const now = (await this.checkpoint.load(
        applicationId,
      )) as IntakeState | null;
      if (
        now?.currentQuestion &&
        (!now.isComplete || now.currentQuestion !== seen.currentQuestion)
      ) {
        return now;
      }
    }
    return null;
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
    opts: SendMessageOptions = {},
  ): Promise<IntakeState> {
    const { clientMsgId, onAccepted } = opts;
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

    // A resend of a message already stored. Two very different cases:
    //  - it was ANSWERED (its receipt or reply was lost in a reconnect):
    //    acknowledge and re-sync; running the turn again would answer twice.
    //  - it was stored but its turn FAILED afterwards (model timeout, 429):
    //    the applicant pressed Retry precisely to get it answered. Run the
    //    turn — once, under the lock — without storing the message again.
    //    Re-acknowledging it instead cleared their "failed" mark and never
    //    ran the turn: a silently dropped correction.
    // A turn still running for it holds the lock, and gets MESSAGE_IN_PROGRESS
    // below rather than a re-ack.
    const stored = await this.findStored(db, applicationId, clientMsgId);
    if (stored?.answered) {
      throw new DuplicateIntakeMessageError(stored.id);
    }
    if (stored) userText = stored.content;

    const messageLockToken = randomUUID();
    const gotMessageLock = await this.checkpoint.acquireMessageLock(
      applicationId,
      messageLockToken,
      MESSAGE_LOCK_TTL_SECONDS,
    );
    if (!gotMessageLock) {
      throw new ConflictException(MESSAGE_IN_PROGRESS);
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

      if (!stored) {
        await this.persistUserMessage(db, applicationId, userText, clientMsgId);
      }
      // Stored: from here on the message survives anything that fails.
      onAccepted?.();

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
        profileJson: await this.turnProfile(
          db,
          applicationId,
          saved.profileJson ?? {},
        ),
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
            // A failed reply write is logged, not fatal: the applicant still
            // sees the answer. Accepted trade-off: findStored then reads the
            // message as unanswered, so a resend whose receipt was lost can
            // run the turn a second time (rare: needs both failures).
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
      // Fallback for the turn that produced a reply without going through a
      // node's hook (ask_question and confirm_update both use it) — any future
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

  /**
   * The profile this turn starts from (see `withRowProfile`). A failed read
   * degrades to the checkpoint — the old behaviour — rather than failing the
   * applicant's turn; update_profile re-reads the row before it writes.
   */
  private async turnProfile(
    db: SupabaseClient,
    applicationId: string,
    checkpoint: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const { data, error } = await db
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', applicationId)
        .maybeSingle();
      if (error) {
        console.error('[intake] failed to read profile row:', error.message);
        return checkpoint;
      }
      const raw = (data as { profile_json?: unknown } | null)?.profile_json;
      const row =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null;
      return withRowProfile(checkpoint, row);
    } catch (err) {
      console.error('[intake] failed to read profile row:', err);
      return checkpoint;
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

    return withoutRefusedTurns(data ?? []).map((row) =>
      row.role === 'user'
        ? new HumanMessage(row.content)
        : new AIMessage(row.content),
    );
  }

  /**
   * A message refused by the pre-LLM guardrail (legal advice, an approval
   * prediction, help to misrepresent). The graph never runs, but the turn is
   * still part of the conversation: the applicant's message and the refusal
   * are both stored, so a reload or a reconnect shows what was said and the
   * browser can confirm the message like any other. The pair is never fed
   * back to the model (see `withoutRefusedTurns`).
   */
  async recordRefusedMessage(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    userText: string,
    refusal: string,
    opts: SendMessageOptions = {},
  ): Promise<void> {
    const app = await this.getApplication(db, applicationId, userId);
    if (!app) throw new ForbiddenException('Access denied');
    const stored = await this.findStored(db, applicationId, opts.clientMsgId);
    if (stored?.answered) throw new DuplicateIntakeMessageError(stored.id);
    if (!stored) {
      await this.persistUserMessage(
        db,
        applicationId,
        userText,
        opts.clientMsgId,
      );
    }
    opts.onAccepted?.();
    await this.persistMessage(db, applicationId, 'assistant', refusal);
  }

  /**
   * The applicant message already stored under this client id on this
   * application, and whether anything has answered it since. Null when there
   * is none — or when it cannot be read: a failed read is not proof of a
   * duplicate, and the insert (the id is the primary key) is the backstop.
   */
  private async findStored(
    db: SupabaseClient,
    applicationId: string,
    clientMsgId: string | undefined,
  ): Promise<{ id: string; content: string; answered: boolean } | null> {
    if (!clientMsgId) return null;
    const { data, error } = await db
      .from('intake_messages')
      .select('id, content, created_at')
      .eq('id', clientMsgId)
      .eq('application_id', applicationId)
      .eq('role', 'user')
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { id: string; content: string; created_at: string };
    // Answered means a reply between THIS message and the applicant's next
    // one. A later message's reply is not this one's: "A failed, B typed and
    // answered, Retry A" must run A's turn, not re-sync it into silence.
    const { data: next } = await db
      .from('intake_messages')
      .select('created_at')
      .eq('application_id', applicationId)
      .eq('role', 'user')
      .gt('created_at', row.created_at)
      .order('created_at', { ascending: true })
      .limit(1);
    const nextAt = Array.isArray(next) && next.length
      ? (next[0] as { created_at: string }).created_at
      : undefined;
    let replyQuery = db
      .from('intake_messages')
      .select('id')
      .eq('application_id', applicationId)
      .eq('role', 'assistant')
      .gt('created_at', row.created_at);
    if (nextAt) replyQuery = replyQuery.lt('created_at', nextAt);
    const { data: replies } = await replyQuery.limit(1);
    return {
      id: row.id,
      content: row.content,
      answered: Array.isArray(replies) && replies.length > 0,
    };
  }

  /**
   * Store the applicant's message, under the client's id when there is one.
   *
   * With an id the write must succeed: the browser is told the message is
   * safe only after this, so a failed write fails the turn (and the message
   * stays on the applicant's screen to retry) instead of being logged and
   * forgotten. Without one — an older client — the old best-effort write.
   */
  private async persistUserMessage(
    db: SupabaseClient,
    applicationId: string,
    content: string,
    clientMsgId: string | undefined,
  ): Promise<void> {
    if (!clientMsgId) {
      await this.persistMessage(db, applicationId, 'user', content);
      return;
    }
    const { error } = await db.from('intake_messages').insert({
      id: clientMsgId,
      application_id: applicationId,
      role: 'user',
      content,
    });
    if (!error) return;
    if (error.code === '23505') {
      // The same id raced in: ours if it is on this application.
      const raced = await this.findStored(db, applicationId, clientMsgId);
      if (raced) throw new DuplicateIntakeMessageError(raced.id);
    }
    throw new Error(`Could not save the message: ${error.message}`);
  }

  /**
   * The transcript as the browser sees it, plus the interview state it is
   * shown with — no graph run. Used to re-sync a socket outside intake:start.
   */
  async snapshot(db: SupabaseClient, applicationId: string, userId: string) {
    const messages = await this.getMessages(db, applicationId, userId);
    const saved = (await this.checkpoint
      .load(applicationId)
      .catch(() => null)) as IntakeState | null;
    return {
      messages,
      checklistItems: saved?.checklistItems,
      isComplete: saved?.isComplete,
    };
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

/** A route verdict as the page receives it — the applicant-safe fields only. */
function publicVerdict(v: RouteEligibility): RouteEligibility {
  return {
    status: v.status,
    reason: v.reason,
    ...(v.recommendedVisaaiId
      ? { recommendedVisaaiId: v.recommendedVisaaiId }
      : {}),
    ...(v.recommendedLabel ? { recommendedLabel: v.recommendedLabel } : {}),
  };
}
