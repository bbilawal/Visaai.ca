import { makeFakeDb, type Row } from './__fixtures__/fake-db';
import {
  syncFamilyGapItems,
  syncFamilyGapsForApplication,
} from './family-gaps.sync';
import { familyGapRouteFor } from './family-gaps';

const ROUTE = familyGapRouteFor('ca-visitor-visa-temporary-resident-visa')!;
const APP = 'app-1';

const PROFILE = {
  full_name: 'Muzaffar Ahmad',
  nationality: 'Pakistani',
  marital_status: 'married',
  spouse_name: 'Sumera Ahmad',
  youngest_son_name: 'Mian Muhammad Bilawal',
  children: [{ name: 'Mian Muhammad Sajawal', relationship: 'son' }],
};

const gapRows = (rows: Row[]) =>
  rows.filter(
    (r) =>
      typeof r.added_reason === 'string' &&
      r.added_reason.startsWith('family_gap:'),
  );

describe('syncFamilyGapItems', () => {
  it('creates one missing item per gap, in checklist conventions', async () => {
    const db = makeFakeDb({ checklist_items: [], documents: [] });
    const res = await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: PROFILE,
      route: ROUTE,
    });
    const rows = gapRows(db.tables.checklist_items);
    expect(rows.map((r) => r.label).sort()).toEqual([
      'Birth certificate — Mian Muhammad Bilawal',
      'Birth certificate — Mian Muhammad Sajawal',
      'Marriage certificate (nikah nama)',
      'National ID card or passport — Sumera Ahmad',
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({
        application_id: APP,
        required: true,
        status: 'missing',
      });
      expect((r.meta as Row).kind).toBe('document');
      expect((r.meta as Row).owner).toBe('applicant');
    }
    expect(res.added).toHaveLength(4);
  });

  it('is idempotent — a second run with the same profile writes nothing', async () => {
    const db = makeFakeDb({ checklist_items: [], documents: [] });
    const args = { applicationId: APP, profile: PROFILE, route: ROUTE };
    await syncFamilyGapItems(db.client, args);
    const before = db.writes.length;
    const res = await syncFamilyGapItems(db.client, args);
    expect(db.writes.length).toBe(before);
    expect(res).toEqual({ added: [], updated: [], removed: [] });
    expect(gapRows(db.tables.checklist_items)).toHaveLength(4);
  });

  it('closes an unused item when the data arrives', async () => {
    const db = makeFakeDb({ checklist_items: [], documents: [] });
    await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: PROFILE,
      route: ROUTE,
    });
    const res = await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: {
        ...PROFILE,
        spouse_date_of_birth: '1968-10-09',
        marriage_date: '1988-09-16',
        youngest_son_date_of_birth: '1995-11-22',
      },
      route: ROUTE,
    });
    expect(res.removed).toHaveLength(3);
    expect(gapRows(db.tables.checklist_items).map((r) => r.label)).toEqual([
      'Birth certificate — Mian Muhammad Sajawal',
    ]);
  });

  it('never deletes an item a document is attached to; clears its attention instead', async () => {
    const db = makeFakeDb({ checklist_items: [], documents: [] });
    const flagged = {
      ...PROFILE,
      spouse_date_of_birth: '1968-10-09',
      children: [
        {
          name: 'Mian Muhammad Sajawal',
          relationship: 'son',
          date_of_birth: '1989-10-14',
        },
      ],
      youngest_son_date_of_birth: '1995-11-22',
      marriage_date: '1999-09-16',
      document_consistency_flags: [
        {
          code: 'marriage_after_child_birth',
          field: 'marriage_date',
          message: 'The marriage date (1999-09-16) is after a birth.',
        },
      ],
    };
    await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: flagged,
      route: ROUTE,
    });
    const [marriage] = gapRows(db.tables.checklist_items);
    expect(marriage.label).toBe('Marriage certificate (nikah nama)');
    expect((marriage.meta as Row).needs_attention).toBe(true);
    expect((marriage.meta as Row).attention_message).toMatch(/after a birth/);

    // The client re-uploads the nikah nama into the item.
    marriage.status = 'uploaded';
    db.tables.documents.push({
      id: 'doc-9',
      application_id: APP,
      checklist_item_id: marriage.id,
    });

    // The corrected read clears the flag.
    const { document_consistency_flags: _f, ...fixed } = flagged;
    const res = await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: { ...fixed, marriage_date: '1988-09-16' },
      route: ROUTE,
    });
    expect(res.removed).toEqual([]);
    const [kept] = gapRows(db.tables.checklist_items);
    expect(kept.id).toBe(marriage.id);
    expect(kept.status).toBe('uploaded');
    expect((kept.meta as Row).needs_attention).toBeUndefined();
    expect((kept.meta as Row).attention_message).toBeUndefined();
    expect(((kept.meta as Row).family_gap as Row).resolved).toBe(true);
  });

  it('updates the attention message in place when the flag changes', async () => {
    const db = makeFakeDb({ checklist_items: [], documents: [] });
    const base = {
      spouse_name: 'Sumera Ahmad',
      spouse_date_of_birth: '1968-10-09',
      marriage_date: '1999-09-16',
    };
    const flag = (message: string) => ({
      ...base,
      document_consistency_flags: [
        { code: 'marriage_after_child_birth', field: 'marriage_date', message },
      ],
    });
    await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: flag('first'),
      route: ROUTE,
    });
    const res = await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: flag('second'),
      route: ROUTE,
    });
    expect(res.updated).toHaveLength(1);
    const rows = gapRows(db.tables.checklist_items);
    expect(rows).toHaveLength(1);
    expect((rows[0].meta as Row).attention_message).toBe('second');
  });

  it('removes duplicate rows for the same gap left by a concurrent run', async () => {
    const db = makeFakeDb({ checklist_items: [], documents: [] });
    const args = { applicationId: APP, profile: PROFILE, route: ROUTE };
    await syncFamilyGapItems(db.client, args);
    const dup = { ...gapRows(db.tables.checklist_items)[0], id: 'dup-1' };
    db.tables.checklist_items.push(dup);
    await syncFamilyGapItems(db.client, args);
    expect(gapRows(db.tables.checklist_items)).toHaveLength(4);
  });

  it('removes unused gap items when the route no longer asks for them', async () => {
    const db = makeFakeDb({ checklist_items: [], documents: [] });
    await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: PROFILE,
      route: ROUTE,
    });
    await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: PROFILE,
      route: null,
    });
    expect(gapRows(db.tables.checklist_items)).toEqual([]);
  });

  it('never touches rows it does not own', async () => {
    const own = {
      id: 'base-1',
      application_id: APP,
      document_type: 'birth_certificate',
      label: 'Birth certificate',
      required: true,
      status: 'missing',
      added_reason: 'base_requirement',
      meta: { kind: 'document', owner: 'applicant' },
    };
    const db = makeFakeDb({ checklist_items: [own], documents: [] });
    await syncFamilyGapItems(db.client, {
      applicationId: APP,
      profile: PROFILE,
      route: null,
    });
    expect(db.tables.checklist_items).toEqual([own]);
  });
});

