import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { FieldCryptoService } from './field-crypto.service';
import type { Env } from '../../../config/configuration';

const KEY = 'a'.repeat(64); // 32 bytes of 0xaa, hex-encoded

function make(key: string | undefined): FieldCryptoService {
  return new FieldCryptoService({
    get: () => key,
  } as unknown as ConfigService<Env>);
}

describe('FieldCryptoService', () => {
  it('round-trips a value', () => {
    const svc = make(KEY);
    const secret = 'passport number A1234567, DOB 1990-01-01';
    expect(svc.decrypt(svc.encrypt(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const svc = make(KEY);
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('refuses to encrypt with no key rather than storing recoverable data', () => {
    expect(() => make(undefined).encrypt('x')).toThrow(
      InternalServerErrorException,
    );
    expect(make(undefined).isConfigured).toBe(false);
  });

  it('rejects a tampered ciphertext (GCM authentication holds)', () => {
    const svc = make(KEY);
    const buf = Buffer.from(svc.encrypt('sensitive'), 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
  });

  it('rejects a tampered authentication tag', () => {
    const svc = make(KEY);
    const buf = Buffer.from(svc.encrypt('sensitive'), 'base64');
    buf[12] ^= 0xff; // first byte of the 16-byte tag
    expect(() => svc.decrypt(buf.toString('base64'))).toThrow();
  });

  it('rejects a truncated payload instead of accepting a short GCM tag', () => {
    // Without an explicit authTagLength, Node accepts tags as short as 4 bytes.
    // A truncated payload is how an attacker would produce one, so a payload
    // that cannot hold a full 16-byte tag must be refused outright.
    const svc = make(KEY);
    const buf = Buffer.from(svc.encrypt('sensitive'), 'base64');
    const truncated = buf.subarray(0, 12 + 4); // iv + a 4-byte "tag", no more
    expect(() => svc.decrypt(truncated.toString('base64'))).toThrow(
      /too short to contain an authentication tag/,
    );
  });

  it('rejects a value encrypted under a different key', () => {
    const a = make(KEY);
    const b = make('b'.repeat(64));
    expect(() => b.decrypt(a.encrypt('sensitive'))).toThrow();
  });
});
