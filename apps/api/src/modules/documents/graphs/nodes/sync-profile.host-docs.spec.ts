import { makeSyncProfileNode } from './sync-profile';
import type { DocumentState } from '../document.state';
import { refineIdentityFields } from './classify-document';
import { PUNJAB_BIRTH_CERTS_TWO_CHILDREN } from '../../ocr/__fixtures__/civil-records.fixtures';
import { makeFakeDb, type Row } from '../../family-gaps/__fixtures__/fake-db';

/**
 * Prod 2026-10-16, Canada super visa, app 61f16bb5. The applicant is SUMERA
 * AHMAD (F, born 1968-10-09, passport AL1183581 given in intake); her hosts are
 * her twin sons in Canada. She uploaded, in this order: the host's passport to
 * "proof of the host's status", the sons' birth certificates to "proof you are
 * the host's parent", a son's T4 to "Option 1: host meets the full amount",
 * then her OWN passport as an "Additional document". The profile ended up
 * describing her son: full_name "MIAN MUHAMMAD", born 1989-10-14, Male, mother
 * SUMERA AHMAD.
 */

const APP = 'app-sv';

/** Every registry-built row says owner "applicant" — even the host's. */
const SLOTS: Row[] = [
  {
    id: 'slot-host-status',
    application_id: APP,
    document_type: 'proof_of_host_status',
    meta: { kind: 'document', owner: 'applicant' },
  },
  {
    id: 'slot-relationship',
    application_id: APP,
    document_type: 'proof_of_relationship',
    meta: { kind: 'document', owner: 'applicant' },
  },
  {
    id: 'slot-income',
    application_id: APP,
    document_type: 'income_proof_option_one',
    meta: { kind: 'document', owner: 'applicant' },
  },
];

const DOCS: Row[] = [
  {
    id: 'doc-host-passport',
    application_id: APP,
    checklist_item_id: 'slot-host-status',
  },
  {
    id: 'doc-birth-certs',
    application_id: APP,
    checklist_item_id: 'slot-relationship',
  },
  { id: 'doc-t4', application_id: APP, checklist_item_id: 'slot-income' },
  { id: 'doc-own-passport', application_id: APP, checklist_item_id: null },
];

/** What intake had collected before any upload. */
const INTAKE_PROFILE = {
  passport_number: 'AL1183581',
  nationality: 'PAK',
  marital_status: 'married',
  spouse_date_of_birth: '1961-06-15',
  representative_name: 'Mian Muhammad Bilawal',
  children: [
    {
      sex: 'Male',
      name: 'Unknown',
      relationship: 'son',
      in_home_country: false,
      country_of_residence: 'Canada',
    },
    {
      sex: 'Male',
      name: 'Unknown',
      relationship: 'son',
      in_home_country: false,
      country_of_residence: 'Canada',
    },
    {
      sex: 'Male',
      name: 'Mian Muhammad Bilawal',
      relationship: 'son',
      date_of_birth: '1989-10-14',
      in_home_country: false,
      country_of_residence: 'Canada',
    },
    {
      sex: 'Male',
      name: 'Mian Muhammad Sajawal',
      relationship: 'son',
      date_of_birth: '1989-10-14',
      in_home_country: false,
      country_of_residence: 'Canada',
    },
    {
      sex: 'Male',
      name: 'Mian Talha',
      birth_year: 2000,
      relationship: 'son',
      in_home_country: true,
      country_of_residence: 'Pakistan',
    },
  ],
};

const HOST_PASSPORT = {
  full_name: 'MIAN MUHAMMAD',
  date_of_birth: '1989-10-14',
  sex: 'M',
  nationality: 'CAN',
  passport_number: 'AB123456',
};

const OWN_PASSPORT = {
  full_name: 'SUMERA AHMAD',
  sex: 'F',
  date_of_birth: '1968-10-09',
  nationality: 'PAK',
  passport_number: 'AL1183581',
};

const T4 = { full_name: 'MIAN MUHAMMAD SAJAWAL', employer: 'MHI RJ Aviation' };