describe('syncFamilyGapsForApplication', () => {
  it('resolves the route from the application and reads the stored profile', async () => {
    const db = makeFakeDb({
      applications: [{ id: APP, visa_type_id: 'vt-1' }],
      visa_types: [
        { id: 'vt-1', visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
      ],
      application_profiles: [{ application_id: APP, profile_json: PROFILE }],
      checklist_items: [],
      documents: [],
    });
    await syncFamilyGapsForApplication(db.client, APP);
    expect(gapRows(db.tables.checklist_items)).toHaveLength(4);
  });

  it('adds nothing on a route the configuration does not list', async () => {
    const db = makeFakeDb({
      applications: [{ id: APP, visa_type_id: 'vt-2' }],
      visa_types: [{ id: 'vt-2', visaai_id: 'gb-standard-visitor' }],
      application_profiles: [{ application_id: APP, profile_json: PROFILE }],
      checklist_items: [],
      documents: [],
    });
    await syncFamilyGapsForApplication(db.client, APP);
    expect(gapRows(db.tables.checklist_items)).toEqual([]);
  });

  it('uses the profile it is given instead of reading one', async () => {
    const db = makeFakeDb({
      applications: [{ id: APP, visa_type_id: 'vt-1' }],
      visa_types: [
        { id: 'vt-1', visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
      ],
      checklist_items: [],
      documents: [],
    });
    await syncFamilyGapsForApplication(db.client, APP, {
      children: [{ name: 'Ali Khan' }],
    });
    expect(gapRows(db.tables.checklist_items).map((r) => r.label)).toEqual([
      'Birth certificate — Ali Khan',
    ]);
  });

  it('never throws — a checklist sync failure must not fail its caller', async () => {
    const client = {
      from: () => {
        throw new Error('db down');
      },
    } as never;
    await expect(syncFamilyGapsForApplication(client, APP)).resolves.toBeNull();
  });
});
