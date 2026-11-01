import type {
  AuditEvent,
  FieldVerification,
  SectionVerification,
  SeedFieldInput,
  VerificationState,
} from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from '../src/modules/audit/audit.repository';
import { VerificationService } from '../src/modules/verification/verification.service';
import type { IVerificationRepository } from '../src/modules/verification/verification.repository';

// ---- in-memory audit repo ----
class FakeAuditRepository implements IAuditRepository {
  rows: AuditEvent[] = [];
  private n = 0;
  async getChainHead(app: string): Promise<ChainHead | null> {
    const r = this.rows.filter((x) => x.application_id === app);
    if (!r.length) return null;
    const h = r.reduce((a, b) => (b.seq > a.seq ? b : a));
    return { seq: h.seq, rowHash: h.row_hash };
  }
  async appendEvent(row: NewAuditEventRow): Promise<AuditEvent> {
    const full: AuditEvent = { id: `evt-${++this.n}`, ...row };
    this.rows.push(full);
    return full;
  }
  async getTrail(app: string): Promise<AuditEvent[]> {
    return this.rows
      .filter((x) => x.application_id === app)
      .sort((a, b) => a.seq - b.seq);
  }
  async findByIdempotencyKey(): Promise<AuditEvent | null> {
    return null;
  }
}

// ---- in-memory verification repo ----
function blankRow(app: string, f: SeedFieldInput): FieldVerification {
  const now = new Date().toISOString();
  return {
    id: `${app}:${f.fieldKey}`,
    application_id: app,
    field_key: f.fieldKey,
    section: f.section ?? null,
    state: 'EXTRACTED',
    value_snapshot: f.value == null ? null : String(f.value),
    value_hash: null,
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
  };
}

class FakeVerificationRepository implements IVerificationRepository {
  rows = new Map<string, FieldVerification>();
  private key(app: string, f: string) {
    return `${app}::${f}`;
  }
  async upsertSeed(app: string, fields: SeedFieldInput[]): Promise<void> {
    for (const f of fields) {
      const k = this.key(app, f.fieldKey);
      if (!this.rows.has(k)) this.rows.set(k, blankRow(app, f));
    }
  }
  async getByField(
    app: string,
    field: string,
  ): Promise<FieldVerification | null> {
    const r = this.rows.get(this.key(app, field));
    return r ? { ...r } : null;
  }
  async getStates(app: string): Promise<FieldVerification[]> {
    return [...this.rows.values()]
      .filter((r) => r.application_id === app)
      .map((r) => ({ ...r }));
  }
  async getSectionRollup(): Promise<SectionVerification[]> {
    return [];
  }
  async transition(
    app: string,
    field: string,
    expectedFrom: VerificationState,
    to: VerificationState,
    patch: Partial<FieldVerification>,
  ): Promise<FieldVerification> {
    const r = this.rows.get(this.key(app, field));
    if (!r || r.state !== expectedFrom) throw new Error('stale transition');
    Object.assign(r, patch, {
      state: to,
      updated_at: new Date().toISOString(),
    });
    return { ...r };
  }
  async listByDocument(documentId: string): Promise<FieldVerification[]> {
    return [...this.rows.values()].filter(
      (r) => r.source_document_id === documentId,
    );
  }
}

const APP = 'app-1';

function make() {
  const repo = new FakeVerificationRepository();
  const auditRepo = new FakeAuditRepository();
  const svc = new VerificationService(repo, new AuditService(auditRepo));
  return { svc, repo, auditRepo };
}

async function approveFull(svc: VerificationService, field: string) {
  await svc.confirmField(APP, field, { id: 'u1', role: 'applicant' }, 'h');
  await svc.reviewField(APP, field, 'c1', 'h');
  await svc.approveField(APP, field, 'c1', 'h');
}

const ALL_SECTIONS = [
  'passport',
  'address',
  'travel_history',
  'employment',
  'identity',
];

async function seedAllRequired(svc: VerificationService) {
  await svc.ensureFields(
    APP,
    ALL_SECTIONS.map((s) => ({
      fieldKey: `${s}_field`,
      section: s,
      value: 'v',
    })),
  );
}

describe('VerificationService — transition validation (A, B)', () => {
  it('accepts each forward step', () => {
    const { svc } = make();
    expect(svc.isValidTransition('EXTRACTED', 'USER_CONFIRMED')).toBe(true);
    expect(svc.isValidTransition('USER_CONFIRMED', 'CONSULTANT_REVIEWED')).toBe(
      true,
    );
    expect(
      svc.isValidTransition('CONSULTANT_REVIEWED', 'CONSULTANT_APPROVED'),
    ).toBe(true);
    expect(
      svc.isValidTransition('CONSULTANT_APPROVED', 'EXECUTION_READY'),
    ).toBe(true);
    expect(svc.isValidTransition('EXECUTION_READY', 'EXECUTED')).toBe(true);
  });

  it('rejects backward + skip transitions', () => {
    const { svc } = make();
    expect(svc.isValidTransition('EXECUTED', 'EXTRACTED')).toBe(false);
    expect(svc.isValidTransition('CONSULTANT_APPROVED', 'USER_CONFIRMED')).toBe(
      false,
    );
    expect(svc.isValidTransition('EXTRACTED', 'CONSULTANT_APPROVED')).toBe(
      false,
    );
    expect(() => svc.assertValidTransition('EXECUTED', 'EXTRACTED')).toThrow(
      /invalid verification transition/,
    );
  });

  it('drives a field EXTRACTED -> CONSULTANT_APPROVED via the public methods', async () => {
    const { svc } = make();
    await svc.ensureFields(APP, [
      { fieldKey: 'passport_number', section: 'passport', value: 'X1' },
    ]);
    expect(
      (
        await svc.confirmField(
          APP,
          'passport_number',
          { id: 'u1', role: 'applicant' },
          'h',
        )
      ).state,
    ).toBe('USER_CONFIRMED');
    expect(
      (await svc.reviewField(APP, 'passport_number', 'c1', 'h')).state,
    ).toBe('CONSULTANT_REVIEWED');
    expect(
      (await svc.approveField(APP, 'passport_number', 'c1', 'h')).state,
    ).toBe('CONSULTANT_APPROVED');
  });

  it('rejects an out-of-order public call', async () => {
    const { svc } = make();
    await svc.ensureFields(APP, [
      { fieldKey: 'f', section: 'passport', value: 'v' },
    ]);
    // EXTRACTED -> review (CONSULTANT_REVIEWED) is not a valid single step
    await expect(svc.reviewField(APP, 'f', 'c1', 'h')).rejects.toThrow(
      /invalid verification transition/,
    );
  });
});

