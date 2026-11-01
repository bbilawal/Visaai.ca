import { decodeJwtPayload, readAccessTokenClaims } from './jwt-claims';

function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('jwt-claims', () => {
  describe('decodeJwtPayload', () => {
    it('decodes the payload segment', () => {
      const t = makeToken({ sub: 'u1', aal: 'aal2' });
      expect(decodeJwtPayload(t)).toMatchObject({ sub: 'u1', aal: 'aal2' });
    });

    it('returns null for malformed / empty tokens', () => {
      expect(decodeJwtPayload(null)).toBeNull();
      expect(decodeJwtPayload('')).toBeNull();
      expect(decodeJwtPayload('not-a-jwt')).toBeNull();
      expect(decodeJwtPayload('a.b')).toBeNull();
      expect(decodeJwtPayload('a.%%%.c')).toBeNull();
    });
  });

  describe('readAccessTokenClaims', () => {
    it('extracts aal + amr', () => {
      const t = makeToken({ aal: 'aal2', amr: [{ method: 'totp' }] });
      expect(readAccessTokenClaims(t)).toEqual({
        aal: 'aal2',
        amr: [{ method: 'totp' }],
      });
    });

    it('safe defaults when claims absent or token bad', () => {
      expect(readAccessTokenClaims(makeToken({ sub: 'u1' }))).toEqual({
        aal: null,
        amr: [],
      });
      expect(readAccessTokenClaims('garbage')).toEqual({ aal: null, amr: [] });
    });
  });
});
