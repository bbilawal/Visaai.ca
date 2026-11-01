import type { Job } from 'bullmq';
import type {
  FieldVerification,
  SeedFieldInput,
  VerificationState,
} from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { VerificationService } from '../src/modules/verification/verification.service';
import type { IVerificationRepository } from '../src/modules/verification/verification.repository';
import { DocumentsProcessor } from '../src/modules/documents/documents.processor';
import type { DocumentJob } from '../src/modules/documents/documents.service';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';

/**
 * DUP-001: deliberately NOT shared. `transition()` here THROWS on purpose —
 * it is a tripwire proving that seeding never transitions a field. The copies in
 * eligibility/preflight implement it for real because those tests exercise
 * transitions. Same class name, opposite intent.
 */
class FakeVerificationRepository implements IVerificationRepository {
  rows = new Map<string, FieldVerification>();
  upsertCalls = 0;
  private k(a: string, f: string) {
    return `${a}::${f}`;
  }
  async upsertSeed(app: string, fields: SeedFieldInput[]): Promise<void> {
    this.upsertCalls++;
    for (const f of fields) {
      const key = this.k(app, f.fieldKey);
      if (this.rows.has(key)) continue; // idempotent: ignore existing
      const now = new Date().toISOString();
      this.rows.set(key, {
        id: key,
        application_id: app,
        field_key: f.fieldKey,
        section: f.section ?? null,
        state: 'EXTRACTED',
        value_snapshot: f.value == null ? null : String(f.value),
        value_hash: f.valueHash ?? null,
        source: f.source ?? null,
        source_document_id: f.sourceDocumentId ?? null,
        user_confirmed_by: null,
        user_confirmed_at: null,
        consultant_reviewed_by: null,
        consultant_reviewed_at: null,
        consultant_approved_by: null,
        consultant_approved_at: null,
        executed_at: null,
        created_at: now,
        updated_at: now,
      });
    }
  }
  async getByField(
    app: string,
    field: string,
  ): Promise<FieldVerification | null> {
    const r = this.rows.get(this.k(app, field));
    return r ? { ...r } : null;
  }
  async getStates(app: string): Promise<FieldVerification[]> {
    return [...this.rows.values()]
      .filter((r) => r.application_id === app)
      .map((r) => ({ ...r }));
  }
  async getSectionRollup() {
    return [];
  }
  async transition(
    _a: string,
    _f: string,
    _from: VerificationState,
    _to: VerificationState,
  ): Promise<FieldVerification> {
    throw new Error('transition must NOT be called during seeding');
  }
  async listByDocument(): Promise<FieldVerification[]> {
    return [];
  }
}

const APP = 'app-1';
const DOC = 'doc-1';

function makeProcessor() {
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo);
  const provRepo = new FakeProvenanceRepository();
  const provenance = new ProvenanceService(provRepo, audit);
  const verifRepo = new FakeVerificationRepository();
  const verification = new VerificationService(verifRepo, audit);
  const prefill = {
    autoGenerateIfReady: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new DocumentsProcessor(
    {} as never,
    {} as never,
    prefill as never,
    provenance,
    verification,
    // TranslationService and AiUsageMeter became required 6th/7th deps.
    {} as never,
    {} as never,
  );

  const graphResult = {
    documentId: DOC,
    applicationId: APP,
    storagePath: 'p',
    mimeType: 'application/pdf',
    documentType: 'passport',
    signedUrl: '',
    rawOcrText: 'PASSPORT JANE DOE X1234567',
    extractedFields: { passport_number: 'X1234567', full_name: 'JANE DOE' },
    verificationResult: 'pass' as const,
    verificationDetails: [],
    allDocsProcessed: false,
    error: null,
  };
  const invoke = jest.fn().mockResolvedValue(graphResult);
  (processor as unknown as { graph: unknown }).graph = { invoke };
  (processor as unknown as { ocrProviderName: string }).ocrProviderName =
    'mock';
  (processor as unknown as { ocrRegion: string }).ocrRegion = 'global';

  return { processor, provRepo, verifRepo, auditRepo, provenance };
}

function job(): Job<DocumentJob> {
  return {
    data: {
      documentId: DOC,
      applicationId: APP,
      storagePath: 'p',
      mimeType: 'application/pdf',
      documentType: 'passport',
    },
  } as Job<DocumentJob>;
}

describe('Phase 3B — Extraction -> Verification seeding', () => {
  it('seeds verification rows in EXTRACTED state only, linked to provenance value_hash', async () => {
    const { processor, verifRepo, provenance } = makeProcessor();
    await processor.process(job());

    const states = await verifRepo.getStates(APP);
    expect(states).toHaveLength(2);
    for (const s of states) {
      expect(s.state).toBe('EXTRACTED');
      expect(s.source_document_id).toBe(DOC);
      expect(s.user_confirmed_at).toBeNull();
      expect(s.consultant_approved_at).toBeNull();
    }
    const pp = states.find((s) => s.field_key === 'passport_number')!;
    expect(pp.value_hash).toBe(provenance.valueHash('X1234567')); // bound to provenance
  });

  it('is idempotent across repeated OCR runs (no duplicate state)', async () => {
    const { processor, verifRepo } = makeProcessor();
    await processor.process(job());
    await processor.process(job());
    expect(verifRepo.upsertCalls).toBe(2); // called each run
    expect(await verifRepo.getStates(APP)).toHaveLength(2); // but no duplicates
  });

  it('triggers no transitions and no downstream events', async () => {
    const { processor, auditRepo } = makeProcessor();
    await processor.process(job());
    // seeding emits no audit; only provenance ingestion does
    const types = new Set(auditRepo.rows.map((e) => e.event_type));
    expect([...types].sort()).toEqual(['FIELD_EXTRACTED', 'OCR_COMPLETED']);
    expect(types.has('USER_CONFIRMED')).toBe(false);
    expect(types.has('CONSULTANT_APPROVED')).toBe(false);
    expect(types.has('PREFLIGHT_STARTED')).toBe(false);
    expect(types.has('EXECUTION_READY')).toBe(false);
  });
});
