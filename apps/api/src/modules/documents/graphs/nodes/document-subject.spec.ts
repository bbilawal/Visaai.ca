import {
  applyOwnIdentity,
  documentSubject,
  retractForeignIdentity,
  routeHostIdentity,
  slotSubject,
  type DocumentSlot,
} from './document-subject';

const slot = (
  slotType: string | null,
  owner: string | null = 'applicant',
  familyGap = false,
): DocumentSlot => ({ slotType, owner, familyGap });

describe('slotSubject', () => {
  it.each([
    'proof_of_host_status',
    'host_letter_of_invitation',
    'income_proof_option_one',
    'income_proof_option_two',
    'letter_of_invitation_contents',
    'sponsor_bank_statement',
    'sponsor_proof_of_relationship',
    'inviter_passport',
    'cosigner_income',
  ])('%s is a third-party slot even with owner "applicant"', (code) => {
    expect(slotSubject(slot(code))).toBe('third_party');
  });

  it('a non-applicant owner makes any slot third-party', () => {
    expect(slotSubject(slot('passport', 'sponsor'))).toBe('third_party');
  });

  it("a family-request row is a named relative's document", () => {
    expect(slotSubject(slot('national_id', 'applicant', true))).toBe(
      'third_party',
    );
  });

  it('relationship evidence is its own category', () => {
    expect(slotSubject(slot('proof_of_relationship'))).toBe('relationship');
  });

  it.each([
    'passport',
    'applicant_income_must_continue',
    'proof_of_medical_exam',
  ])('%s is an applicant slot', (code) => {
    expect(slotSubject(slot(code))).toBe('applicant');
  });

  it('no slot is "none"', () => {
    expect(slotSubject(null)).toBe('none');
  });
});

describe('documentSubject', () => {
  const profile = {
    passport_number: 'AL1183581',
    children: [{ name: 'Mian Muhammad Bilawal', relationship: 'son' }],
  };

  it("a matching passport number is the applicant's own, whatever the slot", () => {
    expect(
      documentSubject({
        profile,
        extracted: {
          full_name: 'SUMERA AHMAD',
          passport_number: 'al 118 3581',
        },
        documentType: 'passport',
        slot: null,
      }),
    ).toMatchObject({ subject: 'applicant', ownIdentity: true });
  });

  it('a number some document wrote proves nothing', () => {
    const d = documentSubject({
      profile: {
        passport_number: 'AB123456',
        _document_sources: {
          passport_number: { document_id: 'x', value: 'AB123456' },
        },
      },
      extracted: { passport_number: 'AB123456' },
      documentType: 'passport',
      slot: null,
    });
    expect(d.subject).toBe('unknown');
  });

  it("a passport in the host-status slot is the host's", () => {
    expect(
      documentSubject({
        profile: {},
        extracted: { full_name: 'MIAN MUHAMMAD' },
        documentType: 'proof_of_host_status',
        slot: slot('proof_of_host_status'),
      }).subject,
    ).toBe('other');
  });

  it("a holder the profile names as a child is the child's", () => {
    expect(
      documentSubject({
        profile,
        extracted: { full_name: 'MIAN MUHAMMAD BILAWAL' },
        documentType: 'passport',
        slot: null,
      }).subject,
    ).toBe('other');
  });

  it("the applicant's typed name on a passport makes it their own", () => {
    expect(
      documentSubject({
        profile: { full_name: 'Sumera Ahmad' },
        extracted: { full_name: 'SUMERA AHMAD' },
        documentType: 'passport',
        slot: null,
      }),
    ).toMatchObject({ subject: 'applicant', ownIdentity: true });
  });

  it('an identity document offered as relationship evidence is the relative’s', () => {
    expect(
      documentSubject({
        profile: {},
        extracted: { full_name: 'Someone' },
        documentType: 'passport',
        slot: slot('proof_of_relationship'),
      }).subject,
    ).toBe('other');
  });

  it('an unslotted document with nothing to go on is undetermined', () => {
    expect(
      documentSubject({
        profile: {},
        extracted: { full_name: 'Ada Lovelace' },
        documentType: 'passport',
        slot: null,
      }).subject,
    ).toBe('unknown');
  });
});

