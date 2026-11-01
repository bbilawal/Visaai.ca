/**
 * Minimal, dependency-free JWT payload decoder. The token is already CRYPTO-
 * VERIFIED by Supabase (`supabase.auth.getUser`) before this runs — this only
 * reads non-secret claims (`aal`, `amr`) that aren't on the user object. Never
 * use this to trust a token: it does NOT verify the signature.
 */
export interface AccessTokenClaims {
  /** Authenticator Assurance Level: 'aal1' (password) or 'aal2' (MFA satisfied). */
  aal: string | null;
  /** Authentication Methods References, e.g. [{ method: 'totp' }]. */
  amr: { method?: string }[];
}

/** Decode a JWT payload (middle segment) to a plain object; null if malformed. */
export function decodeJwtPayload(
  token: string | undefined | null,
): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract the assurance-level claims from an access token (safe defaults). */
export function readAccessTokenClaims(
  token: string | undefined | null,
): AccessTokenClaims {
  const payload = decodeJwtPayload(token);
  const aal = payload && typeof payload.aal === 'string' ? payload.aal : null;
  const amr =
    payload && Array.isArray(payload.amr)
      ? (payload.amr as { method?: string }[])
      : [];
  return { aal, amr };
}