describe('VerificationService — drift detection (C, F)', () => {
  it('resets an approved field to EXTRACTED on value change + emits FIELD_EDITED', async () => {
    const { svc, auditRepo } = make();
    await svc.ensureFields(APP, [
      { fieldKey: 'passport_number', section: 'passport', value: 'X1' },
    ]);
    await approveFull(svc, 'passport_number');

    const reset = await svc.onValueChanged(APP, 'passport_number', 'NEW_HASH');
    expect(reset!.state).toBe('EXTRACTED');
    expect(reset!.value_hash).toBe('NEW_HASH');
    expect(reset!.consultant_approved_at).not.toBeNull(); // retained -> detectable as drift

    const drift = auditRepo.rows.find((e) => e.event_type === 'FIELD_EDITED');
    expect(drift).toBeDefined();
    expect(drift!.to_state).toBe('EXTRACTED');
  });

  it('is a no-op when the hash is unchanged', async () => {
    const { svc } = make();
    await svc.ensureFields(APP, [
      { fieldKey: 'f', section: 'passport', value: 'v' },
    ]);
    await svc.confirmField(APP, 'f', { id: 'u1', role: 'applicant' }, 'h');
    expect(await svc.onValueChanged(APP, 'f', 'h')).toBeNull();
  });
});

describe('VerificationService — section rollups (D)', () => {
  it('section state is the weakest field state', async () => {
    const { svc } = make();
    await svc.ensureFields(APP, [
      { fieldKey: 'pp_num', section: 'passport', value: 'a' },
      { fieldKey: 'pp_exp', section: 'passport', value: 'b' },
    ]);
    await approveFull(svc, 'pp_num');
    // pp_exp stays EXTRACTED -> section min = EXTRACTED
    const rollups = await svc.getSectionRollup(APP);
    const pp = rollups.find((r) => r.section === 'passport')!;
    expect(pp.section_state).toBe('EXTRACTED');
    expect(pp.field_count).toBe(2);

    await approveFull(svc, 'pp_exp');
    const pp2 = (await svc.getSectionRollup(APP)).find(
      (r) => r.section === 'passport',
    )!;
    expect(pp2.section_state).toBe('CONSULTANT_APPROVED');
  });
});

describe('VerificationService — execution readiness (E)', () => {
  it('is ready when all required sections approved, consultant present, no drift', async () => {
    const { svc } = make();
    await seedAllRequired(svc);
    for (const s of ALL_SECTIONS) await approveFull(svc, `${s}_field`);

    const r = await svc.evaluateExecutionReadiness(APP);
    expect(r.ready).toBe(true);
    expect(r.requiredSectionsApproved).toBe(true);
    expect(r.consultantApprovalPresent).toBe(true);
    expect(r.noDrift).toBe(true);
    expect(r.blockedSections).toEqual([]);
  });

  it('is blocked when a required section is not approved', async () => {
    const { svc } = make();
    await seedAllRequired(svc);
    for (const s of ALL_SECTIONS.filter((s) => s !== 'identity'))
      await approveFull(svc, `${s}_field`);

    const r = await svc.evaluateExecutionReadiness(APP);
    expect(r.ready).toBe(false);
    expect(r.blockedSections).toContain('identity');
  });

  it('is blocked by drift on a previously-approved field', async () => {
    const { svc } = make();
    await seedAllRequired(svc);
    for (const s of ALL_SECTIONS) await approveFull(svc, `${s}_field`);
    await svc.onValueChanged(APP, 'passport_field', 'NEW');

    const r = await svc.evaluateExecutionReadiness(APP);
    expect(r.ready).toBe(false);
    expect(r.noDrift).toBe(false);
    expect(r.driftedFields).toContain('passport_field');
    expect(r.blockedSections).toContain('passport');
  });
});

describe('VerificationService — audit emission (F)', () => {
  it('each transition emits its audit event and the chain stays intact', async () => {
    const { svc, auditRepo } = make();
    await svc.ensureFields(APP, [
      { fieldKey: 'f', section: 'passport', value: 'v' },
    ]);
    await approveFull(svc, 'f');

    expect(auditRepo.rows.map((e) => e.event_type)).toEqual([
      'USER_CONFIRMED',
      'CONSULTANT_REVIEWED',
      'CONSULTANT_APPROVED',
    ]);
    expect((await new AuditService(auditRepo).verifyChain(APP)).intact).toBe(
      true,
    );
  });
});
