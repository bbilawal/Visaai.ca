import 'react-native-url-polyfill/auto';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';
import { env } from '@/config/env';
import { secureStorage } from '@/storage/secure-store';

/**
 * Supabase client for React Native.
 *
 * Mirrors apps/web/lib/supabase/client.ts on purpose: the *same* Supabase
 * project, the same anon key, the same auth model (email+password, OAuth,
 * anonymous guest sessions, native TOTP MFA). The mobile-specific parts are:
 *
 *  - storage: the chunked SecureStore adapter instead of browser localStorage
 *    (see src/storage/secure-store.ts) so tokens live in the keychain;
 *  - detectSessionInUrl: false — there is no URL bar; OAuth returns through the
 *    app scheme and is exchanged explicitly in src/auth/oauth.ts;
 *  - autoRefreshToken driven by AppState — JS timers are frozen while the app
 *    is backgrounded, so refresh is paused/resumed on foreground transitions.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        storage: secureStorage,
        storageKey: 'visaai.auth',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

/** Test seam — drops the memoized client so each test gets a clean instance. */
export function __resetSupabaseForTests(): void {
  client = null;
}

let appStateSub: { remove: () => void } | null = null;

/**
 * Without this, a token that expires while the app is backgrounded is never
 * refreshed and the first request after resume 401s. supabase-js exposes
 * start/stopAutoRefresh precisely for this lifecycle.
 */
export function startAuthAutoRefresh(): () => void {
  const sb = getSupabase();
  const onChange = (state: AppStateStatus): void => {
    if (state === 'active') void sb.auth.startAutoRefresh();
    else void sb.auth.stopAutoRefresh();
  };
  onChange(AppState.currentState);
  appStateSub = AppState.addEventListener('change', onChange);
  return () => {
    appStateSub?.remove();
    appStateSub = null;
    void sb.auth.stopAutoRefresh();
  };
}

/**
 * Current access token or null. Every authenticated call funnels through here
 * so there is exactly one place that decides what "the token" is — supabase-js
 * refreshes transparently when the cached session is near expiry.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session ?? null;
}
