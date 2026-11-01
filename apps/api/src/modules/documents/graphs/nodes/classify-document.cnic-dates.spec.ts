import {
  cardDatesFromLabels,
  identityFieldsFromText,
} from './classify-document';

describe('CNIC issue and expiry dates (dry run 2026-10-16)', () => {
  it('reads a label followed by its date', () => {
    expect(
      cardDatesFromLabels(
        'Date of Issue 24.04.2017\nDate of Expiry 24.04.2027',
      ),
    ).toEqual({ issue_date: '2017-04-24', expiry_date: '2027-04-24' });
  });

  it('reads a row of labels with the dates underneath', () => {
    expect(
      cardDatesFromLabels(
        'Date of Birth Date of Issue Date of Expiry\n15.06.1961 24.04.2017 24.04.2027',
      ),
    ).toEqual({ issue_date: '2017-04-24', expiry_date: '2027-04-24' });
  });

  it('drops dates that cannot be right (expiry before issue)', () => {
    expect(
      cardDatesFromLabels('Date of Issue 24.04.2027 Date of Expiry 24.04.2017'),
    ).toEqual({});
  });

  it('is part of the ID card text read, not the passport one', () => {
    const text =
      'Name Muzaffar Ahmad Gender M Identity Number 37405-5309209-7 Date of Issue 24.04.2017 Date of Expiry 24.04.2027';
    expect(identityFieldsFromText('national_id', text)).toMatchObject({
      issue_date: '2017-04-24',
      expiry_date: '2027-04-24',
    });
    expect(identityFieldsFromText('bank_statement', text)).toEqual({});
  });
});
