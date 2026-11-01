import {
  familyDocumentGaps,
  familyGapRouteFor,
  isFamilyGapItem,
  type FamilyGapItem,
} from './family-gaps';
import { FAMILY_DOCUMENT_GAP_ROUTES } from '../../../strategies/document-requirements/family-document-gaps.config';

/**
 * Dry run 2026-10-15 (Canada visitor visa, Pakistani father): IRCC asks for
 * the spouse's and every child's date of birth. A civil document the client
 * has not uploaded must be REQUESTED on the checklist, not silently left out.
 */
const ROUTE = familyGapRouteFor('ca-visitor-visa-temporary-resident-visa')!;

const byKey = (items: FamilyGapItem[]) =>
  Object.fromEntries(items.map((i) => [i.key, i]));

describe('familyGapRouteFor', () => {
  it('covers the Canada visitor route by registry id prefix', () => {
    expect(ROUTE).not.toBeNull();
    expect(ROUTE.id).toBe('ca-visitor');
  });

  it('covers every route filing IRCC tr-rt: business visitor and super visa too', () => {
    expect(familyGapRouteFor('ca-business-visitors')?.id).toBe('ca-visitor');
    expect(familyGapRouteFor('ca-super-visa')?.id).toBe('ca-visitor');
  });

  it('covers no other route — the rule is configuration, not a default', () => {
    expect(familyGapRouteFor('gb-standard-visitor')).toBeNull();
    expect(familyGapRouteFor('ca-express-entry')).toBeNull();
    expect(familyGapRouteFor('ca-eta')).toBeNull();
    expect(familyGapRouteFor(null)).toBeNull();
    expect(familyGapRouteFor(undefined)).toBeNull();
  });

  it('reads the routes from configuration', () => {
    expect(
      familyGapRouteFor('xx-test-route', [
        { id: 'test', visaaiIdPrefixes: ['xx-test'], formSection: 'Form X' },
      ])?.id,
    ).toBe('test');
    expect(FAMILY_DOCUMENT_GAP_ROUTES.length).toBeGreaterThan(0);
  });
});

