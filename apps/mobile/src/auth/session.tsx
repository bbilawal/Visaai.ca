import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { setTokenProvider, setUnauthorizedHandler } from '@/api/client';
import { meApi, type MeResponse } from '@/api/endpoints';
import { analytics } from '@/analytics/analytics';
import { identifyForCrashReporting } from '@/observability/crash-reporting';
import { unregisterFromPush } from '@/notifications/push';
import { offlineQueue } from '@/offline/queue';
import { drafts } from '@/offline/drafts';
import {
  getAccessToken,
  getSupabase,
  startAuthAutoRefresh,
} from './supabase';
import { biometrics } from './biometrics';

/**
 * Single source of truth for "who is signed in" on mobile.
 *
 * Route guards (app/_layout.tsx) read `status` rather than poking Supabase, so
 * there is exactly one place that decides between authenticated, guest
 * (anonymous Supabase identity — the same guest model apps/web uses for the
 * public intake funnel), locked (biometric gate pending), and signed-out.
 */
export type SessionStatus =
  | 'loading'
  | 'signedOut'
  | 'guest'
  | 'authenticated'
  | 'locked';

export interface SessionState {
  status: SessionStatus;
  session: Session | null;
  user: MeResponse | null;
  /** Set when the API rejected the identity sync, so the UI can surface it. */
  error: string | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Satisfy the biometric gate for this foreground session. */
  unlock: () => Promise<boolean>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  // Survives re-renders; a satisfied biometric gate must not re-prompt on every
  // state change, only on a fresh cold start / re-lock.
  const unlocked = useRef(false);
  // Monotonic token. Every applySession run captures one and drops its result
  // if a newer run started meanwhile — otherwise a slow `/me` from the previous
  // session can resolve AFTER sign-out and restore the old user's identity.
  const generation = useRef(0);
  // Lets the 401 handler call the latest signOut without re-registering it.
  const signOutRef = useRef<() => Promise<void>>(async () => undefined);

  // The API client asks for a token on every request. Wiring it here (rather
  // than importing supabase into the client) keeps the network layer free of
  // any auth-provider knowledge.
  useEffect(() => {
    setTokenProvider(getAccessToken);
    setUnauthorizedHandler(() => {
      // The API rejected a token supabase-js still believes in (revoked user,
      // rotated JWT secret). Run the full teardown via the ref so this path
      // clears the push token and local data like every other exit.
      void signOutRef.current();
    });
    return startAuthAutoRefresh();
  }, []);

  const applySession = useCallback(async (next: Session | null): Promise<void> => {
    const run = ++generation.current;
    /** True while this invocation is still the newest one. */
    const current = (): boolean => run === generation.current;

    // The WHOLE body is guarded. Previously `biometrics.isEnabled()` sat outside
    // the try, so a keychain read throw (background launch on a locked device)
    // escaped as an unhandled rejection and left `status` on 'loading' forever —
    // the app was bricked on the splash with no error and no retry.
    try {
      setSession(next);

      if (!next) {
        setUser(null);
        unlocked.current = false;
        identifyForCrashReporting(null);
        setStatus('signedOut');
        return;
      }

      if (next.user?.is_anonymous) {
        setUser({
          id: next.user.id,
          email: next.user.email ?? '',
          appRole: 'user',
          isAnonymous: true,
        });
        // A guest has no protected data at rest, so no biometric gate.
        setStatus('guest');
        return;
      }

      const gateRequired = await biometrics.isEnabled();
      if (!current()) return;
      if (gateRequired && !unlocked.current) {
        // Drop the identity while locked: anything rendering behind the gate
        // must not be able to read the previous session's user.
        setUser(null);
        setStatus('locked');
        return;
      }

      try {
        const me = await meApi.get();
        if (!current()) return;
        setUser(me);
        setError(null);
        analytics.identify(me.id);
        // Opaque id only — never the email, so a crash report cannot identify a
        // person even if the Sentry project is later shared more widely.
        identifyForCrashReporting(me.id);
        setStatus(me.isAnonymous ? 'guest' : 'authenticated');
      } catch (e) {
        if (!current()) return;
        // A failed /me does not mean signed out — it is usually the API being
        // unreachable. Keep the session and let screens show their own error
        // states rather than bouncing the user to the login screen offline.
        setError(e instanceof Error ? e.message : 'Could not verify your session');
        setStatus('authenticated');
      }
    } catch (e) {
      if (!current()) return;
      // Unknown failure resolving the session. Land on a recoverable state
      // rather than hanging on the splash screen.
      setError(e instanceof Error ? e.message : 'Could not start your session');
      setStatus('signedOut');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const sb = getSupabase();

    void (async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (active) await applySession(data.session ?? null);
      } catch {
        // getSession itself reads the keychain and can throw. An orphaned
        // rejection here was the other half of the "stuck on splash" bug.
        if (active) await applySession(null);
      }
    })();

    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      if (active) void applySession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [applySession]);

  // Re-arm the biometric gate whenever the app leaves the foreground. Without
  // this the gate was cold-start-only: hand an unlocked phone to someone and
  // they resume straight into the case data.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') unlocked.current = false;
    });
    return () => sub.remove();
  }, []);

  /**
   * Full teardown, in one place so EVERY exit path gets it — the settings
   * button, the lock screen, and the 401 auto-signout. Previously only settings
   * unregistered the push token, so the next holder of a shared phone kept
   * receiving the prior user's notifications.
   *
   * Order matters: the API calls need the token that signOut is about to
   * destroy, so they run first. Each is best-effort — a failure to clean up
   * must not prevent the user from actually signing out.
   */
  const signOut = useCallback(async (): Promise<void> => {
    analytics.track('auth.signed_out');
    const userId = user?.id ?? null;

    await unregisterFromPush().catch(() => undefined);
    if (userId) {
      await offlineQueue.clear(userId).catch(() => undefined);
      await drafts
        .clearAllForUser(userId, ['eligibility.input', 'eligibility.description'])
        .catch(() => undefined);
    }
    analytics.__reset();
    identifyForCrashReporting(null);
    unlocked.current = false;
    await getSupabase().auth.signOut();
  }, [user?.id]);

  // Assigned in an effect, never during render.
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  const refresh = useCallback(async (): Promise<void> => {
    const { data } = await getSupabase().auth.getSession();
    await applySession(data.session ?? null);
  }, [applySession]);

  const unlock = useCallback(async (): Promise<boolean> => {
    const ok = await biometrics.authenticate('Unlock VisaAI');
    if (!ok) return false;
    unlocked.current = true;
    await refresh();
    return true;
  }, [refresh]);

  const value = useMemo<SessionState>(
    () => ({ status, session, user, error, signOut, refresh, unlock }),
    [status, session, user, error, signOut, refresh, unlock],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