function db(profile: Record<string, unknown>) {
  return makeFakeDb({
    applications: [{ id: APP, visa_type_id: 'vt-sv' }],
    visa_types: [{ id: 'vt-sv', visaai_id: 'ca-super-visa' }],
    application_profiles: [{ application_id: APP, profile_json: profile }],
    checklist_items: SLOTS,
    documents: DOCS,
    field_provenance: [],
  });
}

function doc(
  documentId: string,
  documentType: string,
  extractedFields: Record<string, unknown>,
  rawOcrText = '',
): DocumentState {
  return {
    applicationId: APP,
    documentId,
    documentType,
    rawOcrText,
    extractedFields,
  } as unknown as DocumentState;
}

function birthCerts(): DocumentState {
  return doc(
    'doc-birth-certs',
    'birth_certificate',
    refineIdentityFields('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, {
      full_name: 'MIAN MUHAMMAD SAJAWAL',
      sex: 'Male',
      date_of_birth: '1989-10-14',
      father_name: 'MUZAFFAR AHMAD',
      mother_name: 'SUMERA AHMAD',
      place_of_birth: 'RAWALPINDI',
    }).fields,
    PUNJAB_BIRTH_CERTS_TWO_CHILDREN,
  );
}

const stored = (fake: ReturnType<typeof db>) =>
  fake.tables.application_profiles[0].profile_json as Record<string, unknown>;

describe('syncProfile — host and family documents never become the applicant (super visa)', () => {
  it('the upload order from prod leaves the applicant as herself', async () => {
    const fake = db(INTAKE_PROFILE);
    const sync = makeSyncProfileNode(fake.client);

    await sync(doc('doc-host-passport', 'proof_of_host_status', HOST_PASSPORT));
    await sync(birthCerts());
    await sync(doc('doc-t4', 'income_proof_option_one', T4));
    await sync(doc('doc-own-passport', 'passport', OWN_PASSPORT));

    const p = stored(fake);
    expect(p).toMatchObject({
      full_name: 'SUMERA AHMAD',
      date_of_birth: '1968-10-09',
      sex: 'F',
      nationality: 'PAK',
      passport_number: 'AL1183581',
    });
    // The sons' certificate never filled the applicant's own parents.
    expect(p.father_name ?? null).toBeNull();
    expect(p.mother_name ?? null).toBeNull();
    expect(p.place_of_birth ?? null).toBeNull();
    // The son's T4 is not the applicant's employment.
    expect(p.employer_name).toBeUndefined();
    // The host's passport went to the inviter fields instead.
    expect(p.inviter_name).toBe('MIAN MUHAMMAD');
    expect(p.inviter_status).toBe('Canadian citizen');
    // Two named sons in Canada and Talha — no "Unknown" duplicates.
    const kids = p.children as Array<Record<string, unknown>>;
    expect(kids.map((c) => c.name)).toEqual([
      'Mian Muhammad Bilawal',
      'Mian Muhammad Sajawal',
      'Mian Talha',
    ]);
  });

  it("the host's passport writes no applicant identity even when the profile has none yet", async () => {
    const fake = db({});
    await makeSyncProfileNode(fake.client)(
      doc('doc-host-passport', 'proof_of_host_status', HOST_PASSPORT),
    );
    const p = stored(fake);
    expect(p.full_name).toBeUndefined();
    expect(p.date_of_birth).toBeUndefined();
    expect(p.sex).toBeUndefined();
    expect(p.passport_number).toBeUndefined();
    expect(p.inviter_name).toBe('MIAN MUHAMMAD');
  });

  it("an un-slotted passport whose holder is one of the applicant's children is the child's", async () => {
    const fake = db(INTAKE_PROFILE);
    await makeSyncProfileNode(fake.client)(
      doc('doc-own-passport', 'passport', {
        full_name: 'MIAN MUHAMMAD SAJAWAL',
        date_of_birth: '1989-10-14',
        sex: 'M',
        passport_number: 'ZZ9999999',
      }),
    );
    const p = stored(fake);
    expect(p.full_name).toBeUndefined();
    expect(p.date_of_birth).toBeUndefined();
  });

  it("the applicant's own passport overrides identity values, even an earlier answer", async () => {
    const fake = db({
      ...INTAKE_PROFILE,
      full_name: 'MIAN MUHAMMAD',
      sex: 'Male',
      date_of_birth: '1989-10-14',
    });
    await makeSyncProfileNode(fake.client)(
      doc('doc-own-passport', 'passport', OWN_PASSPORT),
    );
    const p = stored(fake);
    expect(p).toMatchObject({
      full_name: 'SUMERA AHMAD',
      sex: 'F',
      date_of_birth: '1968-10-09',
    });
    const sources = p._document_sources as Record<
      string,
      Record<string, unknown>
    >;
    expect(sources.full_name).toMatchObject({
      document_id: 'doc-own-passport',
      replaced: 'MIAN MUHAMMAD',
    });
  });

  it("keeps the applicant's own spelling when the passport is the same person", async () => {
    const fake = db({
      ...INTAKE_PROFILE,
      full_name: 'Sumera Ahmad',
      date_of_birth: '09/10/1968',
      sex: 'Female',
    });
    await makeSyncProfileNode(fake.client)(
      doc('doc-own-passport', 'passport', OWN_PASSPORT),
    );
    const p = stored(fake);
    expect(p).toMatchObject({
      full_name: 'Sumera Ahmad',
      date_of_birth: '09/10/1968',
      sex: 'Female',
    });
  });
});

