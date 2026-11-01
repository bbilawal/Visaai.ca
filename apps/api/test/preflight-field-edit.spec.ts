import type { PreflightCheckKey, PrefilledFormPayload } from '@visaai/types';
import { AuditService } from '../src/modules/audit/audit.service';
import { ProvenanceService } from '../src/modules/provenance/provenance.service';
import { VerificationService } from '../src/modules/verification/verification.service';
import { ConsultantApprovalService } from '../src/modules/consultant/consultant-approval.service';
import { PreflightService } from '../src/modules/preflight/preflight.service';
import { PreflightMappingService } from '../src/modules/preflight/preflight-mapping.service';
import { PreflightFieldEditService } from '../src/modules/preflight/preflight-field-edit.service';
import type {
  PrefillFormRecord,
  PrefillFormStore,
} from '../src/modules/preflight/prefill-form.store';
import type { SupabaseService } from '../src/modules/shared/supabase/supabase.service';
import type { PlanReviewPayoutService } from '../src/modules/payouts/plan-review-payout.service';
import type { IVerificationRepository } from '../src/modules/verification/verification.repository';
import { FakeAuditRepository } from './fakes/audit-repository.fake';
import { FakeProvenanceRepository } from './fakes/FakeProvenanceRepository';
import { FakePreflightRepository } from './fakes/FakePreflightRepository';
import { FakeConsultantRepository } from './fakes/FakeConsultantRepository';
import '../src/modules/automation/portal-fills/canada-ircc';

const APP = 'app-1';
const CONS = { id: 'cons-1', appRole: 'consultant' as const };
const OTHER = { id: 'cons-2', appRole: 'consultant' as const };
const ADMIN = { id: 'admin-1', appRole: 'admin' as const };

class MemoryFormStore {
  record: PrefillFormRecord | null;
  /** The interview profile the fake Supabase serves (shared object). */
  profile: Record<string, unknown> = {};
  async saveProfileValue(_app: string, key: string, value: string) {
    const previous = this.profile[key];
    this.profile[key] = value;
    return { previous };
  }
  constructor(payload: PrefilledFormPayload | null) {
    this.record = payload
      ? { id: 'gd-1', raw: JSON.stringify(payload), payload }
      : null;
  }
  async load(): Promise<PrefillFormRecord | null> {
    if (!this.record) return null;
    return {
      id: this.record.id,
      raw: this.record.raw,
      payload: JSON.parse(this.record.raw) as PrefilledFormPayload,
    };
  }
  async save(rec: PrefillFormRecord, payload: PrefilledFormPayload) {
    if (!this.record || this.record.raw !== rec.raw)
      throw new Error('conflict');
    const raw = JSON.stringify(payload);
    this.record = { id: rec.id, raw, payload };
  }
  /** Simulates the applicant saving from the Forms page. */
  applicantSets(key: string, value: string) {
    const p = JSON.parse(this.record!.raw) as PrefilledFormPayload;
    // As the server records it (prefill.service.ts): a changed value is the
    // applicant's.
    p.fields = p.fields.map((f) =>
      f.key === key ? { ...f, value, source: 'applicant' as const } : f,
    );
    this.record = { id: 'gd-1', raw: JSON.stringify(p), payload: p };
  }
}

function fakeSupabase(profile: Record<string, unknown>): SupabaseService {
  Object.assign(profile, {
    full_name: 'MUZAFFAR AHMAD',
    date_of_birth: '1961-06-15',
    passport_number: 'AK1182091',
    nationality: 'PAK',
    purpose_of_visit: 56,
  });
  const rows: Record<string, unknown> = {
    applications: { destination_country: 'CA' },
    application_profiles: { profile_json: profile },
  };
  const from = (t: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) c[m] = () => c;
    c.single = () => Promise.resolve({ data: rows[t] ?? null, error: null });
    return c;
  };
  return { admin: { from } } as unknown as SupabaseService;
}

const FORM: PrefilledFormPayload = {
  visaType: 'trv',
  countryCode: 'CA',
  generatedAt: '2026-10-01',
  fields: [
    {
      key: 'purpose_of_visit',
      label: 'Duration',
      value: '62',
      source: 'inferred',
    },
    {
      key: 'date_of_birth',
      label: 'Date of birth',
      value: '1961-06-15',
      source: 'document',
    },
    {
      key: 'occupation',
      label: 'Occupation',
      value: 'Retired',
      source: 'profile',
    },
  ],
} as PrefilledFormPayload;

const noDrift = {
  getStates: async () => [],
  getSectionRollup: async () => [],
} as unknown as IVerificationRepository;

