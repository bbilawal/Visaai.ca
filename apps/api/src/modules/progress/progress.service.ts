import { Injectable, Optional } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeProgress,
  isIntakeAnswered,
  requiredGenTypesForRoute,
  STAGE_ORDER,
  type AppProgress,
  type ProgressInput,
  type StageSlug,
} from '@visaai/types';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';
import {
  openRequestSlots,
  withOpenRequestSlots,
} from '../review-items/open-document-requests';
import { safeLog } from '../shared/log/redact';

// Narrative is "complete" when the ROUTE's letters are approved — LOE + cover
// letter by default (itinerary optional), none for Canada's eTA. See
// @visaai/types route-letters; the web copy in apps/web/lib/progress.ts reads
// the same function.

// Bound on the process-local dedup structures below. forApplication is driven
// by both request traffic AND the RemindersService.runScan background sweep, so
// the key sets would otherwise grow unboundedly over the process lifetime.
// Oldest-first eviction may cause a rare duplicate re-emit for a long-idle
// application that later becomes active again — acceptable for a best-effort
// signal. Proper fix (persist last_progress_stage as a DB column) is deferred
// to SP-B; see task-12 report.
const MAX_TRACKED_APPLICATIONS = 50_000;

@Injectable()
export class ProgressService {
  // Progress is fully derived at read-time from checklist/generated_documents/
  // vri_scores/submission_sessions — there is no server-side "advance stage" or
  // "complete application" mutation to hook (confirmed: forApplication is only
  // called from the read-only GET /progress/:id controller and the reminders
  // scan job). These maps opportunistically detect real transitions in the
  // already-computed AppProgress by diffing against the last value observed by
  // THIS process. Best-effort / process-local: a restart, an eviction, or a
  // second instance (cluster/pm2) can miss or duplicate a transition —
  // stage_advanced/completed can fire once per worker. Acceptable for wave-1
  // foundational signal — see task-12 report for the tradeoff and a follow-up.
  private readonly lastObservedStage = new Map<string, StageSlug>();
  private readonly completedApplications = new Set<string>();

  constructor(@Optional() private readonly analytics?: AnalyticsEventBus) {}

