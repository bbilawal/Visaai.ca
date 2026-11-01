import {
  civilRecordKind,
  inferBirthCountry,
  parseBirthCertificates,
  parseCivilDate,
  parseMarriageCertificate,
} from './civil-records';
import {
  CNIC_SPOUSE,
  NIKAH_NAMA,
  ONTARIO_BIRTH_CERT,
  PUNJAB_BIRTH_CERT_SAJAWAL,
  PUNJAB_BIRTH_CERTS_TWO_CHILDREN,
} from './__fixtures__/civil-records.fixtures';

describe('parseCivilDate', () => {
  it.each([
    ['14-October-1989', '1989-10-14'],
    ['14 Oct 1989', '1989-10-14'],
    ['SEPTEMBER 02,1995', '1995-09-02'],
    ['NOV. 22,1995', '1995-11-22'],
    ['1989-10-14', '1989-10-14'],
    ['14/10/1989', '1989-10-14'],
    ['16-9-1988', '1988-09-16'],
    ['16 - 9 - 1988', '1988-09-16'],
    ['16=9-1988', '1988-09-16'],
    ['09.10.1968', undefined], // ambiguous without a day-first convention
  ])('%s → %s', (raw, want) => {
    expect(parseCivilDate(raw)).toBe(want);
  });

  it('reads an ambiguous numeric date day-first only when told the issuer does', () => {
    expect(parseCivilDate('09.10.1968', { dayFirst: true })).toBe('1968-10-09');
    expect(parseCivilDate('05-06-2017', { dayFirst: true })).toBe('2017-06-05');
  });

  it('rejects impossible dates and non-dates', () => {
    expect(parseCivilDate('31-February-1990')).toBeUndefined();
    expect(parseCivilDate('Rawalpindi')).toBeUndefined();
    expect(parseCivilDate('')).toBeUndefined();
  });
});

describe('parseBirthCertificates — Punjab / NADRA CRMS', () => {
  it('reads every field IRCC asks for from one certificate', () => {
    const [rec, ...rest] = parseBirthCertificates(PUNJAB_BIRTH_CERT_SAJAWAL);
    expect(rest).toEqual([]);
    expect(rec).toEqual({
      full_name: 'MIAN MUHAMMAD SAJAWAL',
      date_of_birth: '1989-10-14',
      sex: 'Male',
      place_of_birth: 'RAWALPINDI',
      country_of_birth: 'Pakistan',
      father_name: 'MUZAFFAR AHMAD',
      mother_name: 'SUMERA AHMAD',
      father_national_id: '37405-5309209-7',
      mother_national_id: '37405-0486358-7',
      relation: 'son',
    });
  });

  it('returns one record per certificate when siblings share one upload', () => {
    const recs = parseBirthCertificates(PUNJAB_BIRTH_CERTS_TWO_CHILDREN);
    expect(recs.map((r) => [r.full_name, r.date_of_birth])).toEqual([
      ['MIAN MUHAMMAD SAJAWAL', '1989-10-14'],
      ['MIAN MUHAMMAD BILAWAL', '1989-10-14'],
    ]);
    expect(recs.every((r) => r.father_name === 'MUZAFFAR AHMAD')).toBe(true);
  });

  it("never takes the registrant's name from Applicant's Details as the child", () => {
    const [rec] = parseBirthCertificates(PUNJAB_BIRTH_CERT_SAJAWAL);
    expect(rec.full_name).not.toBe('MUZAFFAR AHMAD');
  });
});

describe('parseBirthCertificates — Ontario', () => {
  it('splits a surname-first name and reads a month-name date', () => {
    const [rec] = parseBirthCertificates(ONTARIO_BIRTH_CERT);
    expect(rec).toMatchObject({
      full_name: 'FARHANA ARSHED CHOUDHRY',
      given_name: 'FARHANA ARSHED',
      family_name: 'CHOUDHRY',
      date_of_birth: '1995-09-02',
      sex: 'Female',
      place_of_birth: 'SCARBOROUGH',
      country_of_birth: 'Canada',
    });
    // Ontario prints no parents — nothing may be invented for them.
    expect(rec.father_name).toBeUndefined();
    expect(rec.mother_name).toBeUndefined();
  });
});

describe('inferBirthCountry', () => {
  it('infers only from issuers it recognises', () => {
    expect(inferBirthCountry('Government of Punjab Birth Registration')).toBe(
      'Pakistan',
    );
    expect(inferBirthCountry(ONTARIO_BIRTH_CERT)).toBe('Canada');
    expect(inferBirthCountry('Birth certificate, Republic of Somewhere')).toBe(
      undefined,
    );
  });
});

describe('parseMarriageCertificate — nikah nama', () => {
  it('takes the date from the English "solemnized/celebrated" line, not a stray scrawl', () => {
    const rec = parseMarriageCertificate(NIKAH_NAMA);
    expect(rec.marriage_date).toBe('1988-09-16');
    expect(rec.marriage_date_label).toBe('solemnized');
    // The registration line agrees, so there is no conflict.
    expect(rec.marriage_date_conflict).toBeUndefined();
  });

  it('reads both parties without their fathers', () => {
    const rec = parseMarriageCertificate(NIKAH_NAMA);
    expect(rec.bridegroom_name).toBe('Muzaffar Ahmad');
    expect(rec.bride_name).toBe('Sumera Bano');
  });

  it('falls back to the registration line and reports a disagreement', () => {
    const onlyRegistered = NIKAH_NAMA.replace(/12\. The date when[^\n]*\n/, '');
    expect(parseMarriageCertificate(onlyRegistered)).toMatchObject({
      marriage_date: '1988-09-16',
      marriage_date_label: 'registered',
    });

    const disagree = NIKAH_NAMA.replace('16=9-1988', '20-9-1988');
    const rec = parseMarriageCertificate(disagree);
    expect(rec.marriage_date).toBe('1988-09-16');
    expect(rec.marriage_date_conflict).toEqual(['1988-09-20', '1988-09-16']);
  });

  it('takes no date at all when no labelled line is readable', () => {
    expect(
      parseMarriageCertificate('Nikah Nama\n16-9-1999\nMuzaffar Ahmad')
        .marriage_date,
    ).toBeUndefined();
  });
});

describe('civilRecordKind', () => {
  it('trusts a civil-record document type', () => {
    expect(civilRecordKind('birth_certificate_children', '')).toBe(
      'birth_certificate',
    );
    expect(civilRecordKind('marriage_certificate', '')).toBe(
      'marriage_certificate',
    );
  });

  it('recognises the certificates in a broad slot by their text', () => {
    expect(civilRecordKind('proof_of_relationship', NIKAH_NAMA)).toBe(
      'marriage_certificate',
    );
    expect(civilRecordKind('family_documents', PUNJAB_BIRTH_CERT_SAJAWAL)).toBe(
      'birth_certificate',
    );
  });

  it('leaves identity documents alone', () => {
    expect(civilRecordKind('national_id', CNIC_SPOUSE)).toBeNull();
    expect(civilRecordKind('passport', PUNJAB_BIRTH_CERT_SAJAWAL)).toBeNull();
  });
});
