import type { Job } from 'bullmq';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { DocumentsProcessor } from '../src/modules/documents/documents.processor';
import type { DocumentJob } from '../src/modules/documents/documents.service';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';

const APP = 'app-1';
const DOC = 'doc-1';

function makeProcessor() {
  const auditRepo = new FakeAuditRepository();
  const provRepo = new FakeProvenanceRepository();
  const provenance = new ProvenanceService(
    provRepo,
    new AuditService(auditRepo),
  );

  const prefill = {
    autoGenerateIfReady: jest.fn().mockResolvedValue(undefined),
  };
  // SupabaseService + ConfigService are only used by onModuleInit/graph, which we
  // bypass by injecting a mock graph directly.
  const verification = { ensureFields: jest.fn().mockResolvedValue(undefined) };
  const processor = new DocumentsProcessor(
    {} as never,
    {} as never,
    prefill as never,
    provenance,
    verification as never,
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
    extractedFields: {
      passport_number: 'X1234567',
      full_name: 'JANE DOE',
      expiry_date: '2031-03-14',
    },
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

  return { processor, provRepo, auditRepo, provenance, prefill, invoke, verification };
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

describe('Phase 3A — OCR -> Provenance integration', () => {
  it('records an ocr_run and one provenance version per extracted field', async () => {
    const { processor, provRepo } = makeProcessor();
    await processor.process(job());

    expect(provRepo.ocrRuns).toHaveLength(1);
    expect(provRepo.ocrRuns[0]).toMatchObject({
      provider: 'mock',
      region: 'global',
      status: 'complete',
    });
    expect(provRepo.ocrRuns[0].raw_text_hash).toBeTruthy();

    expect(provRepo.rows).toHaveLength(3);
    for (const row of provRepo.rows) {
      expect(row.origin).toBe('ocr');
      expect(row.ocr_run_id).toBe(provRepo.ocrRuns[0].id);
      expect(row.source_document_id).toBe(DOC);
      expect(row.superseded_by).toBeNull();
    }
  });

  it('preserves value_hash consistency with the deterministic service hash', async () => {
    const { processor, provRepo, provenance } = makeProcessor();
    await processor.process(job());

    const pp = provRepo.rows.find((r) => r.field_key === 'passport_number')!;
    expect(pp.value_hash).toBe(provenance.valueHash('X1234567'));
    const exp = provRepo.rows.find((r) => r.field_key === 'expiry_date')!;
    expect(exp.value_hash).toBe(provenance.valueHash('2031-03-14'));
  });

  it('emits exactly OCR_COMPLETED + FIELD_EXTRACTED, chain intact', async () => {
    const { processor, auditRepo } = makeProcessor();
    await processor.process(job());

    const types = auditRepo.rows.map((e) => e.event_type).sort();
    expect(types).toEqual([
      'FIELD_EXTRACTED',
      'FIELD_EXTRACTED',
      'FIELD_EXTRACTED',
      'OCR_COMPLETED',
    ]);
    expect((await new AuditService(auditRepo).verifyChain(APP)).intact).toBe(
      true,
    );
  });

  it('triggers NO downstream verification/consultant/preflight/eligibility events', async () => {
    const { processor, auditRepo } = makeProcessor();
    await processor.process(job());

    const downstream = auditRepo.rows.filter((e) =>
      [
        'USER_CONFIRMED',
        'CONSULTANT_REVIEWED',
        'CONSULTANT_APPROVED',
        'PREFLIGHT_STARTED',
        'PREFLIGHT_COMPLETED',
        'EXECUTION_READY',
      ].includes(e.event_type),
    );
    expect(downstream).toHaveLength(0);
  });

  it('does not fail the OCR job when provenance ingestion throws (best-effort)', async () => {
    const { processor, provenance, prefill } = makeProcessor();
    jest
      .spyOn(provenance, 'recordOcrRun')
      .mockRejectedValueOnce(new Error('db down'));
    await expect(processor.process(job())).resolves.toBeUndefined();
    // existing pipeline continuation still runs
    expect(prefill.autoGenerateIfReady).toHaveBeenCalledWith(APP);
  });

  it('still surfaces graph errors (provenance hook does not mask them)', async () => {
    const { processor, invoke } = makeProcessor();
    invoke.mockResolvedValueOnce({
      rawOcrText: '',
      extractedFields: {},
      error: 'OCR failed: boom',
    });
    await expect(processor.process(job())).rejects.toThrow(/OCR failed: boom/);
  });
});

/**
 * Live 2026-10-19: a lease PDF was first read as an ID card and its landlord's
 * CNIC became the application's current national_id_number. Re-read as a
 * lease (#233) it yielded no ID number, yet the old version stayed current and
 * the consultant was offered it to approve.
 */
describe('a re-read that no longer yields a field takes it back', () => {
  const LEASE = 'doc-lease';
  const leaseJob = (): Job<DocumentJob> =>
    ({ data: { ...job().data, documentId: LEASE } }) as Job<DocumentJob>;
  const result = (documentId: string, fields: Record<string, unknown>) => ({
    documentId,
    applicationId: APP,
    storagePath: 'p',
    mimeType: 'application/pdf',
    documentType: 'lease_agreement',
    signedUrl: '',
    rawOcrText: 'text',
    extractedFields: fields,
    verificationResult: 'pass' as const,
    verificationDetails: [],
    allDocsProcessed: false,
    error: null,
  });
  const current = (repo: FakeProvenanceRepository, key: string) =>
    repo.rows.find((r) => r.field_key === key && r.superseded_by === null);

  it('falls back to the version from other evidence, and audits the retirement', async () => {
    const { processor, provRepo, auditRepo, invoke } = makeProcessor();
    // The ID card gives the applicant's own number…
    invoke.mockResolvedValueOnce(
      result(DOC, { national_id_number: '34101-0000000-1' }),
    );
    await processor.process(job());
    // …a lease read as an ID gives the landlord's, twice…
    invoke.mockResolvedValueOnce(
      result(LEASE, { national_id_number: '34201-1111111-5', tenant: 'X' }),
    );
    await processor.process(leaseJob());
    invoke.mockResolvedValueOnce(
      result(LEASE, { national_id_number: '34201-1111111-5', tenant: 'X' }),
    );
    await processor.process(leaseJob());
    expect(current(provRepo, 'national_id_number')?.value_snapshot).toBe(
      '34201-1111111-5',
    );
    // …and the lease re-read as a lease yields none.
    invoke.mockResolvedValueOnce(result(LEASE, { tenant: 'X' }));
    await processor.process(leaseJob());

    expect(current(provRepo, 'national_id_number')?.value_snapshot).toBe(
      '34101-0000000-1',
    );
    // The lease's reads stay in the history, retired (pointing at themselves).
    const leaseIds = provRepo.rows.filter(
      (r) => r.source_document_id === LEASE && r.field_key === 'national_id_number',
    );
    expect(leaseIds).toHaveLength(2);
    expect(leaseIds.every((r) => r.superseded_by === r.id)).toBe(true);
    // What the lease still says is untouched.
    expect(current(provRepo, 'tenant')?.source_document_id).toBe(LEASE);
    const retired = auditRepo.rows.filter(
      (e) => (e.payload as { retired?: boolean } | null)?.retired,
    );
    expect(retired).toHaveLength(1);
  });

  it('a field only that document gave is left with no current value', async () => {
    const { processor, provRepo, invoke } = makeProcessor();
    invoke.mockResolvedValueOnce(
      result(LEASE, { national_id_number: '34201-1111111-5' }),
    );
    await processor.process(leaseJob());
    invoke.mockResolvedValueOnce(result(LEASE, {}));
    await processor.process(leaseJob());
    expect(current(provRepo, 'national_id_number')).toBeUndefined();
    expect(provRepo.rows).toHaveLength(1);
    // A third read retires nothing new and audits nothing.
    invoke.mockResolvedValueOnce(result(LEASE, {}));
    await processor.process(leaseJob());
    expect(provRepo.rows[0].superseded_by).toBe(provRepo.rows[0].id);
  });

  it('a new read of the field by that document makes it current again', async () => {
    const { processor, provRepo, invoke } = makeProcessor();
    invoke.mockResolvedValueOnce(result(LEASE, { national_id_number: 'A' }));
    await processor.process(leaseJob());
    invoke.mockResolvedValueOnce(result(LEASE, {}));
    await processor.process(leaseJob());
    invoke.mockResolvedValueOnce(result(LEASE, { national_id_number: 'B' }));
    await processor.process(leaseJob());
    expect(current(provRepo, 'national_id_number')?.value_snapshot).toBe('B');
  });

  it("never touches another document's versions", async () => {
    const { processor, provRepo, invoke } = makeProcessor();
    invoke.mockResolvedValueOnce(result(DOC, { passport_number: 'X1' }));
    await processor.process(job());
    invoke.mockResolvedValueOnce(result(LEASE, {}));
    await processor.process(leaseJob());
    expect(current(provRepo, 'passport_number')?.value_snapshot).toBe('X1');
  });

  it('a field the document type may give is kept when one read misses it', async () => {
    const { processor, provRepo, invoke } = makeProcessor();
    // full_name is in every type's schema: a flaky read without it is not a
    // statement that the document lacks it.
    invoke.mockResolvedValueOnce(result(LEASE, { full_name: 'ALI', tenant: 'X' }));
    await processor.process(leaseJob());
    invoke.mockResolvedValueOnce(result(LEASE, { tenant: 'X' }));
    await processor.process(leaseJob());
    expect(current(provRepo, 'full_name')?.value_snapshot).toBe('ALI');
  });

  it('verification is still seeded when retirement fails', async () => {
    const { processor, provRepo, invoke, verification } = makeProcessor();
    jest
      .spyOn(provRepo, 'retireDocumentFieldsExcept')
      .mockRejectedValueOnce(new Error('db down'));
    invoke.mockResolvedValueOnce(result(LEASE, { tenant: 'X' }));
    await expect(processor.process(leaseJob())).resolves.toBeUndefined();
    expect(verification.ensureFields).toHaveBeenCalled();
  });

  it('a read that re-typed the document keeps only what it gave', async () => {
    const { processor, provRepo, invoke } = makeProcessor();
    invoke.mockResolvedValueOnce(result(LEASE, { full_name: 'LANDLORD', national_id_number: 'L1' }));
    await processor.process(leaseJob());
    // classify_document found a lease: the ID-card read's name goes too.
    invoke.mockResolvedValueOnce({ ...result(LEASE, { tenant: 'X' }), classifiedFromContent: true });
    await processor.process(leaseJob());
    expect(current(provRepo, 'full_name')).toBeUndefined();
    expect(current(provRepo, 'national_id_number')).toBeUndefined();
  });

  it('an approved value the database left alone is audited as skipped, not retired', async () => {
    const { processor, provRepo, auditRepo, invoke } = makeProcessor();
    jest.spyOn(provRepo, 'retireDocumentFieldsExcept').mockResolvedValueOnce([
      { field_key: 'national_id_number', retired: 0, skipped_approved: true },
    ]);
    invoke.mockResolvedValueOnce(result(LEASE, { tenant: 'X' }));
    await processor.process(leaseJob());
    const payloads = auditRepo.rows.map((e) => e.payload as Record<string, unknown> | null);
    expect(payloads.some((p) => p?.retire_skipped === 'consultant_approved')).toBe(true);
    expect(payloads.some((p) => p?.retired)).toBe(false);
  });
});