async function make(form: PrefilledFormPayload | null = FORM) {
  const auditRepo = new FakeAuditRepository();
  const audit = new AuditService(auditRepo);
  const prov = new ProvenanceService(new FakeProvenanceRepository(), audit);
  const consRepo = new FakeConsultantRepository();
  const cons = new ConsultantApprovalService(consRepo, prov, audit, {
    creditExpertReview: () => Promise.resolve({ recorded: false }),
  } as unknown as PlanReviewPayoutService);
  const verif = new VerificationService(noDrift, audit);
  const store = new MemoryFormStore(form);
  const mappings = new PreflightMappingService(
    fakeSupabase(store.profile),
    store as unknown as PrefillFormStore,
    cons,
  );
  const preflight = new PreflightService(
    new FakePreflightRepository(),
    prov,
    verif,
    cons,
    audit,
    mappings,
  );
  const edits = new PreflightFieldEditService(
    preflight,
    mappings,
    store as unknown as PrefillFormStore,
    prov,
    cons,
    audit,
  );
  await cons.assign(APP, CONS.id);
  return { edits, preflight, mappings, store, prov, cons, auditRepo };
}

const ALL: PreflightCheckKey[] = [
  'passport_reviewed',
  'dates_reviewed',
  'travel_history_reviewed',
  'addresses_reviewed',
  'employment_reviewed',
  'final_approval',
];

describe('PreflightFieldEditService — consultant edits a mapped value', () => {
  it('persists to the saved form as source consultant and the mapping reflects it', async () => {
    const { edits, store } = await make();
    const out = await edits.editField(
      APP,
      CONS,
      'purpose_of_visit',
      '30',
      'applicant confirmed by phone',
    );
    const f = store.record!.payload.fields.find(
      (x) => x.key === 'purpose_of_visit',
    );
    expect(f).toMatchObject({ value: '30', source: 'consultant' });
    expect(
      out.mappings.find((m) => m.fieldKey === 'purpose_of_visit')?.mappedValue,
    ).toBe('30');
  });

  it('adds a mapped field the form lacks (with the portal label) so the edit wins over the profile', async () => {
    const { edits, store } = await make();
    const out = await edits.editField(APP, CONS, 'nationality', 'IND');
    expect(
      store.record!.payload.fields.find((x) => x.key === 'nationality'),
    ).toMatchObject({
      value: 'IND',
      source: 'consultant',
      label: 'Passport country code',
    });
    expect(
      out.mappings.find((m) => m.fieldKey === 'nationality')?.mappedValue,
    ).toBe('205'); // IND → IRCC country code
  });

  it('resets that category check and the final approval on the in-review review', async () => {
    const { edits, preflight } = await make();
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    const out = await edits.editField(APP, CONS, 'purpose_of_visit', '30');
    expect(out.review?.travel_history_reviewed).toBe(false);
    expect(out.review?.final_approval).toBe(false);
    expect(out.review?.passport_reviewed).toBe(true);
  });

  it('refuses to edit a mapped field while the review is locked', async () => {
    const { edits, preflight } = await make();
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    await preflight.complete(
      r.id,
      await (await make()).mappings.forApplication(APP),
      { id: CONS.id, role: 'consultant' },
      APP,
    );
    await expect(
      edits.editField(APP, CONS, 'purpose_of_visit', '30'),
    ).rejects.toThrow(/locked.*new review/i);
  });

  it('an edit after re-opening (new review) breaks the old lock', async () => {
    const { edits, preflight, mappings } = await make();
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    const locked = await mappings.forApplication(APP);
    await preflight.complete(
      r.id,
      locked,
      { id: CONS.id, role: 'consultant' },
      APP,
    );
    await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    await edits.editField(APP, CONS, 'purpose_of_visit', '30');
    const v = await preflight.validateLock(
      r.id,
      await mappings.forApplication(APP),
      APP,
    );
    expect(v.valid).toBe(false);
  });

  it('writes an audit record naming the consultant, the reason and the prior value hash', async () => {
    const { edits, auditRepo, prov } = await make();
    await edits.editField(APP, CONS, 'purpose_of_visit', '30', 'typo');
    const ev = auditRepo.rows
      .filter((e) => e.event_type === 'FIELD_EDITED')
      .pop()!;
    expect(ev.actor_id).toBe(CONS.id);
    expect(ev.actor_role).toBe('consultant');
    expect(ev.field_key).toBe('purpose_of_visit');
    expect(ev.payload).toMatchObject({
      action: 'consultant_edit',
      reason: 'typo',
      previous_value_hash: prov.valueHash('62'),
      form_updated: true,
    });
    expect(JSON.stringify(ev.payload)).not.toContain('"30"'); // hashes, not raw PII
  });
});

