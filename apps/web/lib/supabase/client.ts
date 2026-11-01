import { createBrowserClient } from '@supabase/ssr'
import type { Session, SignInWithPasswordCredentials } from '@supabase/supabase-js'

type AuthSessionResponse = {
  data: {
    session: Session | null
  }
  error: unknown
}

type AuthResponse = {
  data: {
    user: unknown | null
    session: Session | null
  }
  error: unknown
}

// Loose result shape for auth operations whose callers only care about `error`
// (reset/update password, OAuth start). Mirrors the `error: unknown` style of
// AuthResponse so call sites can `const { error } = await …` without a cast.
type AuthOpResult = {
  data: unknown
  error: unknown
}

let supabaseClient: ReturnType<typeof createBrowserClient> | null = null
let authQueue: Promise<unknown> = Promise.resolve()

// In-memory lock replacing supabase-js navigatorLock. The Navigator LockManager
// lock fails immediately (acquireTimeout 0) under concurrent auth calls, throwing
// NavigatorLockAcquireTimeoutError. A per-key promise chain serializes auth ops
// within the tab without touching navigator.locks.
const lockChains: Record<string, Promise<unknown>> = {}

async function inMemoryLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const prev = lockChains[name] ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  lockChains[name] = prev.then(() => current)
  await prev.catch(() => undefined)
  try {
    return await fn()
  } finally {
    release()
  }
}

// supabase-js holds its auth lock until every pending auth operation has
// drained, and inMemoryLock never gives up waiting. An auth request that never
// answers (a token refresh on a stalled connection) therefore held the lock for
// good and every later getSession() in the tab queued behind it: the
// submission page's readback gate sat on "Checking…" forever (2026-10-13).
// Bounding auth requests lets the hung one fail as a retryable fetch error, so
// supabase-js releases the lock and the waiting calls settle.
export const AUTH_REQUEST_TIMEOUT_MS = 10_000

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

// Auth endpoints only: storage uploads of large documents legitimately run
// longer than any timeout that suits an auth call.
export function authRequestFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!requestUrl(input).includes('/auth/v1/')) return fetch(input, init)

  const controller = new AbortController()
  const callerSignal = init?.signal
  const onCallerAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) onCallerAbort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

  const timer = setTimeout(
    () => controller.abort(new DOMException('Supabase auth request timed out', 'TimeoutError')),
    AUTH_REQUEST_TIMEOUT_MS,
  )
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  })
}

export function createClient() {
  if (!supabaseClient) {
    supabaseClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { lock: inMemoryLock }, global: { fetch: authRequestFetch } }
    )
  }
  return supabaseClient
}

function runAuthOperation<T>(fn: () => Promise<T>): Promise<T> {
  const next = authQueue.finally(() => undefined).then(fn, fn)
  authQueue = next.catch(() => undefined)
  return next
}

// While the stored token cannot be refreshed, supabase-js's initialisation
// never finishes: it holds its lock while it retries, and the auto-refresh
// ticker adds a new attempt every 30s before the last one drains. getSession()
// waits on that initialisation, so without a bound every caller (and the
// shared authQueue behind them) waits forever. Rejecting lets callers show an
// error, and the queue moves on.
export const GET_SESSION_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function getSession(): Promise<AuthSessionResponse> {
  return runAuthOperation(() =>
    withTimeout(
      createClient().auth.getSession(),
      GET_SESSION_TIMEOUT_MS,
      'Could not reach the sign-in service. Check your connection and try again.',
    )
  )
}

/**
 * True for the anonymous identity minted by `ensureSession` for the login-free
 * public funnel.
 *
 * A guest holds a real JWT, so `session != null` is NOT a usable "may I call the
 * API?" test: JwtGuard is deliberately fail-closed for anonymous callers and
 * rejects every route that is not explicitly `@AllowAnonymous`. Client code that
 * only checks for a session therefore issues requests the backend is guaranteed
 * to 403 (BUG-002). Gate authenticated-only calls on this instead. This is a
 * noise/efficiency guard in the UI, never a security boundary — the guard and
 * RLS remain the real gate.
 */
export function isGuestSession(session: Session | null): boolean {
  return session?.user?.is_anonymous === true
}

export function signInWithPassword(credentials: SignInWithPasswordCredentials): Promise<AuthResponse> {
  return runAuthOperation(() => createClient().auth.signInWithPassword(credentials))
}

export function signUp(options: { email: string; password: string; fullName?: string }): Promise<AuthResponse> {
  return runAuthOperation(() =>
    createClient().auth.signUp({
      email: options.email,
      password: options.password,
      options: { data: { full_name: options.fullName } },
    })
  )
}

/**
 * Start (or reuse) a guest session. Creates a real but anonymous Supabase
 * identity (is_anonymous=true) with a JWT, so the existing RLS/JwtGuard/WS
 * pipeline treats the guest like any owner of their own rows. On signup the
 * SAME uid is upgraded (updateUser / linkIdentity) — no data migration.
 *
 * Idempotent: if a session already exists (guest or permanent) it is reused
 * rather than minting a second anonymous user.
 */
