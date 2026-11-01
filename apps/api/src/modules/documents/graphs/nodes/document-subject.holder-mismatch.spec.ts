import type { ExtractedFields } from '../document.state';
import { holderMismatch, type DocumentSlot } from './document-subject';

/**
 * Live E2E 2026-10-20: another person's passport, birth certificate and police
 * certificate went into the applicant's own slots and each showed
 * "Identity ✓ Pass" with nothing said. All names here are invented.
 */
const slot = (
  slotType: string | null,
  owner: string | null = 'applicant',
  familyGap = false,
): DocumentSlot => ({ slotType, owner, familyGap });

const profile = {
  full_name: 'TESTER, ALPHA BRAVO',
  passport_number: 'ZZ1234567',
  sponsor_name: 'Charlie Delta Tester',
};

describe('holderMismatch', () => {
  it("warns on someone else's passport in the applicant's passport slot", () => {
    const m = holderMismatch({
      profile,
      extracted: {
        full_name: 'FOXTROT GOLF HOTEL',
        passport_number: 'XY9876543',
        date_of_birth: '1990-01-01',
      },
      documentType: 'passport',
      slot: slot('passport'),
    });
    expect(m).toMatchObject({
      holder: 'FOXTROT GOLF HOTEL',
      applicant: 'TESTER, ALPHA BRAVO',
      message: expect.stringContaining('FOXTROT GOLF HOTEL'),
      // Names share nothing and the number differs, but the profile has no
      // DOB: held for confirmation, never retracted on that alone.
      clearlyOther: false,
      needsConfirmation: true,
    });
  });

  it('a holder sharing a name part is clearly someone else only when the number AND the date of birth differ', () => {
    const named = { ...profile, full_name: 'Ali Bravo Tester' };
    const base = {
      full_name: 'ALI FOXTROT GOLF',
      passport_number: 'XY9876543',
      date_of_birth: '1985-07-08',
    };
    const check = (p: Record<string, unknown>, e = base) =>
      holderMismatch({
        profile: p,
        extracted: e,
        documentType: 'passport',
        slot: slot('passport'),
      });
    expect(check({ ...named, date_of_birth: '1990-02-03' })).toMatchObject({
      clearlyOther: true,
    });
    // No number on the profile: not clearly anyone's.
    expect(
      check({ full_name: named.full_name, date_of_birth: '1990-02-03' }),
    ).toMatchObject({ clearlyOther: false });
    // No date of birth on the document.
    expect(
      check(
        { ...named, date_of_birth: '1990-02-03' },
        { ...base, date_of_birth: '' },
      ),
    ).toMatchObject({ clearlyOther: false });
  });

  it("does not warn when the date of birth is the applicant's", () => {
    expect(
      holderMismatch({
        profile: { ...profile, date_of_birth: '1990-02-03' },
        extracted: {
          full_name: 'Completely Different Reading',
          passport_number: 'XY9876543',
          date_of_birth: '03/02/1990',
        },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it.each([
    ['MUHAMMAD ALI', 'Mohammed Aly'],
    ['Mohd Ali', 'MUHAMMAD ALI'],
    ['SYED ALI', 'Sayed Aly'],
    ['Mohamed Sayyid', 'Muhammad Syed'],
  ])(
    'does not warn on a transliteration variant (%s vs %s)',
    (applicant, printed) => {
      expect(
        holderMismatch({
          profile: { full_name: applicant },
          extracted: { full_name: printed },
          documentType: 'passport',
          slot: slot('passport'),
        }),
      ).toBeNull();
    },
  );

  it('does not warn on a married vs maiden surname (a shared given name)', () => {
    expect(
      holderMismatch({
        profile: { full_name: 'Juliet Tester' },
        extracted: { full_name: 'JULIET MAIDENNAME' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it('does not warn on an intake typo of two letters (a shared part)', () => {
    expect(
      holderMismatch({
        profile: { full_name: 'Alfa Bravoo Tester' },
        extracted: { full_name: 'ALPHA BRAVO TESTER' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it.each([
    { name: 'alpha.t' },
    { applicant_name: 'alpha@example.com' },
    { full_name: 'user123' },
  ])('does not compare against a username-like applicant name (%o)', (p) => {
    expect(
      holderMismatch({
        profile: p,
        extracted: { full_name: 'Foxtrot Golf Hotel' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it('skips a username-like name for a real one further down', () => {
    expect(
      holderMismatch({
        profile: {
          name: 'alpha.t',
          given_name: 'Alpha',
          family_name: 'Tester',
        },
        extracted: { full_name: 'Foxtrot Golf Hotel' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toMatchObject({ applicant: 'Alpha Tester' });
  });

  it('warns on an "Additional document" upload (no slot)', () => {
    expect(
      holderMismatch({
        profile,
        extracted: { full_name: 'Foxtrot Golf Hotel' },
        documentType: 'passport',
        slot: null,
      }),
    ).toMatchObject({ holder: 'Foxtrot Golf Hotel' });
  });

  it("current behaviour: a one-word father's name matching the applicant's surname reads as the applicant's child", () => {
    // isSamePerson('Tester', 'Kilo Tester') is true (subset match), so any
    // birth certificate whose father is printed by surname alone is taken for
    // the applicant's child's and never warned on. Documented, not changed.
    const p = { full_name: 'Kilo Tester' };
    expect(
      holderMismatch({
        profile: p,
        extracted: { full_name: 'Lima Mike', father_name: 'Tester' },
        documentType: 'birth_certificate',
        slot: slot('birth_certificate'),
      }),
    ).toBeNull();
    // The applicant's own certificate, father by surname only: no warning.
    expect(
      holderMismatch({
        profile: p,
        extracted: { full_name: 'KILO TESTER', father_name: 'Tester' },
        documentType: 'birth_certificate',
        slot: slot('birth_certificate'),
      }),
    ).toBeNull();
  });

  it.each([
    ['birth_certificate', 'birth_certificate'],
    ['police_clearance', 'police_certificate'],
    ['national_id', 'national_id'],
  ])('warns on a %s naming a stranger', (documentType, slotType) => {
    expect(
      holderMismatch({
        profile,
        extracted: { full_name: 'Foxtrot Golf Hotel' },
        documentType,
        slot: slot(slotType),
      }),
    ).toMatchObject({ holder: 'Foxtrot Golf Hotel' });
  });

  it('does not warn when the same person is printed in another order', () => {
    expect(
      holderMismatch({
        profile,
        extracted: { full_name: 'Alpha Bravo Tester' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it('does not warn on given + family name split across fields', () => {
    expect(
      holderMismatch({
        profile,
        extracted: { given_name: 'BRAVO', family_name: 'TESTER ALPHA' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it("does not warn when the document number is the applicant's", () => {
    expect(
      holderMismatch({
        profile,
        extracted: {
          full_name: 'SOMEONE MISREAD ENTIRELY',
          passport_number: 'zz 123 4567',
        },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it.each([
    slot('sponsor_passport'),
    slot('proof_of_host_status'),
    slot('passport', 'sponsor'),
    slot('national_id', 'applicant', true),
    slot('proof_of_relationship'),
  ])('does not warn in a third-party or relationship slot (%o)', (s) => {
    expect(
      holderMismatch({
        profile,
        extracted: { full_name: 'Foxtrot Golf Hotel' },
        documentType: 'passport',
        slot: s,
      }),
    ).toBeNull();
  });

  it('does not warn when the holder is someone the profile names', () => {
    expect(
      holderMismatch({
        profile: {
          ...profile,
          children: [{ name: 'Echo Tester', relationship: 'son' }],
        },
        extracted: { full_name: 'ECHO TESTER' },
        documentType: 'birth_certificate',
        slot: slot('birth_certificate'),
      }),
    ).toBeNull();
  });

  it('does not warn on a birth certificate naming the applicant as a parent', () => {
    expect(
      holderMismatch({
        profile,
        extracted: {
          full_name: 'Juliet Tester',
          father_name: 'Alpha Bravo Tester',
        },
        documentType: 'birth_certificate',
        slot: slot('birth_certificate'),
      }),
    ).toBeNull();
  });

  it('does not warn when no name was read', () => {
    expect(
      holderMismatch({
        profile,
        extracted: { passport_number: 'XY9876543' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it('does not warn on a card whose holder could not be read', () => {
    expect(
      holderMismatch({
        profile,
        // classify_document marks it so (a flag, not a printed field).
        extracted: {
          full_name: 'Landlord Name',
          holder_unknown: true,
        } as unknown as ExtractedFields,
        documentType: 'national_id',
        slot: slot('national_id'),
      }),
    ).toBeNull();
  });

  it("does not warn when the applicant's name is not known yet", () => {
    expect(
      holderMismatch({
        profile: { passport_number: 'ZZ1234567' },
        extracted: { full_name: 'Foxtrot Golf Hotel' },
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
  });

  it('does not warn on documents that may name others (bank statement)', () => {
    expect(
      holderMismatch({
        profile,
        extracted: { full_name: 'Foxtrot Golf Hotel' },
        documentType: 'bank_statement',
        slot: slot('bank_statement'),
      }),
    ).toBeNull();
  });

  describe('marriage certificate', () => {
    it('does not warn when the applicant is the groom', () => {
      expect(
        holderMismatch({
          profile,
          extracted: {
            bridegroom_name: 'Alpha Bravo Tester',
            bride_name: 'India Kilo',
          },
          documentType: 'marriage_certificate',
          slot: slot('marriage_certificate'),
        }),
      ).toBeNull();
    });

    it('does not warn when the sponsor is a party (maiden name for the applicant)', () => {
      expect(
        holderMismatch({
          profile,
          extracted: {
            bridegroom_name: 'Charlie Delta Tester',
            bride_name: 'Alpha Maiden',
          },
          documentType: 'nikah_nama',
          slot: slot('marriage_certificate'),
        }),
      ).toBeNull();
    });

    it('warns when neither party is the applicant or the spouse', () => {
      expect(
        holderMismatch({
          profile,
          extracted: {
            bridegroom_name: 'Lima Mike',
            bride_name: 'November Oscar',
          },
          documentType: 'marriage_certificate',
          slot: slot('marriage_certificate'),
        }),
      ).toMatchObject({ holder: 'Lima Mike & November Oscar' });
    });

    it('does not warn when no party was read', () => {
      expect(
        holderMismatch({
          profile,
          extracted: { marriage_date: '2010-05-05' },
          documentType: 'marriage_certificate',
          slot: slot('marriage_certificate'),
        }),
      ).toBeNull();
    });
  });
});

/**
 * Prod data written before this check: a stranger's passport may already have
 * filled passport_number / date_of_birth, and would "match itself" on re-read.
 */
describe('holderMismatch — evidence this document wrote itself', () => {
  const src = (value: unknown) => ({
    document_id: 'doc-9',
    document_type: 'passport',
    value,
  });
  const stranger = {
    full_name: 'FOXTROT GOLF HOTEL',
    passport_number: 'XY9876543',
    national_id_number: '2222222222',
    date_of_birth: '1985-07-08',
  };
  const check = (p: Record<string, unknown>, e: ExtractedFields = stranger) =>
    holderMismatch({
      profile: p,
      extracted: e,
      documentType: 'passport',
      slot: slot('passport'),
      documentId: 'doc-9',
    });

  it("a stranger's passport no longer matches the number and DOB it wrote itself", () => {
    const p = {
      full_name: 'TESTER, ALPHA BRAVO',
      passport_number: 'XY9876543',
      date_of_birth: '1985-07-08',
      _document_sources: {
        passport_number: src('XY9876543'),
        date_of_birth: src('1985-07-08'),
      },
    };
    // Without the document id it matches itself — the defect.
    expect(
      holderMismatch({
        profile: p,
        extracted: stranger,
        documentType: 'passport',
        slot: slot('passport'),
      }),
    ).toBeNull();
    // With it: warned. Only the stated name differs (the number and DOB
    // were its own), so it is held for confirmation, not retracted.
    expect(check(p)).toMatchObject({
      holder: 'FOXTROT GOLF HOTEL',
      clearlyOther: false,
      needsConfirmation: true,
    });
  });

  it('is clearly foreign against the sources that remain', () => {
    expect(
      check({
        full_name: 'TESTER, ALPHA BRAVO',
        national_id_number: '1111111111',
        date_of_birth: '1990-02-03',
        passport_number: 'XY9876543',
        _document_sources: { passport_number: src('XY9876543') },
      }),
    ).toMatchObject({ clearlyOther: true });
  });

  it("a re-read of the applicant's OWN passport (number and DOB only from itself) is never clearly foreign", () => {
    const own = {
      full_name: 'ALI ZULU YANKEE',
      passport_number: 'ZZ1234567',
      date_of_birth: '1990-02-03',
    };
    const p = {
      // Intake gave a name that reads differently from the passport.
      full_name: 'Ali Tester',
      passport_number: 'ZZ1234567',
      date_of_birth: '1990-02-03',
      _document_sources: {
        passport_number: src('ZZ1234567'),
        date_of_birth: src('1990-02-03'),
      },
    };
    expect(check(p, own)).toMatchObject({ clearlyOther: false });
    // Same passport, the name agrees: no note at all.
    expect(check(p, { ...own, full_name: 'ALI TESTER' })).toBeNull();
  });

  it('the applicant name this document wrote is not the reference either', () => {
    expect(
      check({
        full_name: 'FOXTROT GOLF HOTEL',
        passport_number: 'XY9876543',
        _document_sources: {
          full_name: src('FOXTROT GOLF HOTEL'),
          passport_number: src('XY9876543'),
        },
      }),
    ).toBeNull(); // no other name on file: nothing to compare against
  });

  it('a value the applicant changed since is their own evidence again', () => {
    expect(
      check({
        full_name: 'TESTER, ALPHA BRAVO',
        passport_number: 'ZZ1234567',
        date_of_birth: '1990-02-03',
        _document_sources: { passport_number: src('XY9876543') },
      }),
    ).toMatchObject({ clearlyOther: true });
  });
});

/**
 * Live 2026-10-29: the applicant gave their passport name in intake, then a
 * relative's passport went into the passport slot. It showed "Identity ✓
 * Pass" with no note, and its holder became the applicant on the profile and
 * the Forms. Two faults: the holder shared the ubiquitous "Muhammad" with the
 * applicant's father, so it read as "someone the profile names"; and a
 * holder whose name shares nothing with the applicant's was only ever warned
 * about, never kept off the profile. All names here are invented.
 */
describe('holderMismatch — a passport naming nobody like the applicant', () => {
  const passport = (full_name: string, extra: Record<string, unknown> = {}) =>
    ({ full_name, passport_number: 'XY9876543', ...extra }) as ExtractedFields;
  const check = (p: Record<string, unknown>, e: ExtractedFields) =>
    holderMismatch({
      profile: p,
      extracted: e,
      documentType: 'passport_copy',
      slot: slot('passport_copy'),
    });

  it('holds for confirmation (never retracts) when only the stated name differs', () => {
    expect(
      check(
        { given_name: 'Kilo Lima', family_name: 'Tester' },
        passport('MIKE NOVEMBER OSCAR', { date_of_birth: '1989-10-16' }),
      ),
    ).toMatchObject({
      holder: 'MIKE NOVEMBER OSCAR',
      clearlyOther: false,
      needsConfirmation: true,
    });
  });

  it('is clearly someone else when the stated name shares nothing AND an independent DOB differs', () => {
    expect(
      check(
        {
          given_name: 'Kilo Lima',
          family_name: 'Tester',
          date_of_birth: '1975-03-04',
        },
        passport('MIKE NOVEMBER OSCAR', { date_of_birth: '1989-10-16' }),
      ),
    ).toMatchObject({ clearlyOther: true });
  });

  it.each([
    [
      'transliterated given name, spelled surname',
      { full_name: 'Mohammad Yusuf Chaudhry', passport_number: 'ZZ1234567' },
      'MUHAMMAD YOUSEF CHAUDHARY',
    ],
    [
      'renewal: old passport number, transliterated name',
      { full_name: 'Muhammad Yusuf', passport_number: 'XY9999999' },
      'MOHAMMAD YOUSAF',
    ],
    [
      'married surname and a spelling variant',
      { full_name: 'Aisha Siddiqui', passport_number: 'ZZ1234567' },
      'AYESHA KHAN',
    ],
    [
      'nickname given in intake',
      { full_name: 'Zee', passport_number: 'ZZ1234567' },
      'ZEESHAN AHMED',
    ],
  ])('never clearly someone else: %s', (_c, p, printed) => {
    const r = check(p, passport(printed, { date_of_birth: '1989-10-16' }));
    expect(r?.clearlyOther ?? false).toBe(false);
    expect(r?.needsConfirmation ?? false).toBe(false);
  });

  it("a re-read of the applicant's OWN passport whose DOB and number came only from itself is held, never retracted", () => {
    const src = (value: unknown) => ({
      document_id: 'doc-own',
      document_type: 'passport',
      value,
    });
    const r = holderMismatch({
      profile: {
        // A name the applicant typed that shares nothing with the passport.
        full_name: 'Kilo Tester',
        passport_number: 'XY9876543',
        date_of_birth: '1989-10-16',
        _document_sources: {
          passport_number: src('XY9876543'),
          date_of_birth: src('1989-10-16'),
        },
      },
      extracted: passport('MIKE NOVEMBER OSCAR', {
        date_of_birth: '1989-10-16',
      }),
      documentType: 'passport',
      slot: slot('passport'),
      documentId: 'doc-own',
    });
    expect(r).toMatchObject({ clearlyOther: false, needsConfirmation: true });
  });

  it("a common name part shared with the applicant's father does not make the holder 'known'", () => {
    expect(
      check(
        {
          full_name: 'QX ROMEO SIERRA',
          _document_sources: {
            full_name: {
              document_id: 'doc-income',
              document_type: 'self_employment_income_records',
              value: 'QX ROMEO SIERRA',
            },
          },
          passport_number: 'ZZ1234567',
          parents: [{ name: 'Muhammad Romeo Tango', relationship: 'father' }],
        },
        passport('MIAN MUHAMMAD UNIFORM', { date_of_birth: '1989-10-16' }),
      ),
    ).toMatchObject({
      holder: 'MIAN MUHAMMAD UNIFORM',
      // The number differs and the names share nothing, but no DOB to say
      // whose it is: held for confirmation, never retracted.
      clearlyOther: false,
      needsConfirmation: true,
    });
  });

  it.each([
    ['order differs', 'Kilo Lima Tester', 'TESTER KILO LIMA'],
    ['extra middle name on the passport', 'Kilo Tester', 'KILO LIMA TESTER'],
    ['transliteration', 'Mohammed Kilo Tester', 'MUHAMMAD KILO TESTER'],
    ['one-letter spelling', 'Zeeshan Tester', 'ZESHAN TESTOR'],
    ['given names only partly kept', 'Kilo Victor', 'KILO WHISKEY'],
  ])('never flags the applicant’s own passport (%s)', (_c, stated, printed) => {
    expect(
      check(
        { full_name: stated, passport_number: 'ZZ1234567' },
        passport(printed),
      ),
    ).toBeNull();
  });

  it('only warns when the names share a short part (could be the same person)', () => {
    expect(
      check(
        { full_name: 'Ali Kilo', passport_number: 'ZZ1234567' },
        passport('ALI WHISKEY'),
      ),
    ).toMatchObject({ clearlyOther: false });
  });

  it('only warns when the applicant name came from another document and no number is on the profile', () => {
    expect(
      check(
        {
          full_name: 'QX ROMEO SIERRA',
          _document_sources: {
            full_name: {
              document_id: 'doc-income',
              document_type: 'bank_statement',
              value: 'QX ROMEO SIERRA',
            },
          },
        },
        passport('MIKE NOVEMBER OSCAR'),
      ),
    ).toMatchObject({ clearlyOther: false });
  });

  it('keeps current behaviour when the profile has no applicant name', () => {
    expect(
      check({ passport_number: 'ZZ1234567' }, passport('MIKE NOVEMBER OSCAR')),
    ).toBeNull();
  });
});

/**
 * Re-review 2026-10-29: a relative whose name shares a part with the
 * applicant's (a surname, a folded given name) was never flagged, even with a
 * different passport number AND date of birth, because "may be the same
 * name" returned before the number / DOB check. And a differing number alone
 * is a renewal: with a name sharing nothing it is held, not retracted.
 * Invented names.
 */
describe('holderMismatch — independent evidence first', () => {
  const check = (p: Record<string, unknown>, e: Record<string, unknown>) =>
    holderMismatch({
      profile: p,
      extracted: e as ExtractedFields,
      documentType: 'passport',
      slot: slot('passport'),
      documentId: 'doc-x',
    });

  it.each([
    ['Imran Khan', 'AYESHA KHAN'],
    ['Hassan Raza', 'HUSSAIN RAZA'],
    ['Amir Rafiq', 'UMAR RAFIQ'],
    ['Bilal Ahmed', 'RASHID AHMAD'],
  ])(
    '%s vs %s: number AND DOB both differ → clearly someone else',
    (applicant, printed) => {
      expect(
        check(
          {
            full_name: applicant,
            passport_number: 'ZZ1234567',
            date_of_birth: '1980-01-01',
          },
          {
            full_name: printed,
            passport_number: 'XY9876543',
            date_of_birth: '1992-06-15',
          },
        ),
      ).toMatchObject({ clearlyOther: true });
    },
  );

  it('the same names with a matching DOB are left alone', () => {
    expect(
      check(
        {
          full_name: 'Imran Khan',
          passport_number: 'ZZ1234567',
          date_of_birth: '1980-01-01',
        },
        {
          full_name: 'IMRAN KHAN',
          passport_number: 'XY9876543',
          date_of_birth: '1980-01-01',
        },
      ),
    ).toBeNull();
  });

  it.each([
    [{ full_name: 'Bob', passport_number: 'OLD999999' }, 'ROBERT SMITH'],
    [{ full_name: 'Billu', passport_number: 'OLD999999' }, 'BILAWAL TESTER'],
  ])(
    'a differing number with a name sharing nothing is held, not retracted (%o vs %s)',
    (p, printed) => {
      expect(
        check(p, { full_name: printed, passport_number: 'NEW1234567' }),
      ).toMatchObject({ clearlyOther: false, needsConfirmation: true });
    },
  );

  it('a name sharing nothing AND an independent DOB that differs is clearly someone else', () => {
    expect(
      check(
        { full_name: 'Bob', date_of_birth: '1980-01-01' },
        { full_name: 'ROBERT SMITH', date_of_birth: '1992-06-15' },
      ),
    ).toMatchObject({ clearlyOther: true });
  });
});
