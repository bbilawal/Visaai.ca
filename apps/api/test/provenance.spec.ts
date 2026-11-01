import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';

// ---- in-memory audit repo (so provenance->audit emission is observable) ----

// ---- in-memory provenance repo with versioning semantics ----

const APP = 'app-1';

function make() {
  const provRepo = new FakeProvenanceRepository();
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo);
  const svc = new ProvenanceService(provRepo, audit);
  return { svc, provRepo, auditRepo };
}

function ocrField(
  over: Partial<Parameters<ProvenanceService['createFieldProvenance']>[0]> = {},
) {
  return {
    applicationId: APP,
    fieldKey: 'passport_number',
    origin: 'ocr' as const,
    value: 'X1234567',
    sourceDocumentId: 'doc-1',
    sourcePage: 1,
    sourceBBox: {
      page: 1,
      unit: 'ratio' as const,
      x: 0.4,
      y: 0.2,
      w: 0.18,
      h: 0.03,
    },
    ocrRunId: 'run-1',
    confidence: 0.97,
    ...over,
  };
}

describe('ProvenanceService — valueHash (F)', () => {
  it('is deterministic and trims/normalizes strings', () => {
    const { svc } = make();
    expect(svc.valueHash('X1234567')).toBe(svc.valueHash('  X1234567  '));
  });
  it('treats number and its string form identically', () => {
    const { svc } = make();
    expect(svc.valueHash(5)).toBe(svc.valueHash('5'));
  });
  it('distinct values hash differently', () => {
    const { svc } = make();
    expect(svc.valueHash('A')).not.toBe(svc.valueHash('B'));
  });
  it('null normalizes to the empty-string hash, deterministically', () => {
    const { svc } = make();
    expect(svc.valueHash(null)).toBe(svc.valueHash(''));
  });
});

describe('ProvenanceService — recordOcrRun (A, G)', () => {
  it('persists the run and emits OCR_COMPLETED', async () => {
    const { svc, provRepo, auditRepo } = make();
    const run = await svc.recordOcrRun({
      documentId: 'doc-1',
      applicationId: APP,
      provider: 'azure-di',
      region: 'ca-central-1',
      status: 'complete',
      pageCount: 2,
      rawText: 'hello',
    });
    expect(provRepo.ocrRuns).toHaveLength(1);
    expect(run.raw_text_hash).toBeTruthy();
    const evt = auditRepo.rows.find((e) => e.event_type === 'OCR_COMPLETED');
    expect(evt).toBeDefined();
    expect(evt!.ocr_run_id).toBe(run.id);
    expect(evt!.document_id).toBe('doc-1');
  });
});

describe('ProvenanceService — createFieldProvenance (B, G)', () => {
  it('creates a current version carrying all required fields + value_hash', async () => {
    const { svc } = make();
    const row = await svc.createFieldProvenance(ocrField());
    expect(row.superseded_by).toBeNull();
    expect(row.source_document_id).toBe('doc-1');
    expect(row.source_page).toBe(1);
    expect(row.source_bbox).not.toBeNull();
    expect(row.ocr_run_id).toBe('run-1');
    expect(row.value_hash).toBe(svc.valueHash('X1234567'));
    expect(row.confidence_band).toBe('high');
  });

  it('emits FIELD_EXTRACTED with value_hash and NO raw value in payload', async () => {
    const { svc, auditRepo } = make();
    await svc.createFieldProvenance(ocrField());
    const evt = auditRepo.rows.find((e) => e.event_type === 'FIELD_EXTRACTED');
    expect(evt).toBeDefined();
    expect(evt!.value_hash).toBe(svc.valueHash('X1234567'));
    expect(JSON.stringify(evt!.payload)).not.toContain('X1234567');
    expect(evt!.payload).not.toHaveProperty('value');
  });

  it('rejects ocr-origin without an ocrRunId', async () => {
    const { svc } = make();
    await expect(
      svc.createFieldProvenance(ocrField({ ocrRunId: undefined })),
    ).rejects.toThrow(/ocrRunId/);
  });
});

describe('ProvenanceService — supersede + versioning (C, D, E)', () => {
  it('supersede creates a new version; old becomes non-current; history grows', async () => {
    const { svc, provRepo } = make();
    const v1 = await svc.createFieldProvenance(ocrField());
    const v2 = await svc.supersedeFieldProvenance(
      ocrField({ value: 'Y9999999' }),
    );

    expect(v1.id).not.toBe(v2.id);
    const current = await svc.getCurrentFieldVersion(APP, 'passport_number');
    expect(current!.id).toBe(v2.id);

    const history = await svc.getFieldHistory(APP, 'passport_number');
    expect(history.map((h) => h.id)).toEqual([v1.id, v2.id]);

    // exactly one current
    expect(provRepo.rows.filter((r) => r.superseded_by === null)).toHaveLength(
      1,
    );
  });

  it('history is immutable — old version value is never rewritten', async () => {
    const { svc, provRepo } = make();
    await svc.createFieldProvenance(ocrField());
    await svc.supersedeFieldProvenance(ocrField({ value: 'Y9999999' }));
    const v1 = provRepo.rows[0];
    expect(v1.value_hash).toBe(svc.valueHash('X1234567')); // unchanged
    expect(v1.superseded_by).toBe(provRepo.rows[1].id); // only lineage pointer set
    expect(provRepo.rows).toHaveLength(2); // nothing deleted
  });

  it('supersede requires an existing current version', async () => {
    const { svc } = make();
    await expect(svc.supersedeFieldProvenance(ocrField())).rejects.toThrow(
      /no current/,
    );
  });

  it('three versions -> one current, ordered history of 3', async () => {
    const { svc } = make();
    await svc.createFieldProvenance(ocrField({ value: 'a' }));
    await svc.supersedeFieldProvenance(ocrField({ value: 'b' }));
    await svc.supersedeFieldProvenance(ocrField({ value: 'c' }));
    const history = await svc.getFieldHistory(APP, 'passport_number');
    expect(history).toHaveLength(3);
    expect(history.filter((h) => h.superseded_by === null)).toHaveLength(1);
    expect(history[2].value_hash).toBe(svc.valueHash('c'));
  });
});

describe('ProvenanceService — audit emission count (G)', () => {
  it('every provenance event produces exactly one audit event', async () => {
    const { svc, auditRepo } = make();
    await svc.recordOcrRun({
      documentId: 'doc-1',
      applicationId: APP,
      provider: 'mock',
      region: 'global',
      status: 'complete',
    });
    await svc.createFieldProvenance(ocrField());
    await svc.supersedeFieldProvenance(ocrField({ value: 'Z' }));

    const types = auditRepo.rows.map((e) => e.event_type);
    expect(types).toEqual(['OCR_COMPLETED', 'FIELD_EXTRACTED', 'FIELD_EDITED']);
    // chain stays intact across mixed provenance emissions
    expect((await new AuditService(auditRepo).verifyChain(APP)).intact).toBe(
      true,
    );
  });
});