/**
 * Repair: the profile exactly as prod stored it. Re-reading the documents
 * (POST /documents/item/:id/reprocess) must put it right.
 */
describe('syncProfile — re-reading repairs the polluted prod profile', () => {
  const POLLUTED = {
    ...INTAKE_PROFILE,
    full_name: 'MIAN MUHAMMAD',
    date_of_birth: '1989-10-14',
    sex: 'Male',
    father_name: 'MUZAFFAR AHMAD',
    mother_name: 'SUMERA AHMAD',
    place_of_birth: 'RAWALPINDI',
    _document_sources: {
      sex: {
        value: 'Male',
        document_id: 'doc-birth-certs',
        document_type: 'birth_certificate',
      },
      father_name: {
        value: 'MUZAFFAR AHMAD',
        document_id: 'doc-birth-certs',
        document_type: 'birth_certificate',
      },
      mother_name: {
        value: 'SUMERA AHMAD',
        document_id: 'doc-birth-certs',
        document_type: 'birth_certificate',
      },
      place_of_birth: {
        value: 'RAWALPINDI',
        document_id: 'doc-birth-certs',
        document_type: 'birth_certificate',
      },
    },
  };

  it("re-reading only the applicant's own passport fixes identity, parents and children", async () => {
    const fake = db(POLLUTED);
    await makeSyncProfileNode(fake.client)(
      doc('doc-own-passport', 'passport', OWN_PASSPORT),
    );
    const p = stored(fake);
    expect(p).toMatchObject({
      full_name: 'SUMERA AHMAD',
      date_of_birth: '1968-10-09',
      sex: 'F',
      father_name: null,
      mother_name: null,
      place_of_birth: null,
    });
    const sources = p._document_sources as Record<string, unknown>;
    expect(Object.keys(sources).sort()).toEqual([
      'date_of_birth',
      'full_name',
      'sex',
    ]);
    expect((p.children as unknown[]).length).toBe(3);
  });

  it("re-reading the host's passport retracts the name and DOB it wrote before provenance existed", async () => {
    const fake = db(POLLUTED);
    await makeSyncProfileNode(fake.client)(
      doc('doc-host-passport', 'proof_of_host_status', HOST_PASSPORT),
    );
    const p = stored(fake);
    expect(p.full_name).toBeNull();
    expect(p.date_of_birth).toBeNull();
    expect(p.passport_number).toBe('AL1183581');
  });

  it("re-reading the sons' certificate retracts what it wrote as the applicant's", async () => {
    const fake = db(POLLUTED);
    await makeSyncProfileNode(fake.client)(birthCerts());
    const p = stored(fake);
    expect(p.father_name).toBeNull();
    expect(p.mother_name).toBeNull();
    expect(p.place_of_birth).toBeNull();
    expect(p.sex).toBeNull();
  });
});
