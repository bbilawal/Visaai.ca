import { ProgressService } from './progress.service';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

/**
 * Chainable, awaitable Supabase query-builder stub. Every intermediate method
 * (select/eq/order/limit) returns the same builder so any call chain used by
 * ProgressService.forApplication resolves; the terminal value (used whether or
 * not `.maybeSingle()`/`.single()` is actually called in the real chain) is
 * always `{ data, error }`.
 */
function makeQuery(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => result,
    single: () => result,
    then: (
      onfulfilled?: ((value: { data: unknown; error: null }) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) => result.then(onfulfilled, onrejected),
  };
  return builder;
}

interface DbFixture {
  app: { id: string; status: string; visa_type_id: string | null } | null;
  profile: unknown;
  checklist: unknown[];
  gens: unknown[];
  vri: unknown;
  prefill: unknown;
  session: unknown;
  activity: unknown;
}

/** `generated_documents` is queried twice per forApplication call (approved
 * gen-doc types, then the prefill marker doc) — track call order to serve the
 * right fixture to each, matching the destructuring order in progress.service.ts. */
function makeDb(fixture: DbFixture) {
  let generatedDocumentsCalls = 0;
  return {
    from(table: string) {
      switch (table) {
        case 'applications':
          return makeQuery(fixture.app);
        case 'application_profiles':
          return makeQuery(fixture.profile);
        case 'checklist_items':
          return makeQuery(fixture.checklist);
        case 'generated_documents':
          generatedDocumentsCalls += 1;
          return makeQuery(
            generatedDocumentsCalls === 1 ? fixture.gens : fixture.prefill,
          );
        case 'vri_scores':
          return makeQuery(fixture.vri);
        case 'submission_sessions':
          return makeQuery(fixture.session);
        case 'application_activity':
          return makeQuery(fixture.activity);
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
  } as any;
}

const BASE: DbFixture = {
  // No visa type chosen yet: the intake interview has not reached its terminal
  // output, so the Intake stage is NOT complete however many profile rows exist.
  app: { id: 'app-1', status: 'draft', visa_type_id: null },
  profile: null,
  checklist: [],
  gens: [],
  vri: null,
  prefill: null,
  session: null,
  activity: null,
};

/** PROG-001: "intake done" is a profile row AND a chosen visa type. The profile
 *  row alone is written the moment the interview starts, so a fixture carrying
 *  only that models an interview IN PROGRESS, not a finished one. */
/** The base required answers (#2: completion requires the answers, not just a route). */
const ANSWERED = {
  purpose_of_visit: 'tourism',
  employed: true,
  duration_of_stay_days: 14,
};

const INTAKE_DONE: DbFixture = {
  ...BASE,
  app: { id: 'app-1', status: 'draft', visa_type_id: 'vt-1' },
  profile: { application_id: 'app-1', profile_json: ANSWERED },
};

const FULLY_COMPLETE: DbFixture = {
  ...BASE,
  app: { id: 'app-1', status: 'draft', visa_type_id: 'vt-1' },
  profile: { application_id: 'app-1', profile_json: ANSWERED },
  checklist: [
    { status: 'verified', required: true },
    { status: 'verified', required: true },
  ],
  gens: [
    { doc_type: 'loe', approved_by_user: true },
    { doc_type: 'cover_letter', approved_by_user: true },
  ],
  vri: { id: 'vri-1' },
  prefill: { id: 'gen-1' },
  session: { status: 'complete' },
};

/** An interview that has STARTED (profile row written) but not finished (no
 *  visa type chosen). This is the state every fresh draft sits in. */
const INTAKE_IN_PROGRESS: DbFixture = {
  ...BASE,
  profile: { application_id: 'app-1' },
};

describe('ProgressService — intake completion (PROG-001)', () => {
  it('does NOT report intake complete after two answers when the route came from the dropdown (#2)', async () => {
    const progress = await service().forApplication(
      makeDb({
        ...BASE,
        app: { id: 'app-1', status: 'draft', visa_type_id: 'vt-1' },
        profile: {
          application_id: 'app-1',
          profile_json: { purpose_of_visit: 'family visit', employed: false },
        },
      }),
      'app-1',
      'user-1',
    );
    const intake = progress?.stages.find((s) => s.slug === 'intake');
    expect(intake?.state).toBe('in_progress');
    expect(progress?.currentStage).toBe('intake');
  });

  it("applies the route's own required answers (Canada TRV asks the IMM 5257 questions)", async () => {
    const progress = await service().forApplication(
      makeDb({
        ...BASE,
        app: {
          id: 'app-1',
          status: 'draft',
          visa_type_id: 'vt-1',
          destination_country: 'CA',
          visa_types: { visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
        } as DbFixture['app'],
        profile: { application_id: 'app-1', profile_json: ANSWERED },
      }),
      'app-1',
      'user-1',
    );
    expect(progress?.stages.find((s) => s.slug === 'intake')?.state).toBe(
      'in_progress',
    );
  });

  it('does NOT report intake complete when the interview has started but no visa type is chosen', async () => {
    const progress = await service().forApplication(
      makeDb(INTAKE_IN_PROGRESS),
      'app-1',
      'user-1',
    );

    // Previously `intakeDone` was `!!profile.data` — the same expression as
    // `hasProfile` — so this state reported Intake COMPLETE, pushed
    // currentStage to 'documents' (next action: "Upload your required
    // documents") and pinned every draft at 17% = 100/6 stages.
    const intake = progress?.stages.find((s) => s.slug === 'intake');
    expect(intake?.state).toBe('in_progress');
    expect(intake?.pct).toBe(50);
    expect(progress?.currentStage).toBe('intake');
    expect(progress?.nextAction.stage).toBe('intake');
    expect(progress?.overallPct).toBe(8); // 50/6, not 100/6
  });

  it('reports intake complete once a visa type is chosen', async () => {
    const progress = await service().forApplication(
      makeDb(INTAKE_DONE),
      'app-1',
      'user-1',
    );
    const intake = progress?.stages.find((s) => s.slug === 'intake');
    expect(intake?.state).toBe('complete');
    expect(intake?.pct).toBe(100);
    expect(progress?.currentStage).toBe('documents');
  });
});

/** Fresh service per assertion: ProgressService memoises the last-observed
 *  stage per application to dedupe analytics, and that state is not relevant
 *  to these completion assertions. */
function service() {
  return new ProgressService();
}

describe('ProgressService — analytics emission', () => {
  it('emits application.stage_advanced only on real transitions (never on the first/baseline read), and application.completed exactly once when overallPct reaches 100', async () => {
    const bus = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    bus.events$.subscribe((e) => seen.push(e));
    const service = new ProgressService(bus);

    // Baseline read establishes 'intake' as the first-observed stage for this
    // application — nothing to advance from yet, so no event.
    const first = await service.forApplication(makeDb(BASE), 'app-1', 'user-1');
    expect(first?.currentStage).toBe('intake');
    expect(seen).toHaveLength(0);

    // Real transition: intake completes → currentStage moves to 'documents'.
    const second = await service.forApplication(
      makeDb(INTAKE_DONE),
      'app-1',
      'user-1',
    );
    expect(second?.currentStage).toBe('documents');
    expect(seen.map((e) => e.name)).toEqual(['application.stage_advanced']);
    expect(seen[0]).toMatchObject({
      name: 'application.stage_advanced',
      user_id: 'user-1',
      application_id: 'app-1',
      props: { from_stage: 'intake', to_stage: 'documents' },
    });

    // Everything completes in one read: another stage_advanced transition
    // PLUS application.completed (overallPct hits 100).
    const third = await service.forApplication(
      makeDb(FULLY_COMPLETE),
      'app-1',
      'user-1',
    );
    expect(third?.overallPct).toBe(100);
    const namesAfterThird = seen.map((e) => e.name);
    expect(namesAfterThird).toContain('application.stage_advanced');
    expect(namesAfterThird).toContain('application.completed');
    expect(
      namesAfterThird.filter((n) => n === 'application.completed'),
    ).toHaveLength(1);

    // A repeat read of the same fully-complete state must not re-fire either
    // event (no further transition; already-completed dedup).
    const countBefore = seen.length;
    await service.forApplication(makeDb(FULLY_COMPLETE), 'app-1', 'user-1');
    expect(seen).toHaveLength(countBefore);
  });

  it('does NOT emit application.stage_advanced on a BACKWARD stage transition (read-derived regression)', async () => {
    const bus = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    bus.events$.subscribe((e) => seen.push(e));
    const service = new ProgressService(bus);

    // Baseline: currentStage = 'intake' (nothing to advance from).
    const first = await service.forApplication(makeDb(BASE), 'app-1', 'user-1');
    expect(first?.currentStage).toBe('intake');

    // Forward: intake completes → currentStage 'documents' → one stage_advanced.
    const second = await service.forApplication(
      makeDb(INTAKE_DONE),
      'app-1',
      'user-1',
    );
    expect(second?.currentStage).toBe('documents');
    expect(seen.map((e) => e.name)).toEqual(['application.stage_advanced']);

    // Regression: the intake profile is gone (e.g. reverted), so currentStage
    // moves BACKWARD to 'intake'. This must NOT emit stage_advanced — the new
    // (earlier) stage is silently recorded as the baseline instead.
    const third = await service.forApplication(makeDb(BASE), 'app-1', 'user-1');
    expect(third?.currentStage).toBe('intake');
    // Still exactly the one forward event — no event added for the regression.
    expect(seen.map((e) => e.name)).toEqual(['application.stage_advanced']);

    // And a subsequent forward move from the regressed baseline emits again
    // (proves the backward move updated the recorded stage, not just skipped).
    const fourth = await service.forApplication(
      makeDb(INTAKE_DONE),
      'app-1',
      'user-1',
    );
    expect(fourth?.currentStage).toBe('documents');
    expect(seen.map((e) => e.name)).toEqual([
      'application.stage_advanced',
      'application.stage_advanced',
    ]);
  });

  it('never throws when constructed without an analytics bus (Optional, additive)', async () => {
    const service = new ProgressService();
    await expect(
      service.forApplication(makeDb(FULLY_COMPLETE), 'app-1', 'user-1'),
    ).resolves.toMatchObject({ applicationId: 'app-1' });
  });
});