export async function ensureSession(): Promise<Session | null> {
  const { data: { session } } = await getSession()
  if (session) return session
  const { data, error } = (await runAuthOperation(() =>
    createClient().auth.signInAnonymously()
  )) as AuthResponse
  // Surface the real GoTrue reason instead of silently returning null. The
  // common failure is the project-level "Anonymous sign-ins are disabled"
  // (Supabase Auth setting OFF) — swallowing it left the caller showing a
  // generic "Could not start a session" that hid the actual cause.
  if (error) {
    console.error('signInAnonymously failed:', error)
    throw error instanceof Error
      ? error
      : new Error(
          (error as { message?: string })?.message ?? 'Anonymous sign-in failed',
        )
  }
  return data.session
}

export function getUser() {
  return runAuthOperation(() => createClient().auth.getUser())
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
}

export function resetPasswordForEmail(email: string): Promise<AuthOpResult> {
  return runAuthOperation(() =>
    createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/callback?next=/reset-password`,
    })
  )
}

export function updateUserPassword(password: string): Promise<AuthOpResult> {
  return runAuthOperation(() => createClient().auth.updateUser({ password }))
}

function callbackUrl(next?: string): string {
  const base = `${siteUrl()}/callback`
  return next ? `${base}?next=${encodeURIComponent(next)}` : base
}

/**
 * Extra scopes to request per provider, beyond what GoTrue asks for by default.
 *
 * Azure/Entra needs this: GoTrue's default azure scope is a bare `openid`
 * (confirmed on the live authorize redirect — `&scope=openid`), and an
 * `openid`-only id_token carries no `email` claim, so a Microsoft sign-in
 * creates an account with an empty email address. Google already defaults to
 * `email profile` and needs nothing here.
 */
const PROVIDER_SCOPES: Partial<Record<'google' | 'azure', string>> = {
  azure: 'openid email profile',
}

export function signInWithOAuth(
  provider: 'google' | 'azure',
  next?: string,
): Promise<AuthOpResult> {
  return runAuthOperation(() =>
    createClient().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(next),
        scopes: PROVIDER_SCOPES[provider],
      },
    })
  )
}

/**
 * Upgrade a guest (anonymous) session into a permanent account by linking an
 * OAuth identity to the SAME uid. All intake data already attached to that uid
 * is preserved — no migration. Requires manual linking enabled in Supabase.
 * Redirects through /callback?next=<target> so the user returns to where they
 * were (e.g. the documents stage they tried to open).
 */
export function linkOAuthIdentity(
  provider: 'google' | 'azure',
  next?: string,
): Promise<AuthOpResult> {
  return runAuthOperation(() =>
    createClient().auth.linkIdentity({
      provider,
      options: {
        redirectTo: callbackUrl(next),
        scopes: PROVIDER_SCOPES[provider],
      },
    })
  )
}

/**
 * Upgrade a guest (anonymous) session into a permanent account with email +
 * password on the SAME uid (updateUser, not signUp — signUp would mint a new
 * uid and orphan the guest's intake data). No redirect; the caller refreshes
 * auth state and navigates on success.
 */
export function upgradeGuestEmail(options: {
  email: string
  password: string
  fullName?: string
}): Promise<AuthOpResult> {
  return runAuthOperation(() =>
    createClient().auth.updateUser({
      email: options.email,
      password: options.password,
      data: options.fullName ? { full_name: options.fullName } : undefined,
    })
  )
}

// ── Multi-factor authentication (TOTP) — native Supabase MFA ──────────────
// Factors live in Supabase (auth.mfa_factors); we never store TOTP secrets.

type MfaEnrollResult = {
  data: {
    id: string
    type: string
    totp: { qr_code: string; secret: string; uri: string }
  } | null
  error: unknown
}

type MfaListResult = {
  data: {
    totp: { id: string; friendly_name?: string; status: string }[]
    all: { id: string; factor_type: string; status: string }[]
  } | null
  error: unknown
}

/** Begin TOTP enrollment → returns a QR code (data URL) + secret to display. */
export function mfaEnroll(): Promise<MfaEnrollResult> {
  return runAuthOperation(() =>
    createClient().auth.mfa.enroll({ factorType: 'totp' }),
  ) as Promise<MfaEnrollResult>
}

/** List the user's enrolled factors (verified TOTP factors live under `totp`). */
export function mfaListFactors(): Promise<MfaListResult> {
  return runAuthOperation(() =>
    createClient().auth.mfa.listFactors(),
  ) as Promise<MfaListResult>
}

/** Challenge a factor then verify the user-entered TOTP code (elevates to aal2). */
export function mfaChallengeAndVerify(
  factorId: string,
  code: string,
): Promise<AuthOpResult> {
  return runAuthOperation(async () => {
    const sb = createClient()
    const challenge = await sb.auth.mfa.challenge({ factorId })
    if (challenge.error || !challenge.data) {
      return { data: null, error: challenge.error } as AuthOpResult
    }
    return sb.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    })
  }) as Promise<AuthOpResult>
}

/** Remove a factor (disable MFA for that factor). */
export function mfaUnenroll(factorId: string): Promise<AuthOpResult> {
  return runAuthOperation(() =>
    createClient().auth.mfa.unenroll({ factorId }),
  ) as Promise<AuthOpResult>
}