describe('PreflightFieldEditService — authorization', () => {
  it('refuses a consultant who is not the active assignee', async () => {
    const { edits, store } = await make();
    await expect(
      edits.editField(APP, OTHER, 'purpose_of_visit', '1'),
    ).rejects.toThrow(/not the active assignee/);
    expect(store.record!.payload.fields[0].value).toBe('62');
  });

  it('lets an admin edit', async () => {
    const { edits } = await make();
    await expect(
      edits.editField(APP, ADMIN, 'purpose_of_visit', '9'),
    ).resolves.toBeTruthy();
  });
});

describe('PreflightFieldEditService — extracted (OCR) fields', () => {
  it('corrects an OCR value as a new provenance version (user_entered) without touching the form when unmapped', async () => {
    const { edits, prov, store } = await make();
    await prov.createFieldProvenance({
      applicationId: APP,
      fieldKey: 'currency',
      origin: 'intake',
      value: 'V',
    });
    const before = store.record!.raw;
    await edits.editField(APP, CONS, 'currency', 'PKR', 'OCR misread');
    const cur = await prov.getCurrentFieldVersion(APP, 'currency');
    expect(cur?.value_snapshot).toBe('PKR');
    expect(cur?.origin).toBe('user_entered');
    expect(store.record!.raw).toBe(before);
  });

  it('a correction to an extracted field that is also a form field flows into the form', async () => {
    const { edits, prov, store } = await make();
    await prov.createFieldProvenance({
      applicationId: APP,
      fieldKey: 'date_of_birth',
      origin: 'intake',
      value: '2025-06-30',
    });
    await edits.editField(APP, CONS, 'date_of_birth', '1961-06-14');
    expect(
      (await prov.getCurrentFieldVersion(APP, 'date_of_birth'))?.value_snapshot,
    ).toBe('1961-06-14');
    expect(
      store.record!.payload.fields.find((f) => f.key === 'date_of_birth'),
    ).toMatchObject({
      value: '1961-06-14',
      source: 'consultant',
    });
  });

  it('a correction that matches the form only supersedes the OCR value (form untouched)', async () => {
    const { edits, prov, store } = await make();
    await prov.createFieldProvenance({
      applicationId: APP,
      fieldKey: 'date_of_birth',
      origin: 'intake',
      value: '2025-06-30',
    });
    const out = await edits.editField(APP, CONS, 'date_of_birth', '1961-06-15');
    expect(out).toMatchObject({ formUpdated: false, provenanceUpdated: true });
    expect(
      store.record!.payload.fields.find((f) => f.key === 'date_of_birth')
        ?.source,
    ).toBe('document');
  });

  it('allows correcting an unmapped extracted field even while locked (the lock does not cover it)', async () => {
    const { edits, preflight, mappings, prov } = await make();
    await prov.createFieldProvenance({
      applicationId: APP,
      fieldKey: 'job_title',
      origin: 'intake',
      value: 'HR Data Quality Coordinator',
    });
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    await preflight.complete(
      r.id,
      await mappings.forApplication(APP),
      { id: CONS.id, role: 'consultant' },
      APP,
    );
    await edits.editField(APP, CONS, 'job_title', 'Retired');
    expect(
      (
        await preflight.validateLock(
          r.id,
          await mappings.forApplication(APP),
          APP,
        )
      ).valid,
    ).toBe(true);
  });

  it('rejects an unknown field key', async () => {
    const { edits } = await make();
    await expect(
      edits.editField(APP, CONS, 'no_such_field', 'x'),
    ).rejects.toThrow(/unknown field/i);
  });

  it('with no saved form yet, corrects the interview profile — what auto-fill reads (live 2026-10-19)', async () => {
    const { edits, store, auditRepo } = await make(null);
    const out = await edits.editField(APP, CONS, 'purpose_of_visit', '9');
    expect(store.profile.purpose_of_visit).toBe('9');
    expect(
      out.mappings.find((m) => m.fieldKey === 'purpose_of_visit')?.mappedValue,
    ).toBe('9');
    const ev = auditRepo.rows
      .filter((e) => e.event_type === 'FIELD_EDITED')
      .pop()!;
    expect(ev.actor_id).toBe(CONS.id);
    expect(ev.payload).toMatchObject({ profile_updated: true, form_updated: false });
  });

  it('with no saved form, a declaration stays the applicant\'s to change', async () => {
    const { edits, store, mappings } = await make(null);
    const { mapping } = await mappings.resolve(APP);
    const decl = mapping?.find((f) => f.declaration);
    expect(decl).toBeDefined();
    await expect(
      edits.editField(APP, CONS, decl!.profileKey, 'No'),
    ).rejects.toThrow(/declaration/i);
    expect(store.profile[decl!.profileKey]).toBeUndefined();
  });

  it('with no saved form, a locked review still refuses the edit', async () => {
    const { edits, preflight } = await make(null);
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, { id: CONS.id, role: 'consultant' });
    await preflight.complete(
      r.id,
      await (await make(null)).mappings.forApplication(APP),
      { id: CONS.id, role: 'consultant' },
      APP,
    );
    expect((await preflight.getActive(APP))?.status).toBe('completed');
    await expect(edits.editField(APP, CONS, 'purpose_of_visit', '9')).rejects.toThrow(/locked.*new review/i);
  });
});

