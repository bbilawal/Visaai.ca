import { computeProgress, type ProgressInput } from '@visaai/types';

function baseInput(over: Partial<ProgressInput> = {}): ProgressInput {
  return {
    applicationId: 'app-1',
    status: 'draft',
    hasProfile: false,
    intakeDone: false,
    requiredChecklist: [],
    // The default route's letters. [] now means "this route needs none"
    // (Canada's eTA) and completes the stage — see route-letters.ts.
    requiredGenTypes: ['loe', 'cover_letter'],
    approvedGenTypes: [],
    hasVriScore: false,
    hasPrefill: false,
    submissionStatus: null,
    lastActiveAt: '2026-06-01T00:00:00.000Z',
    now: '2026-06-04T00:00:00.000Z',
    ...over,
  };
}

describe('computeProgress', () => {
  it('fresh draft: intake is the current stage, 0% overall', () => {
    const p = computeProgress(baseInput());
    expect(p.currentStage).toBe('intake');
    expect(p.overallPct).toBe(0);
    expect(p.stages.find((s) => s.slug === 'intake')!.state).toBe('available');
  });

  it('intake complete moves current stage to documents', () => {
    const p = computeProgress(
      baseInput({ hasProfile: true, intakeDone: true }),
    );
    expect(p.stages.find((s) => s.slug === 'intake')!.state).toBe('complete');
    expect(p.currentStage).toBe('documents');
  });

  it('documents pct reflects verified/waived ratio of required items', () => {
    const p = computeProgress(
      baseInput({
        hasProfile: true,
        intakeDone: true,
        requiredChecklist: [
          { status: 'verified' },
          { status: 'waived' },
          { status: 'uploaded' },
          { status: 'missing' },
        ],
      }),
    );
    const docs = p.stages.find((s) => s.slug === 'documents')!;
    expect(docs.pct).toBe(50);
    expect(docs.state).toBe('in_progress');
  });

  it('submission is locked until documents complete', () => {
    const p = computeProgress(
      baseInput({
        hasProfile: true,
        intakeDone: true,
        requiredChecklist: [{ status: 'missing' }],
      }),
    );
    expect(p.stages.find((s) => s.slug === 'submission')!.state).toBe('locked');
  });

  // A required checklist item of kind 'form' is a blank government form we hand
  // the applicant (IMM 5257, SCHENGEN-C, I-130 …), not evidence they upload.
  // Counting it made the Documents stage unreachable for almost every real
  // application, which also left Submit locked forever — the caller must pass
  // `meta` through for documentsCompletion to tell the two apart.
  it('a required government FORM does not block the documents stage', () => {
    const p = computeProgress(
      baseInput({
        hasProfile: true,
        intakeDone: true,
        requiredChecklist: [
          { status: 'verified', meta: { kind: 'document' } },
          { status: 'verified', meta: { kind: 'document' } },
          { status: 'missing', meta: { kind: 'form' } },
        ],
      }),
    );
    const docs = p.stages.find((s) => s.slug === 'documents')!;
    expect(docs.pct).toBe(100);
    expect(docs.state).toBe('complete');
    expect(p.stages.find((s) => s.slug === 'submission')!.state).not.toBe(
      'locked',
    );
  });

  it('stage order runs intake → documents → narrative → prefill → readiness → submission', () => {
    const p = computeProgress(baseInput());
    expect(p.stages.map((s) => s.slug)).toEqual([
      'intake',
      'documents',
      'narrative',
      'prefill',
      'readiness',
      'submission',
    ]);
  });

  it('stalledDays is floor of day diff', () => {
    const p = computeProgress(
      baseInput({
        lastActiveAt: '2026-06-01T00:00:00.000Z',
        now: '2026-06-04T12:00:00.000Z',
      }),
    );
    expect(p.stalledDays).toBe(3);
  });

  it('never throws on missing rows; unknown stages default available/locked', () => {
    expect(() => computeProgress(baseInput())).not.toThrow();
  });

  it('returns 0 stalledDays (not NaN) on invalid timestamps', () => {
    const p = computeProgress(baseInput({ lastActiveAt: 'not-a-date' }));
    expect(p.stalledDays).toBe(0);
    expect(Number.isNaN(p.stalledDays)).toBe(false);
  });
});
