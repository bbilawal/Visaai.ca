import {
  GENERIC_MISMATCH_NOTE,
  genericDobIsAnotherDate,
  reviewStoredCrossCheck,
  birthDateCandidates,
  compareIdentityField,
  identityRole,
  namesMatch,
} from './identity-compare';

const NOW = new Date('2026-10-14T00:00:00Z');

describe('birthDateCandidates', () => {
  it.each([
    ['1961-06-15', ['1961-06-15']],
    ['15.06.1961', ['1961-06-15']],
    ['15/06/1961', ['1961-06-15']],
    ['15-06-1961', ['1961-06-15']],
    ['15 JUN 1961', ['1961-06-15']],
    ['June 15 1961', ['1961-06-15']],
    ['June 15, 1961', ['1961-06-15']],
    ['15-Jun-1961', ['1961-06-15']],
    ['1961/06/15', ['1961-06-15']],
  ])('reads %s', (raw, expected) => {
    expect(birthDateCandidates(raw, NOW)).toEqual(expected);
  });

  it('keeps both readings of an ambiguous numeric date', () => {
    expect(birthDateCandidates('03/04/1990', NOW).sort()).toEqual([
      '1990-03-04',
      '1990-04-03',
    ]);
  });

  it.each([
    'June 2025,', // no day — a letter date, not a birth date
    '2025', // year only
    '2030-01-01', // future
    '1850-01-01', // older than 120
    '31.02.1961', // not a calendar date
    'to 31 July', // no year
    '',
  ])('rejects %p as a birth date', (raw) => {
    expect(birthDateCandidates(raw, NOW)).toEqual([]);
  });
});

describe('namesMatch', () => {
  it('matches case/whitespace/punctuation variants', () => {
    expect(namesMatch('MUZAFFAR AHMAD', 'Muzaffar  Ahmad')).toBe('match');
    expect(namesMatch('AHMAD, MUZAFFAR', 'Muzaffar Ahmad')).toBe('match');
  });

  it('treats a multi-person value containing every passport token as contained', () => {
    expect(namesMatch('MUZAFFAR AHMAD', 'Sumera Ahmad Muzaffar Ahmad')).toBe(
      'contained',
    );
  });

  it('is a mismatch when a token is missing', () => {
    expect(namesMatch('MUZAFFAR AHMAD', 'Sumera Bibi')).toBe('mismatch');
  });

  it('does not accept a single shared token as containment', () => {
    expect(namesMatch('MUZAFFAR AHMAD', 'Ahmad')).toBe('mismatch');
  });
});

describe('compareIdentityField', () => {
  it('equal dates in different formats match', () => {
    expect(
      compareIdentityField('date_of_birth', '1961-06-15', '15.06.1961', NOW),
    ).toEqual({ result: 'match' });
  });

  it('an ambiguous date matches if either reading equals the other', () => {
    expect(
      compareIdentityField('date_of_birth', '1961-06-05', '05/06/1961', NOW),
    ).toEqual({ result: 'match' });
  });

  it('skips a value that is not a plausible full birth date', () => {
    expect(
      compareIdentityField('date_of_birth', '1961-06-15', 'June 2025,', NOW),
    ).toBeNull();
  });

  it('flags genuinely different birth dates', () => {
    expect(
      compareIdentityField('date_of_birth', '1961-06-15', '1962-06-15', NOW),
    ).toEqual({ result: 'mismatch' });
  });

  it('name containment is a warning, not a mismatch', () => {
    expect(
      compareIdentityField(
        'full_name',
        'MUZAFFAR AHMAD',
        'Sumera Ahmad Muzaffar Ahmad',
        NOW,
      ),
    ).toEqual({ result: 'warning', note: expect.any(String) });
  });

  it('passport numbers ignore spacing and case', () => {
    expect(
      compareIdentityField('passport_number', 'ab 123456', 'AB123456', NOW),
    ).toEqual({ result: 'match' });
  });
});

describe('identityRole', () => {
  it.each([
    ['passport', 'identity'],
    ['passport_copy', 'identity'],
    ['national_id', 'identity'],
    ['national_id_card', 'identity'],
    // A child's certificate names the child, not the applicant (2026-10-15).
    ['birth_certificate', 'supporting'],
    ['birth_certificate_children', 'supporting'],
    ['document', 'generic'],
    [null, 'generic'],
    ['invitation_letter', 'supporting'],
    ['bank_statement', 'supporting'],
    ['employment_letter', 'supporting'],
    ['medical_insurance', 'supporting'],
    ['marriage_certificate', 'supporting'],
    ['refusal_letter', 'supporting'],
    ['sponsor_bank_statement', 'supporting'],
  ])('%s is %s', (type, role) => {
    expect(identityRole(type)).toBe(role);
  });
});

describe('generic DOB far from the identity DOB', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  it('treats a date years away from the passport DOB as some other date', () => {
    // A refusal letter's date (2025-06-30) read as a DOB on an untyped upload.
    expect(genericDobIsAnotherDate('1961-06-15', '2025-06-30', now)).toBe(true);
  });
  it('keeps a near miss (day/month swap or typo) comparable', () => {
    expect(genericDobIsAnotherDate('1961-06-15', '1961-06-16', now)).toBe(false);
    expect(genericDobIsAnotherDate('1961-06-15', '15.06.1961', now)).toBe(false);
  });
});

describe('reviewStoredCrossCheck', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  const row = (over: Record<string, unknown> = {}) => ({
    field_compared: 'date_of_birth',
    result: 'mismatch',
    details_json: {
      value_a: '1961-06-15',
      value_b: '2025-06-30',
      doc_type_a: 'passport_copy',
      doc_type_b: 'document',
      suggestion: 'Your date of birth differs…',
    },
    ...over,
  });

  it('drops a stored DOB "mismatch" that compared a passport with some other date on an untyped upload', () => {
    // Prod 2026-10-15: stored before the tolerant rule (5d778a8e) shipped, and
    // never re-evaluated, so it kept showing on the Documents page.
    expect(reviewStoredCrossCheck(row(), now)).toBeNull();
  });

  it('downgrades any other stored mismatch involving an untyped upload to a warning', () => {
    const out = reviewStoredCrossCheck(
      row({
        field_compared: 'full_name',
        details_json: {
          value_a: 'MUZAFFAR AHMAD',
          value_b: 'SUMERA AHMAD',
          doc_type_a: 'passport_copy',
          doc_type_b: 'document',
          suggestion: 'x',
        },
      }),
      now,
    );
    expect(out?.result).toBe('warning');
    expect(out?.details_json).not.toHaveProperty('suggestion');
    expect(out?.details_json).toHaveProperty('note', GENERIC_MISMATCH_NOTE);
  });

  it('leaves identity-vs-identity results as stored', () => {
    const r = row({
      details_json: {
        value_a: '1961-06-15',
        value_b: '1962-06-15',
        doc_type_a: 'passport_copy',
        doc_type_b: 'national_id',
      },
    });
    expect(reviewStoredCrossCheck(r, now)).toEqual(r);
  });
});

describe('reviewStoredCrossCheck without recorded document types', () => {
  it('leaves the row as stored', () => {
    const r = { field_compared: 'date_of_birth', result: 'mismatch', details_json: null };
    expect(reviewStoredCrossCheck(r)).toEqual(r);
  });
});