describe('familyDocumentGaps — children', () => {
  it('asks for a birth certificate for a child in `children` with no date of birth', () => {
    const items = familyDocumentGaps(
      {
        full_name: 'Muzaffar Ahmad',
        nationality: 'Pakistani',
        children: [{ name: 'Mian Muhammad Sajawal', relationship: 'son' }],
      },
      ROUTE,
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.document_type).toBe('birth_certificate');
    expect(item.label).toBe('Birth certificate — Mian Muhammad Sajawal');
    expect(item.required).toBe(true);
    expect(item.added_reason).toBe('family_gap:child_date_of_birth');
    expect(item.meta.kind).toBe('document');
    expect(item.meta.owner).toBe('applicant');
    expect(item.meta.family_gap).toMatchObject({
      key: item.key,
      person: 'Mian Muhammad Sajawal',
    });
    // Where to get it, in the issuing country.
    expect(item.meta.specs?.source).toMatch(/NADRA/);
    expect(item.meta.specs?.source).toMatch(/Union Council/);
    expect(item.meta.specs?.notes).toMatch(/IRCC/);
  });

  it('asks for children intake named under prefix keys (youngest_son_name)', () => {
    const items = familyDocumentGaps(
      {
        full_name: 'Muzaffar Ahmad',
        country_of_birth: 'Pakistan',
        youngest_son_name: 'Mian Muhammad Bilawal',
        eldest_daughter_name: 'Ayesha Muzaffar',
        eldest_daughter_date_of_birth: '1995-02-03',
      },
      ROUTE,
    );
    expect(items.map((i) => i.label)).toEqual([
      'Birth certificate — Mian Muhammad Bilawal',
    ]);
  });

  it('does not double-count a child named both in a prefix key and in `children`', () => {
    const items = familyDocumentGaps(
      {
        youngest_son_name: 'Mian Muhammad Bilawal',
        children: [{ name: 'MIAN MUHAMMAD BILAWAL' }],
      },
      ROUTE,
    );
    expect(items).toHaveLength(1);
  });

  it('a date of birth from either source satisfies the child', () => {
    expect(
      familyDocumentGaps(
        {
          youngest_son_name: 'Mian Muhammad Bilawal',
          children: [
            { name: 'Mian Muhammad Bilawal', date_of_birth: '1995-11-22' },
          ],
        },
        ROUTE,
      ),
    ).toEqual([]);
    expect(
      familyDocumentGaps(
        {
          children: [{ name: 'Mian Muhammad Bilawal' }],
          youngest_son_name: 'Mian Muhammad Bilawal',
          youngest_son_dob: '22-11-1995',
        },
        ROUTE,
      ),
    ).toEqual([]);
  });

  it('a year or an age alone is not a full date of birth', () => {
    const items = familyDocumentGaps(
      {
        children: [
          { name: 'Sajawal', date_of_birth: '1989' },
          { name: 'Bilawal', age: 29 },
        ],
      },
      ROUTE,
    );
    expect(items).toHaveLength(2);
  });

  it('ignores `children` when it is a count, not a list of people', () => {
    expect(familyDocumentGaps({ children: 2 }, ROUTE)).toEqual([]);
  });

  it('never treats grandson / person / sponsor keys as a child', () => {
    expect(
      familyDocumentGaps(
        {
          grandson_name: 'X',
          person_name: 'Y',
          contact_person_name: 'Z',
        },
        ROUTE,
      ),
    ).toEqual([]);
  });

  it('keys a child by name so the same child keeps the same item', () => {
    const a = familyDocumentGaps({ children: [{ name: 'Ali Khan' }] }, ROUTE);
    const b = familyDocumentGaps({ children: [{ name: 'ALI  KHAN' }] }, ROUTE);
    expect(a[0].key).toBe(b[0].key);
  });

  it('uses generic guidance when the issuing country is unknown', () => {
    const [item] = familyDocumentGaps(
      { children: [{ name: 'Ali Khan' }] },
      ROUTE,
    );
    expect(item.meta.specs?.source).toMatch(/civil registry/i);
    expect(item.meta.specs?.source).not.toMatch(/NADRA/);
  });

  it("prefers the child's own country of birth for the guidance", () => {
    const [item] = familyDocumentGaps(
      {
        nationality: 'Canadian',
        children: [{ name: 'Ali Khan', country_of_birth: 'Pakistan' }],
      },
      ROUTE,
    );
    expect(item.meta.specs?.source).toMatch(/NADRA/);
  });
});

describe('familyDocumentGaps — removed child (dry run 2026-10-16)', () => {
  it('does not ask for the birth certificate of a child the applicant removed', () => {
    const items = familyDocumentGaps(
      {
        full_name: 'Muzaffar Ahmad',
        nationality: 'Pakistani',
        youngest_son_name: 'Mian Talha',
        removed_children: ['Mian Talha'],
        children: [
          {
            name: 'Mian Muhammad Sajawal',
            relationship: 'son',
            date_of_birth: '1989-10-14',
          },
          { name: 'Mian Talha', relationship: 'son', birth_year: 2000 },
        ],
      },
      ROUTE,
    );
    expect(items.map((i) => i.label)).not.toContain(
      'Birth certificate — Mian Talha',
    );
  });
});

