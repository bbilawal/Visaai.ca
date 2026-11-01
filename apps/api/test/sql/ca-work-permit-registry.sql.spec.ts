/**
 * The work permit checklist v2 migrations (20261029120000 register,
 * 20261029120100 requirements, 20261029120200 promote, and the rollback)
 * replayed on real Postgres over the rows prod already holds
 * (20260821180003 extraction, 20260821190000 promotion, 20261015181000
 * IMM 5476 description, plus the eligibility source 20260821200000
 * registered), then read back exactly as the application reads them — active
 * rows only — and converted into the applicant's checklist.
 *
 * What prod serves today asks the spouse of a worker, on an open work permit,
 * for an LMIA and an employment contract, and lists no passport, photo,
 * family form or medical exam for anyone.
 */
import type { PGlite } from '@electric-sql/pglite';
import { migration, supabaseLikeDb } from './pglite-db';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from '../../src/modules/visa-rules/registry-to-framework';
import { profileToRuleFacts } from '../../src/modules/visa-rules/profile-to-rule-facts';

const IRCC =
  'https://www.canada.ca/en/immigration-refugees-citizenship/services';
const ORIGINAL_SOURCES: Array<[string, string]> = [
  ['landing', `${IRCC}/work-canada.html`],
  ['application', `${IRCC}/work-canada/permit-outside.html`],
  ['forms', `${IRCC}/application/application-forms-guides/imm1295.html`],
  ['fees', 'https://ircc.canada.ca/english/information/fees/fees.asp'],
  ['eligibility', `${IRCC}/work-canada/permit-outside/eligibility.html`],
];

/** The registry tables as 20260820120000 / 20260820160000 / 20260824220000 leave them, narrowed to what these migrations touch. */
const FIXTURE = `
  create table visa_countries (id uuid primary key default gen_random_uuid(), code text not null unique);
  create table visa_types (
    id uuid primary key default gen_random_uuid(),
    country_id uuid not null references visa_countries,
    visaai_id text not null unique,
    data_quality text not null default 'unverified',
    last_verified_at timestamptz);
  create table visa_sources (
    id uuid primary key default gen_random_uuid(),
    country_id uuid not null references visa_countries,
    visa_type_id uuid references visa_types,
    role text not null check (role in ('index', 'landing', 'eligibility', 'requirements',
      'documents', 'forms', 'fees', 'processing_times', 'application', 'policy', 'news')),
    authority text not null, authority_rank smallint not null default 1,
    canonical_url text not null, source_url text not null, title text,
    language text not null default 'en', robots_state text not null default 'unknown',
    redistribution text not null default 'unknown',
    check_interval interval not null default '1 day',
    freshness_sla interval not null default '30 days',
    active boolean not null default true);
  create unique index visa_sources_url_per_type_idx on visa_sources
    (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid));
  create table visa_source_versions (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null references visa_sources on delete cascade,
    version_number integer not null default 1,
    is_active boolean not null default false);
  create unique index visa_source_versions_one_active_idx
    on visa_source_versions (source_id) where is_active;
  create table visa_requirements (
    id uuid primary key default gen_random_uuid(),
    visa_type_id uuid not null references visa_types on delete cascade,
    requirement_code text not null check (requirement_code ~ '^[a-z0-9_]+$'),
    kind text not null check (kind in ('form', 'evidence', 'condition', 'fee', 'step', 'recommended')),
    officially_required boolean not null default true,
    constraint visa_requirements_recommended_not_official
      check (kind <> 'recommended' or officially_required = false),
    label text not null, description text,
    official_form_code text, official_form_url text,
    rule jsonb, parameters jsonb not null default '{}'::jsonb,
    source_version_id uuid not null references visa_source_versions on delete restrict,
    source_excerpt text check (char_length(source_excerpt) <= 4000),
    source_excerpt_display text,
    extraction_method text not null default 'manual',
    confidence numeric(3,2),
    status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
    display_order integer not null default 100,
    last_verified_at timestamptz);
  create unique index visa_requirements_identity_idx
    on visa_requirements (visa_type_id, requirement_code) where status <> 'retired';
`;

/** What the registry sync does for a newly registered source: give it an active version. */
const SYNC_NEW_SOURCES = `
  insert into visa_source_versions (source_id, is_active)
  select s.id, true from visa_sources s
  where not exists (select 1 from visa_source_versions v where v.source_id = s.id and v.is_active);
`;

async function prodBeforeV2(): Promise<PGlite> {
  const db = await supabaseLikeDb();
  await db.exec(FIXTURE);
  await db.exec(`
    insert into visa_countries (code) values ('CA');
    insert into visa_types (country_id, visaai_id)
      select id, 'ca-work-permit' from visa_countries where code = 'CA';
  `);
  for (const [role, url] of ORIGINAL_SOURCES) {
    await db.query(
      `insert into visa_sources (country_id, visa_type_id, role, authority, canonical_url, source_url)
       select c.id, t.id, $1, 'Immigration, Refugees and Citizenship Canada', $2, $2
         from visa_types t join visa_countries c on c.id = t.country_id
        where t.visaai_id = 'ca-work-permit'`,
      [role, url],
    );
  }
  await db.exec(SYNC_NEW_SOURCES);
  await db.exec(migration('20260821180003_req_ca_work_permit.sql'));
  await db.exec(migration('20260821190000_promote_ca_remaining.sql'));
  await db.exec(
    migration('20261015181000_imm5476_representative_guidance.sql'),
  );
  return db;
}

type Row = RegistryRequirement & { status?: string };