describe('applyOwnIdentity', () => {
  const doc = { id: 'doc-p', type: 'passport' };

  it('replaces a conflicting name, DOB and sex and records what it replaced', () => {
    const p: Record<string, unknown> = {
      full_name: 'MIAN MUHAMMAD',
      date_of_birth: '1989-10-14',
      sex: 'Male',
    };
    const changes = applyOwnIdentity(
      p,
      { full_name: 'SUMERA AHMAD', date_of_birth: '1968-10-09', sex: 'F' },
      doc,
    );
    expect(changes.map((c) => c.key).sort()).toEqual([
      'date_of_birth',
      'full_name',
      'sex',
    ]);
    expect(p).toMatchObject({
      full_name: 'SUMERA AHMAD',
      date_of_birth: '1968-10-09',
      sex: 'F',
    });
  });

  it('leaves equivalent values in the applicant’s own form', () => {
    const p: Record<string, unknown> = {
      full_name: 'Sumera Ahmad',
      date_of_birth: '09.10.1968',
      sex: 'female',
    };
    expect(
      applyOwnIdentity(
        p,
        { full_name: 'SUMERA AHMAD', date_of_birth: '1968-10-09', sex: 'F' },
        doc,
      ),
    ).toEqual([]);
  });

  it("replaces nationality only when another document wrote it, not the applicant's answer", () => {
    const answered: Record<string, unknown> = { nationality: 'Pakistani' };
    applyOwnIdentity(answered, { nationality: 'PAK' }, doc);
    expect(answered.nationality).toBe('Pakistani');

    const fromDoc: Record<string, unknown> = {
      nationality: 'CAN',
      _document_sources: {
        nationality: { document_id: 'doc-host', value: 'CAN' },
      },
    };
    applyOwnIdentity(fromDoc, { nationality: 'PAK' }, doc);
    expect(fromDoc.nationality).toBe('PAK');
  });
});

describe('retractForeignIdentity', () => {
  it('nulls what a foreign document wrote, by provenance', () => {
    const p: Record<string, unknown> = {
      sex: 'Male',
      _document_sources: { sex: { document_id: 'd1', value: 'Male' } },
    };
    retractForeignIdentity(p, { foreignDoc: { id: 'd1', extracted: {} } });
    expect(p.sex).toBeNull();
    expect(p._document_sources).toBeUndefined();
  });

  it('nulls an identical pre-provenance name and DOB, but not a different one', () => {
    const p: Record<string, unknown> = {
      full_name: 'MIAN MUHAMMAD',
      date_of_birth: '1989-10-14',
      passport_number: 'AL1183581',
    };
    retractForeignIdentity(p, {
      foreignDoc: {
        id: 'd1',
        extracted: {
          full_name: 'Mian Muhammad',
          date_of_birth: '14/10/1989',
          passport_number: 'AB123456',
        },
      },
    });
    expect(p.full_name).toBeNull();
    expect(p.date_of_birth).toBeNull();
    expect(p.passport_number).toBe('AL1183581');
  });

  it('provenanceOnly never touches a value without provenance', () => {
    const p: Record<string, unknown> = { full_name: 'Mian Muhammad' };
    retractForeignIdentity(p, {
      foreignDoc: {
        id: 'd1',
        extracted: { full_name: 'Mian Muhammad' },
        provenanceOnly: true,
      },
    });
    expect(p.full_name).toBe('Mian Muhammad');
  });

  it('drops everything a birth certificate wrote when it names the applicant as a parent', () => {
    const src = (value: string) => ({
      document_id: 'bc',
      document_type: 'birth_certificate',
      value,
    });
    const p: Record<string, unknown> = {
      full_name: 'SUMERA AHMAD',
      mother_name: 'SUMERA AHMAD',
      father_name: 'MUZAFFAR AHMAD',
      place_of_birth: 'RAWALPINDI',
      _document_sources: {
        full_name: {
          document_id: 'pp',
          document_type: 'passport',
          value: 'SUMERA AHMAD',
        },
        mother_name: src('SUMERA AHMAD'),
        father_name: src('MUZAFFAR AHMAD'),
        place_of_birth: src('RAWALPINDI'),
      },
    };
    retractForeignIdentity(p, {});
    expect(p).toMatchObject({
      full_name: 'SUMERA AHMAD',
      mother_name: null,
      father_name: null,
      place_of_birth: null,
    });
    expect(Object.keys(p._document_sources as object)).toEqual(['full_name']);
  });
});

describe('routeHostIdentity', () => {
  it("fills the inviter's name and citizenship from a Canadian passport, gap-only", () => {
    const p: Record<string, unknown> = {};
    routeHostIdentity(p, {
      full_name: 'MIAN MUHAMMAD BILAWAL',
      nationality: 'CAN',
    });
    expect(p).toEqual({
      inviter_name: 'MIAN MUHAMMAD BILAWAL',
      inviter_status: 'Canadian citizen',
    });
    const answered: Record<string, unknown> = { inviter_name: 'Bilawal' };
    routeHostIdentity(answered, {
      full_name: 'Someone Else',
      nationality: 'CAN',
    });
    expect(answered).toEqual({ inviter_name: 'Bilawal' });
  });
});
