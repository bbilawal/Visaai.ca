import type { AuditEvent, PreflightMappingInput } from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  type ChainHead,
  type IAuditRepository,
  type NewAuditEventRow,
} from '../src/modules/audit/audit.repository';
import { WritePlanBuilder } from '../src/modules/portal-fill/write-plan.builder';
import type { PreflightService } from '../src/modules/preflight/preflight.service';
import type { ProvenanceService } from '../src/modules/provenance/provenance.service';

class FakeAuditRepository implements IAuditRepository {
  rows: AuditEvent[] = [];
  append = jest.fn();
  async getChainHead(): Promise<ChainHead | null> {
    return null;
  }
  async appendEvent(_r: NewAuditEventRow): Promise<AuditEvent> {
    throw new Error('append must not be called');
  }
  async getTrail(): Promise<AuditEvent[]> {
    return [];
  }
  async findByIdempotencyKey(): Promise<AuditEvent | null> {
    return null;
  }
}

const APP = 'app-1';
const RID = 'pf-1';
const MAPPINGS: PreflightMappingInput[] = [
  {
    fieldKey: 'dob',
    targetField: '#dob',
    mappedValue: '2031-03-14',
    category: 'dates',
  },
  {
    fieldKey: 'passport_number',
    targetField: '#pp',
    mappedValue: 'X1',
    category: 'passport',
  },
];

function make(
  opts: {
    review?: unknown;
    lockValid?: boolean;
    lockReasons?: string[];
  } = {},
) {
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo); // payloadHash is pure; append would throw
  const preflight = {
    getReview: jest.fn().mockResolvedValue(
      'review' in opts
        ? opts.review
        : {
            id: RID,
            application_id: APP,
            status: 'completed',
            locked_diff_hash: 'LOCK',
          },
    ),
    validateLock: jest.fn().mockResolvedValue({
      valid: opts.lockValid ?? true,
      reasons: opts.lockReasons ?? [],
    }),
  };
  const provenance = { valueHash: jest.fn((v: unknown) => `vh:${String(v)}`) };
  const svc = new WritePlanBuilder(
    preflight as unknown as PreflightService,
    provenance as unknown as ProvenanceService,
    audit,
  );
  return { svc, preflight, provenance, auditRepo };
}

describe('WritePlanBuilder (Phase 7D)', () => {
  it('builds a plan bound to the locked_diff_hash for valid mappings', async () => {
    const { svc, preflight } = make();
    const plan = await svc.build(APP, RID, MAPPINGS);
    expect(preflight.validateLock).toHaveBeenCalledWith(RID, MAPPINGS, APP);
    expect(plan.applicationId).toBe(APP);
    expect(plan.lockedDiffHash).toBe('LOCK');
    expect(plan.entries).toHaveLength(2);
    // in mapping order (here also alphabetical; see the ordering test)
    expect(plan.entries.map((e) => e.fieldKey)).toEqual([
      'dob',
      'passport_number',
    ]);
    const pp = plan.entries.find((e) => e.fieldKey === 'passport_number')!;
    expect(pp).toMatchObject({
      selector: '#pp',
      mappedValue: 'X1',
      expectedValueHash: 'vh:X1',
      category: 'passport',
    });
    expect(plan.planHash).toBeTruthy();
  });

  it('keeps the mapping order — a radio answer comes before the question it reveals', async () => {
    const { svc } = make();
    const ordered: PreflightMappingInput[] = [
      {
        fieldKey: 'has_national_id',
        targetField: '#hasNationality_radio-button-01-input',
        mappedValue: 'Yes',
        category: 'passport',
        page: '/national-id-doc',
        op: 'radio',
      },
      {
        fieldKey: 'national_id_number',
        targetField: '#docNumberNationalities_input',
        mappedValue: '3740553092097',
        category: 'passport',
        page: '/national-id-doc',
        reveal: true,
      },
      {
        fieldKey: 'ircc_child_1_row',
        targetField: 'main button[id*="add"]',
        mappedValue: 'Ali Khan',
        category: 'passport',
        page: '/family-info-children',
        op: 'dialog_open',
        reveal: true,
      },
      {
        fieldKey: 'ircc_child_1_family_name',
        targetField: '#lastName_input',
        mappedValue: 'Khan',
        category: 'passport',
        page: '/family-info-children',
        dialog: true,
      },
    ];
    const plan = await svc.build(APP, RID, ordered);
    expect(plan.entries.map((e) => e.fieldKey)).toEqual([
      'has_national_id',
      'national_id_number',
      'ircc_child_1_row',
      'ircc_child_1_family_name',
    ]);
    expect(plan.entries[0]).toMatchObject({ op: 'radio' });
    expect(plan.entries[1]).toMatchObject({ reveal: true });
    expect(plan.entries[1]).not.toHaveProperty('op');
    expect(plan.entries[3]).toMatchObject({ dialog: true });
  });

  it('expectedValueHash uses the provenance value-hash spine', async () => {
    const { svc, provenance } = make();
    const plan = await svc.build(APP, RID, MAPPINGS);
    expect(provenance.valueHash).toHaveBeenCalledWith('X1');
    expect(
      plan.entries.find((e) => e.fieldKey === 'dob')!.expectedValueHash,
    ).toBe('vh:2031-03-14');
  });

  it('planHash is deterministic for the same inputs', async () => {
    const a = await make().svc.build(APP, RID, MAPPINGS);
    const b = await make().svc.build(APP, RID, MAPPINGS);
    expect(a.planHash).toBe(b.planHash);
  });

  it('rejects when the lock is invalid (stale mappings / drift / revoked)', async () => {
    const { svc } = make({
      lockValid: false,
      lockReasons: ['provenance_or_mapping_changed', 'consultant_stale'],
    });
    await expect(svc.build(APP, RID, MAPPINGS)).rejects.toThrow(
      /provenance_or_mapping_changed/,
    );
  });

  it('rejects when the preflight review is not completed', async () => {
    const { svc } = make({
      review: {
        id: RID,
        application_id: APP,
        status: 'in_review',
        locked_diff_hash: null,
      },
    });
    await expect(svc.build(APP, RID, MAPPINGS)).rejects.toThrow(
      /completed, locked preflight/,
    );
  });

  it('rejects when the review belongs to a different application', async () => {
    const { svc } = make({
      review: {
        id: RID,
        application_id: 'other',
        status: 'completed',
        locked_diff_hash: 'LOCK',
      },
    });
    await expect(svc.build(APP, RID, MAPPINGS)).rejects.toThrow(
      /does not belong/,
    );
  });

  it('emits NO audit events (pure derivation, no execution authority)', async () => {
    const { svc, auditRepo } = make();
    await svc.build(APP, RID, MAPPINGS);
    expect(auditRepo.append).not.toHaveBeenCalled(); // and appendEvent would throw if reached
  });
});
