/**
 * Local password strength scoring.
 *
 * Mirrors the `scorePassword` helper apps/web ships in its premium auth kit so
 * the same password is judged the same way on both clients — a rule that
 * differs by platform is a support ticket waiting to happen.
 *
 * Runs entirely on-device: the password is never sent anywhere to be scored.
 * This is guidance, not enforcement; Supabase applies the project's actual
 * password policy at signup.
 */
export interface PasswordScore {
  /** 0 (unusable) … 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  feedback: string;
}

const COMMON = new Set([
  'password',
  'password1',
  '12345678',
  'qwertyui',
  'letmein',
  'welcome1',
  'iloveyou',
  'admin123',
  'visaai123',
]);

export function scorePassword(password: string): PasswordScore {
  if (!password) return { score: 0, feedback: 'Enter a password.' };
  if (password.length < 8) {
    return { score: 0, feedback: 'Use at least 8 characters.' };
  }
  if (COMMON.has(password.toLowerCase())) {
    return { score: 0, feedback: 'That password is too common.' };
  }

  let score = 0;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  // A long passphrase is strong even without symbol soup — do not punish it.
  if (password.length >= 16 && score < 3) score = 3;

  const clamped = Math.max(0, Math.min(4, score)) as PasswordScore['score'];
  const feedback = [
    'Too weak — add length and variety.',
    'Weak — add length or another character type.',
    'Okay — a longer passphrase would be stronger.',
    'Good.',
    'Strong.',
  ][clamped] as string;

  return { score: clamped, feedback };
}
