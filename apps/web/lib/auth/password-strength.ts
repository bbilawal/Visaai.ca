export interface PasswordChecks {
  len: boolean
  upper: boolean
  lower: boolean
  number: boolean
  special: boolean
}

export interface PasswordScore {
  /** 0..5 — count of satisfied rules. */
  score: number
  checks: PasswordChecks
}

/**
 * AUTH-001: raised from 8 to 12 to match the Supabase project policy
 * (password_min_length). 8 characters with no complexity requirement guards
 * passports, bank statements and immigration filings; platform CAPTCHA is off,
 * so the practical control against credential stuffing was the per-email
 * lockout alone.
 *
 * Only affects passwords being SET — existing users are unaffected and can
 * still sign in.
 */
export const PASSWORD_MIN_LENGTH = 12;

/** Deterministic, dependency-free password rule evaluation for the strength meter. */
export function scorePassword(password: string): PasswordScore {
  const checks: PasswordChecks = {
    len: password.length >= PASSWORD_MIN_LENGTH,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  }
  const score = Object.values(checks).filter(Boolean).length
  return { score, checks }
}