describe('applicant edit after lock (Fix 4)', () => {
  it('an applicant form edit to a mapped value breaks the consultant lock', async () => {
    const { preflight, mappings, store } = await make();
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    await preflight.complete(
      r.id,
      await mappings.forApplication(APP),
      { id: CONS.id, role: 'consultant' },
      APP,
    );
    expect(
      (
        await preflight.validateLock(
          r.id,
          await mappings.forApplication(APP),
          APP,
        )
      ).valid,
    ).toBe(true);
    store.applicantSets('purpose_of_visit', '70');
    const v = await preflight.validateLock(
      r.id,
      await mappings.forApplication(APP),
      APP,
    );
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('provenance_or_mapping_changed');
  });
});

/**
 * Review finding: correcting an UNMAPPED extracted field while locked made any
 * consultant approval bound to it stale, and a stale approval breaks the lock
 * (stale_approval) — the edit silently undid the lock it was allowed past.
 */
describe('PreflightFieldEditService — approved fields under a lock', () => {
  it('refuses to change an approved extracted field while the review is locked', async () => {
    const { edits, preflight, mappings, prov, cons } = await make();
    await prov.createFieldProvenance({
      applicationId: APP,
      fieldKey: 'job_title',
      origin: 'intake',
      value: 'Retired',
    });
    await cons.approveField(
      APP,
      CONS.id,
      'job_title',
      prov.valueHash('Retired'),
    );
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    await preflight.complete(
      r.id,
      await mappings.forApplication(APP),
      { id: CONS.id, role: 'consultant' },
      APP,
    );

    await expect(
      edits.editField(APP, CONS, 'job_title', 'Teacher'),
    ).rejects.toThrow(/approved.*locked|start a new review/i);
    expect(
      (await prov.getCurrentFieldVersion(APP, 'job_title'))?.value_snapshot,
    ).toBe('Retired');
    expect(
      (
        await preflight.validateLock(
          r.id,
          await mappings.forApplication(APP),
          APP,
        )
      ).valid,
    ).toBe(true);
  });
});

describe('applicant saves the form during an in-progress review', () => {
  it('un-ticks the category covering a changed auto-fill value', async () => {
    const { edits, preflight } = await make();
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    await edits.onApplicantFormSaved(APP, ['purpose_of_visit', 'occupation']);
    const now = await preflight.getActive(APP);
    expect(now?.travel_history_reviewed).toBe(false);
    expect(now?.final_approval).toBe(false);
    expect(now?.passport_reviewed).toBe(true);
  });

  it('does nothing when only non-auto-fill fields changed', async () => {
    const { edits, preflight } = await make();
    const r = await preflight.start(APP, { id: CONS.id, role: 'consultant' });
    for (const c of ALL)
      await preflight.recordCheck(r.id, c, true, APP, {
        id: CONS.id,
        role: 'consultant',
      });
    await edits.onApplicantFormSaved(APP, ['occupation']);
    expect((await preflight.getActive(APP))?.final_approval).toBe(true);
  });
});

describe('PreflightFieldEditService — values the portal receives in pieces', () => {
  it('refuses a date that cannot be split into IRCC year / month / day', async () => {
    const { edits } = await make();
    await expect(
      edits.editField(APP, CONS, 'date_of_birth', '15/06/1961'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a country IRCC has no code for', async () => {
    const { edits } = await make();
    await expect(
      edits.editField(APP, CONS, 'nationality', 'Atlantis'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a country by name as well as by ISO code', async () => {
    const { edits } = await make();
    const out = await edits.editField(APP, CONS, 'nationality', 'Pakistan');
    const nat = out.mappings.filter((m) => m.fieldKey === 'nationality');
    expect(nat.map((m) => m.mappedValue)).toEqual(['209', '209']);
  });

  it('accepts a whole ISO date and re-splits every piece', async () => {
    const { edits } = await make();
    const out = await edits.editField(APP, CONS, 'date_of_birth', '1961-07-04');
    const dob = out.mappings.filter((m) => m.fieldKey === 'date_of_birth');
    expect(dob.map((m) => m.mappedValue)).toEqual(['1961', '07', '4']);
  });
});
