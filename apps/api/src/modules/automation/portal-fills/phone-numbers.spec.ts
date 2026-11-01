import { placePhone } from './phone-numbers';

describe('placePhone', () => {
  it('an explicit +1 / 001 is North American, the ten digits', () => {
    expect(placePhone('+1 905-226-5664')).toEqual({
      location: 'Canada or the U.S.',
      number: '9052265664',
    });
    expect(placePhone('001 (905) 226 5664')?.number).toBe('9052265664');
  });

  it('an explicit +CC / 00CC is "Other", split on the real calling code', () => {
    expect(placePhone('+92 300 1234567')).toEqual({
      location: 'Other',
      countryCode: '92',
      number: '3001234567',
    });
    expect(placePhone('00234 803 123 4567')).toMatchObject({
      countryCode: '234',
      number: '8031234567',
    });
    expect(placePhone('+44 (0)20 7946 0018')).toMatchObject({
      countryCode: '44',
      number: '2079460018',
    });
    // Italy dials its leading 0 from abroad.
    expect(placePhone('+39 06 1234 5678')?.number).toBe('0612345678');
  });

  it('the NANP shape alone is North American only for a CAN / USA owner', () => {
    expect(placePhone('905-226-5664', { country: 'CAN' })?.location).toBe(
      'Canada or the U.S.',
    );
    expect(placePhone('1 212 555 0142', { country: 'USA' })?.number).toBe(
      '2125550142',
    );
    expect(placePhone('9876543210', { country: 'IND' })).toEqual({
      location: 'Other',
      countryCode: '91',
      number: '9876543210',
    });
  });

  it('a leading 1 is never stripped from a non-NANP number', () => {
    expect(placePhone('13812345678', { country: 'China' })).toMatchObject({
      countryCode: '86',
      number: '13812345678',
    });
    expect(placePhone('11987654321', { country: 'BRA' })).toMatchObject({
      countryCode: '55',
      number: '11987654321',
    });
  });

  it('a CAN / USA owner with a number that is not NANP-shaped: not placed', () => {
    expect(placePhone('0912345678', { country: 'CAN' })).toBeUndefined();
  });

  it('a code recorded beside the number counts as its prefix', () => {
    expect(placePhone('9052265664', { countryCode: '1' })?.location).toBe(
      'Canada or the U.S.',
    );
    expect(
      placePhone('0300 1234567', { countryCode: '+92', country: 'CAN' }),
    ).toMatchObject({ countryCode: '92', number: '3001234567' });
  });

  it('never guesses: no prefix and no (known) country is undefined', () => {
    expect(placePhone('9876543210')).toBeUndefined();
    expect(placePhone('9876543210', { country: 'Atlantis' })).toBeUndefined();
    expect(placePhone('+999 123')).toBeUndefined();
    expect(placePhone('')).toBeUndefined();
  });
});
