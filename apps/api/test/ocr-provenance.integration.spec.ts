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

  return { processor, provRepo, auditRepo, provenance, prefill, invoke };
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
