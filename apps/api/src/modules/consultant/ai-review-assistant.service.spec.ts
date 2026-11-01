import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AiReviewAssistantService } from './ai-review-assistant.service';
import type { AiService } from '../shared/ai/ai.service';
import type { ConsultantWriteClient } from './consultant-write-client';
import type { IAssignmentRepository } from './assignment.repository';

/**
 * Chainable Supabase query-builder fake. Every fluent method returns the same
 * builder; the builder is thenable (resolves the list loaders) and exposes
 * maybeSingle for the single-row VRI loader. Per-table data is keyed by name.
 */
function tableResult(data: unknown) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    in: () => builder,
    maybeSingle: () => Promise.resolve({ data, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data, error: null }),
  };
  return builder;
}

function makeClient(byTable: Record<string, unknown>): SupabaseClient {
  return {
    from: (t: string) => tableResult(byTable[t] ?? []),
  } as unknown as SupabaseClient;
}

/** A case with one missing required doc, a weak VRI, a failed docver + mismatch. */
const TABLES = {
  checklist_items: [
    {
      document_type: 'bank_statement',
      label: 'Bank statement',
      required: true,
      status: 'missing',
      added_reason: null,
    },
    {
      document_type: 'passport',
      label: 'Passport',
      required: true,
      status: 'verified',
      added_reason: null,
    },
  ],
  vri_scores: {
    overall_score: 35,
    documentation_pct: 30,
    financial_pct: 80,
    travel_history_pct: 90,
    home_ties_pct: 88,
    employment_pct: 92,
    consistency_pct: 85,
    calculated_at: '2026-06-26T00:00:00Z',
  },
  documents: [
    {
      id: 'doc-1',
      file_name: 'passport.pdf',
      checklist_items: { document_type: 'passport' },
    },
  ],
  document_verifications: [
    {
      document_id: 'doc-1',
      verification_type: 'identity',
      result: 'fail',
      verified_at: '2026-06-26T00:00:00Z',
    },
  ],
  cross_verifications: [
    {
      field_compared: 'date_of_birth',
      result: 'mismatch',
      checked_at: '2026-06-26T00:00:00Z',
    },
  ],
};

function makeWrites(
  byTable: Record<string, unknown> = TABLES,
): ConsultantWriteClient {
  return { client: makeClient(byTable) } as unknown as ConsultantWriteClient;
}

/** AiService stub. Default: unavailable → deterministic fallback (no LLM). */
function makeAi(available = false): AiService {
  return {
    available,
    completeJSON: jest.fn(),
  } as unknown as AiService;
}

function makeRepo(
  overrides: Partial<IAssignmentRepository> = {},
): IAssignmentRepository {
  return {
    getApplicationMeta: jest.fn().mockResolvedValue({ id: 'app-1' }),
    getActiveAssignmentFor: jest.fn().mockResolvedValue({ id: 'asg-1' }),
    ...overrides,
  } as unknown as IAssignmentRepository;
}

const ADMIN = { id: 'admin-1', appRole: 'admin' as const };
const CONSULTANT = { id: 'cons-1', appRole: 'consultant' as const };

describe('AiReviewAssistantService', () => {
  describe('analyze (deterministic)', () => {
    it('detects missing required docs and flags VRI/docver/crossver risks', async () => {
      const svc = new AiReviewAssistantService(
        makeAi(),
        makeWrites(),
        makeRepo(),
      );
      const analysis = await svc.analyze('app-1', ADMIN);

      // one required+missing checklist row -> one missing document
      expect(analysis.missingDocuments).toHaveLength(1);
      expect(analysis.missingDocuments[0].documentType).toBe('bank_statement');

      // risk flags: overall-low + documentation-low + docver fail + crossver mismatch
      const codes = analysis.riskFlags.map((f) => f.code);
      expect(codes).toContain('vri.overall_low');
      expect(codes).toContain('vri.documentation_pct_low');
      expect(codes).toContain('docver.fail');
      expect(codes).toContain('crossver.mismatch');
      expect(analysis.counts.highSeverity).toBeGreaterThanOrEqual(3);
      expect(analysis.advisory).toBe(true);
    });

    it('does not flag healthy dimensions', async () => {
      const healthy = {
        ...TABLES,
        vri_scores: {
          overall_score: 90,
          documentation_pct: 85,
          financial_pct: 85,
          travel_history_pct: 85,
          home_ties_pct: 85,
          employment_pct: 85,
          consistency_pct: 85,
          calculated_at: '2026-06-26T00:00:00Z',
        },
        document_verifications: [],
        cross_verifications: [],
      };
      const svc = new AiReviewAssistantService(
        makeAi(),
        makeWrites(healthy),
        makeRepo(),
      );
      const analysis = await svc.analyze('app-1', ADMIN);
      expect(analysis.riskFlags).toHaveLength(0);
    });
  });

  describe('getReview (advisory bundle)', () => {
    it('returns analysis + fallback suggestions/summary and an advisory disclaimer', async () => {
      const ai = makeAi(false);
      const svc = new AiReviewAssistantService(ai, makeWrites(), makeRepo());
      const review = await svc.getReview('app-1', CONSULTANT);

      expect(review.advisory).toBe(true);
      expect(review.disclaimer).toMatch(/does not approve, reject, or submit/i);
      expect(review.analysis.missingDocuments).toHaveLength(1);
      // ai unavailable → fallback source, LLM never called
      expect(review.suggestions.source).toBe('fallback');
      expect(review.summary.source).toBe('fallback');
      expect(ai.completeJSON).not.toHaveBeenCalled();
    });

    it('never issues approve/reject decisions (no decision writes)', async () => {
      // repo exposes only read/authorization methods; any write attempt would be
      // an undefined call. The service must return a pure advisory payload.
      const svc = new AiReviewAssistantService(
        makeAi(),
        makeWrites(),
        makeRepo(),
      );
      const review = await svc.getReview('app-1', CONSULTANT);
      expect(review).not.toHaveProperty('decision');
      expect(review.analysis.advisory).toBe(true);
    });
  });

  describe('authorization', () => {
    it('403s when a consultant is not the active assignee', async () => {
      const svc = new AiReviewAssistantService(
        makeAi(),
        makeWrites(),
        makeRepo({ getActiveAssignmentFor: jest.fn().mockResolvedValue(null) }),
      );
      await expect(svc.analyze('app-1', CONSULTANT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('404s when the application does not exist', async () => {
      const svc = new AiReviewAssistantService(
        makeAi(),
        makeWrites(),
        makeRepo({ getApplicationMeta: jest.fn().mockResolvedValue(null) }),
      );
      await expect(svc.getReview('nope', ADMIN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('allows admins without an assignment check', async () => {
      const getActiveAssignmentFor = jest.fn();
      const svc = new AiReviewAssistantService(
        makeAi(),
        makeWrites(),
        makeRepo({ getActiveAssignmentFor }),
      );
      await svc.analyze('app-1', ADMIN);
      expect(getActiveAssignmentFor).not.toHaveBeenCalled();
    });
  });
});