  // F1: receives the per-request RLS-scoped client; no service-role dependency.
  async forApplication(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ): Promise<AppProgress | null> {
    // `visa_type_id` is the intake's terminal output — see the intakeDone note
    // below. Without it the Intake stage reported complete on arrival.
    const { data: app } = await db
      .from('applications')
      // destination + registry visa type pick the route's required intake
      // answers (see intakeDone below).
      .select(
        'id, status, visa_type_id, destination_country, visa_types(visaai_id)',
      )
      .eq('id', applicationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!app) return null;

    const [profile, checklist, gens, vri, prefill, session, activity] =
      await Promise.all([
        db
          .from('application_profiles')
          .select('application_id, profile_json')
          .eq('application_id', applicationId)
          .maybeSingle(),
        db
          // `meta` is required, not decoration: documentsCompletion excludes
          // items of kind 'form', and selecting only status/required hid that
          // from it — so an application carrying any required government form
          // (IMM 5257, SCHENGEN-C, I-130 …) reported the Documents stage
          // incomplete forever and Submit stayed locked.
          .from('checklist_items')
          .select('id, status, required, meta')
          .eq('application_id', applicationId),
        db
          .from('generated_documents')
          .select('doc_type, approved_by_user')
          .eq('application_id', applicationId),
        db
          .from('vri_scores')
          .select('id')
          .eq('application_id', applicationId)
          .maybeSingle(),
        db
          .from('generated_documents')
          .select('id')
          .eq('application_id', applicationId)
          .eq('doc_type', 'prefilled_form_json')
          .maybeSingle(),
        db
          .from('submission_sessions')
          .select('status')
          .eq('application_id', applicationId)
          .order('started_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        db
          .from('application_activity')
          .select('last_active_at')
          .eq('application_id', applicationId)
          .maybeSingle(),
      ]);

    // A slot whose document the consultant sent back is not done, whatever
    // its stored status says — the same rule as the vault. Unreadable: count
    // the stored statuses (progress is a display, not a gate).
    let requestSlots = new Set<string>();
    try {
      requestSlots = await openRequestSlots(db, applicationId);
    } catch (err) {
      safeLog.warn(
        'progress.reviews',
        `open document requests unreadable for ${applicationId}: ${(err as Error).message}`,
      );
    }
    const required = withOpenRequestSlots(
      (checklist.data ?? []) as Array<{
        id?: string | null;
        status: ProgressInput['requiredChecklist'][number]['status'];
        required: boolean;
        meta?: { kind?: string | null } | null;
      }>,
      requestSlots,
    ).filter(
      (c: { status: string; required: boolean }) => c.required,
    );
    const approvedGenTypes = (gens.data ?? [])
      .filter(
        (g: { doc_type: string; approved_by_user: boolean }) =>
          g.approved_by_user,
      )
      .map((g: { doc_type: string; approved_by_user: boolean }) => g.doc_type);

    const input: ProgressInput = {
      applicationId,
      status: app.status,
      hasProfile: !!profile.data,
      // PROG-001: this was `!!profile.data` — the same expression as hasProfile.
      // `isComplete.intake` is `hasProfile && intakeDone`, so it collapsed to
      // "an application_profiles row exists", and that row is written as soon as
      // the interview starts. Every application therefore reported Intake
      // COMPLETE on arrival: the stage nav showed a ✓ over an unanswered
      // interview, `currentStage` skipped to documents so the next-action banner
      // read "Upload your required documents", and the documents surface then
      // contradicted both by saying "Complete the AI intake first" (it gates on
      // the checklist, which does not exist until a visa type is chosen). Every
      // draft also sat at exactly 17% — 100/6 stages — for the same reason.
      // The intake's terminal output is the chosen visa type: it is what
      // IntakeService.rebuildChecklist keys off, so it is what "done" means.
      //
      // #2 (dry run 2026-10-14): a chosen visa type is not enough either.
      // Picking the route from the dropdown sets it on turn two, so an
      // applicant who had answered two questions saw Intake ✓. Done now also
      // means the route's required answers are on the profile — the same list
      // the interview itself completes on (@visaai/types intake-requirements).
      intakeDone:
        !!profile.data &&
        !!app.visa_type_id &&
        isIntakeAnswered(profileJsonOf(profile.data), routeOf(app)),
      requiredChecklist: required.map(
        (c: {
          status: ProgressInput['requiredChecklist'][number]['status'];
          meta?: { kind?: string | null } | null;
        }) => ({ status: c.status, meta: c.meta ?? null }),
      ),
      requiredGenTypes: requiredGenTypesForRoute(routeOf(app)),
      approvedGenTypes,
      hasVriScore: !!vri.data,
      hasPrefill: !!prefill.data,
      submissionStatus: session.data?.status ?? null,
      lastActiveAt: activity.data?.last_active_at ?? new Date().toISOString(), // no activity row yet (brand-new app) → treat as active now
      now: new Date().toISOString(),
    };

    const result = computeProgress(input);
    this.emitStageTransitions(userId, result);
    return result;
  }

  /** Diffs the freshly-computed progress against the last value this process
   * observed for the application and emits analytics for genuine FORWARD
   * transitions only. Never on the first observation (that's a baseline, not an
   * "advance"), and never on a backward move — stage is read-derived and can
   * regress (e.g. deleting a document reverts a checklist item to 'missing',
   * moving currentStage back a stage), and emitting "stage_advanced" for a
   * regression would corrupt funnel semantics. See the class-level comment for
   * the process-local caveat. */
  private emitStageTransitions(userId: string, result: AppProgress): void {
    if (!this.analytics) return;

    const prevStage = this.lastObservedStage.get(result.applicationId);
    if (prevStage !== result.currentStage) {
      this.lastObservedStage.set(result.applicationId, result.currentStage);
      this.evictOldest(this.lastObservedStage);
      // Emit only for strictly forward moves (new index > old). A backward
      // regression records the new baseline silently — no event in SP-A.
      if (
        prevStage &&
        STAGE_ORDER.indexOf(result.currentStage) >
          STAGE_ORDER.indexOf(prevStage)
      ) {
        this.analytics.emitSafe(
          makeServerEvent('application.stage_advanced', {
            user_id: userId,
            application_id: result.applicationId,
            props: { from_stage: prevStage, to_stage: result.currentStage },
          }),
        );
      }
    }

    if (
      result.overallPct === 100 &&
      !this.completedApplications.has(result.applicationId)
    ) {
      this.completedApplications.add(result.applicationId);
      this.evictOldest(this.completedApplications);
      this.analytics.emitSafe(
        makeServerEvent('application.completed', {
          user_id: userId,
          application_id: result.applicationId,
          props: {},
        }),
      );
    }
  }

  /** Bound a process-local dedup structure to MAX_TRACKED_APPLICATIONS,
   * evicting oldest-inserted keys first (Map/Set preserve insertion order). */
  private evictOldest(store: Map<string, unknown> | Set<string>): void {
    while (store.size > MAX_TRACKED_APPLICATIONS) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
}

function profileJsonOf(row: unknown): Record<string, unknown> {
  const pj = (row as { profile_json?: unknown } | null)?.profile_json;
  return pj && typeof pj === 'object' && !Array.isArray(pj)
    ? (pj as Record<string, unknown>)
    : {};
}

function routeOf(app: unknown): {
  country: string | null;
  visaaiId: string | null;
} {
  const a = app as {
    destination_country?: string | null;
    visa_types?:
      | { visaai_id?: string | null }
      | { visaai_id?: string | null }[]
      | null;
  };
  const vt = Array.isArray(a.visa_types) ? a.visa_types[0] : a.visa_types;
  return {
    country: a.destination_country ?? null,
    visaaiId: vt?.visaai_id ?? null,
  };
}
