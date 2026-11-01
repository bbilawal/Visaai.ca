import { restoreIdentifiers } from './restore-identifiers';

describe('restoreIdentifiers', () => {
  const profile = {
    uci: '1147908458',
    passport_number: 'AK1182091',
    previous_application_number: 'V403886015',
    full_name: 'MUZAFFAR AHMAD',
  };

  it('puts a regrouped UCI back exactly as the applicant gave it', () => {
    expect(restoreIdentifiers('**UCI:** 1147-9084-58', profile)).toBe(
      '**UCI:** 1147908458',
    );
    expect(restoreIdentifiers('UCI: 11-4790-8458.', profile)).toBe(
      'UCI: 1147908458.',
    );
    expect(restoreIdentifiers('UCI 1147 908 458', profile)).toBe(
      'UCI 1147908458',
    );
  });

  it('restores passport and previous application numbers too', () => {
    expect(
      restoreIdentifiers('Passport AK-118-2091, file V 403886015', profile),
    ).toBe('Passport AK1182091, file V403886015');
  });

  it('leaves text that already matches, and unrelated numbers, alone', () => {
    const text = 'UCI 1147908458, income CAD 96,254, phone 905-226-5664';
    expect(restoreIdentifiers(text, profile)).toBe(text);
  });

  it('does not match inside a longer run of digits', () => {
    const text = 'ref 911479084581';
    expect(restoreIdentifiers(text, profile)).toBe(text);
  });

  it('ignores short or missing identifiers', () => {
    expect(restoreIdentifiers('code 12-34', { uci: '1234' })).toBe('code 12-34');
    expect(restoreIdentifiers('UCI 1147-9084-58', {})).toBe('UCI 1147-9084-58');
  });
});