async function activeRows(db: PGlite): Promise<Row[]> {
  const r = await db.query<Row>(
    `select r.requirement_code, r.kind, r.officially_required, r.label, r.description,
            r.official_form_code, r.official_form_url, r.rule, r.display_order, r.parameters
       from visa_requirements r join visa_types t on t.id = r.visa_type_id
      where t.visaai_id = 'ca-work-permit' and r.status = 'active'
      order by r.requirement_code`,
  );
  return r.rows;
}

const NOW = new Date('2026-10-29T00:00:00Z');
/** The spouse of a worker in Canada, on an open work permit, living in Pakistan. */
const OPEN_SPOUSE = {
  applicant_citizenship: 'Pakistan',
  country_of_residence: 'Pakistan',
  date_of_birth: '1994-03-02',
  marital_status: 'Married',
  work_permit_type: 'open',
  principal_relationship: 'spouse of a worker',
  work_start_date: '2027-02-01',
  work_end_date: '2028-01-31',
  public_health_occupation: 'No',
  designated_country_six_months: 'Yes',
};
/** An LMIA job in Ontario. */
const LMIA_WORKER = {
  ...OPEN_SPOUSE,
  marital_status: 'Single',
  work_permit_type: 'lmia',
  principal_relationship: undefined,
  work_location_province: 'Ontario',
  lmia_number: '1234567',
};

function checklistFor(rows: RegistryRequirement[], profile: Record<string, unknown>) {
  const { framework, excluded } = convertRegistryToFramework(
    'ca-work-permit',
    rows,
    profileToRuleFacts(profile, NOW),
  );
  return {
    docs: framework.base_documents.map((d) => d.type),
    forms: framework.base_forms.map((f) => f.form_code),
    excluded,
  };
}

describe('ca-work-permit checklist v2 migrations (real Postgres)', () => {
  let db: PGlite;
  let before: Row[];

  beforeAll(async () => {
    db = await prodBeforeV2();
    before = await activeRows(db);
  });

  it('starts from what prod serves today: 14 rows, an LMIA for the open-permit spouse', () => {
    expect(before).toHaveLength(14);
    const c = checklistFor(before, OPEN_SPOUSE);
    expect(c.docs).toContain('lmia_and_employment_contract');
    expect(c.docs).not.toContain('passport_copy');
    expect(c.forms).not.toContain('IMM 5645');
  });

  it('refuses the requirements before the sync has versioned the new sources', async () => {
    await db.exec(
      migration('20261029120000_register_ca_work_permit_checklist_sources.sql'),
    );
    await expect(
      db.exec(migration('20261029120100_req_ca_work_permit_v2.sql')),
    ).rejects.toThrow();
    await db.exec('rollback');
  });

  it('after the sync, drafts the 21 new rows and only the two re-gated LMIA rows', async () => {
    await db.exec(SYNC_NEW_SOURCES);
    await db.exec(migration('20261029120100_req_ca_work_permit_v2.sql'));
    const drafts = await db.query<{ requirement_code: string }>(
      `select requirement_code from visa_requirements where status = 'draft'`,
    );
    const codes = drafts.rows.map((r) => r.requirement_code);
    expect(codes).toHaveLength(23);
    expect(codes).toEqual(
      expect.arrayContaining([
        'lmia_and_employment_contract',
        'lmia_or_offer_of_employment_number',
        'passport_copy',
        'imm5645',
        'proof_of_medical_exam',
      ]),
    );
    // imm5476 kept the description prod already had, so it was not demoted.
    expect(codes).not.toContain('imm5476');
    expect(codes).not.toContain('marriage_certificate_copy');
  });

  it('promotes: the open-permit spouse gets the family documents and no LMIA', async () => {
    await db.exec(migration('20261029120200_promote_ca_work_permit_v2.sql'));
    const rows = await activeRows(db);
    expect(rows).toHaveLength(35);
    const c = checklistFor(rows, OPEN_SPOUSE);
    expect(c.forms).toEqual(['IMM 1295', 'IMM 5645']);
    for (const t of [
      'passport_copy',
      'passport_photos',
      'marriage_certificate_copy',
      'proof_of_relationship_to_principal',
      'principal_work_permit_copy',
      'principal_occupation_letter',
      'proof_of_medical_exam',
    ]) {
      expect(c.docs).toContain(t);
    }
    expect(c.excluded).toEqual(
      expect.arrayContaining([
        'lmia_and_employment_contract',
        'lmia_or_offer_of_employment_number',
        'job_offer_letter',
        'current_employer_letter',
        'resume',
      ]),
    );
  });

  it('promotes: the LMIA worker gets the LMIA, job offer and employer documents', async () => {
    const c = checklistFor(await activeRows(db), LMIA_WORKER);
    for (const t of [
      'lmia_and_employment_contract',
      'lmia_or_offer_of_employment_number',
      'job_offer_letter',
      'current_employer_letter',
      'proof_of_job_requirements',
      'resume',
    ]) {
      expect(c.docs).toContain(t);
    }
    expect(c.excluded).toEqual(
      expect.arrayContaining([
        'quebec_acceptance_certificate',
        'employment_contract_lmia_exempt',
        'proof_of_relationship_to_principal',
        'open_work_permit_holder_fee',
        'marriage_certificate_copy',
      ]),
    );
  });

  it('kept the IMM 5476 description prod already had', async () => {
    const r = await db.query<{ description: string; status: string }>(
      `select description, status from visa_requirements
        where requirement_code = 'imm5476' and status <> 'retired'`,
    );
    expect(r.rows[0].status).toBe('active');
    expect(r.rows[0].description).toMatch(/^Required when anyone/);
  });

  it('rolls back to exactly the 14 rows prod serves today', async () => {
    await db.exec(
      migration('rollback/20261029120200_ca_work_permit_v2.down.sql'),
    );
    const rows = await activeRows(db);
    expect(rows).toEqual(before);
  });
});