describe('familyDocumentGaps — spouse', () => {
  it("asks for the spouse's own ID card or passport when the spouse has no DOB", () => {
    const items = familyDocumentGaps(
      {
        full_name: 'Muzaffar Ahmad',
        nationality: 'Pakistan',
        marital_status: 'married',
        spouse_name: 'Sumera Ahmad',
        marriage_date: '1988-09-16',
      },
      ROUTE,
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.label).toBe('National ID card or passport — Sumera Ahmad');
    expect(item.document_type).toBe('spouse_national_id');
    expect(item.added_reason).toBe('family_gap:spouse_date_of_birth');
    // The spouse's own card, alone — not combined with the applicant's.
    expect(item.meta.specs?.notes).toMatch(/alone/i);
    expect(item.meta.specs?.notes).toMatch(/not .*combined|separate/i);
    expect(item.meta.specs?.source).toMatch(/NADRA/);
  });

  it('is satisfied by spouse_date_of_birth or a nested spouse record', () => {
    expect(
      familyDocumentGaps(
        {
          spouse_name: 'Sumera Ahmad',
          spouse_date_of_birth: '1968-10-09',
          marriage_date: '1988-09-16',
        },
        ROUTE,
      ),
    ).toEqual([]);
    expect(
      familyDocumentGaps(
        {
          spouse: { name: 'Sumera Ahmad', date_of_birth: '09.10.1968' },
          marriage_date: '1988-09-16',
        },
        ROUTE,
      ),
    ).toEqual([]);
  });

  it('asks nothing about a spouse for a single applicant', () => {
    expect(familyDocumentGaps({ marital_status: 'single' }, ROUTE)).toEqual([]);
  });
});

describe('familyDocumentGaps — marriage certificate', () => {
  it('asks for the nikah nama when a married applicant has no marriage date', () => {
    const items = byKey(
      familyDocumentGaps(
        {
          nationality: 'Pakistani',
          marital_status: 'married',
          spouse_name: 'Sumera Ahmad',
          spouse_date_of_birth: '1968-10-09',
        },
        ROUTE,
      ),
    );
    const item = items.marriage;
    expect(item).toBeDefined();
    expect(item.label).toBe('Marriage certificate (nikah nama)');
    expect(item.document_type).toBe('marriage_certificate');
    expect(item.added_reason).toBe('family_gap:marriage_date');
    expect(item.meta.needs_attention).toBeUndefined();
  });

  it('flags the certificate as needs-attention with the consistency message', () => {
    const message =
      "The marriage date (1999-09-16) is after Sajawal's date of birth (1989-10-14). Check the date on the marriage certificate; if it is correct, be ready to explain it.";
    const items = byKey(
      familyDocumentGaps(
        {
          nationality: 'Pakistani',
          spouse_name: 'Sumera Ahmad',
          spouse_date_of_birth: '1968-10-09',
          marriage_date: '1999-09-16',
          document_consistency_flags: [
            {
              code: 'marriage_after_child_birth',
              field: 'marriage_date',
              message,
            },
          ],
        },
        ROUTE,
      ),
    );
    const item = items.marriage;
    expect(item.added_reason).toBe('family_gap:marriage_flagged');
    expect(item.meta.needs_attention).toBe(true);
    expect(item.meta.attention_message).toBe(message);
  });

  it('uses the generic name outside Pakistan', () => {
    const items = byKey(
      familyDocumentGaps(
        { marital_status: 'married', spouse_name: 'Jane Roe' },
        ROUTE,
      ),
    );
    expect(items.marriage.label).toBe('Marriage certificate');
  });

  it('asks nothing when the marriage date is on file and unflagged', () => {
    expect(
      familyDocumentGaps(
        {
          spouse_name: 'Sumera Ahmad',
          spouse_date_of_birth: '1968-10-09',
          marriage_date: '16-9-1988',
        },
        ROUTE,
      ),
    ).toEqual([]);
  });
});

describe('isFamilyGapItem', () => {
  it('recognises rows by their added_reason', () => {
    expect(isFamilyGapItem({ added_reason: 'family_gap:marriage_date' })).toBe(
      true,
    );
    expect(isFamilyGapItem({ added_reason: 'base_requirement' })).toBe(false);
    expect(isFamilyGapItem({ added_reason: null })).toBe(false);
  });
});
