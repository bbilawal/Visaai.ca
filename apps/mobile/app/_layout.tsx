import React, { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, router, usePathname, useRootNavigationState, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '@/auth/session';
import { I18nProvider } from '@/i18n/i18n';
import { analytics, loadAnonymousId, flush } from '@/analytics/analytics';
import { startNetworkMonitor } from '@/offline/network';
import { offlineQueue } from '@/offline/queue';
import { configureForegroundHandler, subscribeToNotifications } from '@/notifications/push';
import { enableScreenProtection } from '@/security/screen-protection';
import { initCrashReporting } from '@/observability/crash-reporting';
import { assertTransportSecurity, missingRequiredConfig } from '@/config/env';
import { Banner, Loading, Screen, Txt } from '@/components/ui';
import { ErrorBoundary } from '@/components/error-boundary';
import type { Destination } from '@/notifications/routing';
import { colors } from '@/theme/tokens';

/**
 * A protected deep-link target that arrived before the session was known.
 * Module-scoped so the notification subscriber (AppLifecycle) and the guard
 * (RouteGuard) share one slot without prop-drilling through providers.
 */
const pendingDestination: { current: Destination | null } = { current: null };

/**
 * Root layout: providers, app-lifecycle wiring, and the single route guard.
 *
 * The guard lives here (not in each screen) so there is exactly one place that
 * decides where an unauthenticated user may be. Screens can then assume a
 * session exists instead of each re-implementing a redirect.
 */
function RouteGuard({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status } = useSession();
  const segments = useSegments();
  // Navigating before the root navigator mounts throws; expo-router exposes
  // this state so the first redirect can wait for it.
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key) return;
    if (status === 'loading') return;

    const group = segments[0];
    const inAuthGroup = group === '(auth)';
    // Exact segment match: a substring test would treat a future route like
    // /applications/blocked as the lock screen.
    const inLockScreen = segments.includes('locked');

    if (status === 'locked' && !inLockScreen) {
      router.replace('/(auth)/locked');
      return;
    }
    if (status === 'signedOut' && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
      return;
    }
    // A guest (anonymous Supabase identity) is allowed into the app shell —
    // the same model apps/web uses for the public intake funnel. Screens that
    // need a real account gate themselves.
    if ((status === 'authenticated' || status === 'guest') && (inAuthGroup || inLockScreen)) {
      router.replace('/(app)/dashboard');
      return;
    }

    // Session is settled — deliver any deep link that arrived while it was not.
    if (status === 'authenticated' && pendingDestination.current) {
      const destination = pendingDestination.current;
      pendingDestination.current = null;
      router.push({ pathname: destination.pathname, params: destination.params } as never);
    }
  }, [status, segments, navigationState?.key]);

  if (status === 'loading') return <Loading label="Starting VisaAI" />;

  // Gate on RENDER, not only in the effect. Redirecting from an effect still
  // paints the protected screen (and fires its data fetches) for a frame or
  // two first — the lock screen is a security boundary and must not lose that
  // race to a deep link.
  const group = segments[0];
  const showingAuth = group === '(auth)';
  if ((status === 'locked' || status === 'signedOut') && !showingAuth) {
    return <Loading label="Starting VisaAI" />;
  }

  return <>{children}</>;
}

/**
 * Emits one `screen.viewed` per navigation. Centralised here so a new route is
 * covered the moment it exists — per-screen tracking calls are the reliable way
 * to end up with a funnel that is silently missing a step.
 *
 * `usePathname()` returns the route *pattern* with parameters unresolved
 * (`/applications/[id]`), which is exactly what the PII policy requires: no
 * application id ever reaches the analytics pipeline via a path.
 */
function ScreenTracking(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    analytics.screen(pathname);
  }, [pathname]);

  return null;
}

function AppLifecycle(): null {
  const { user } = useSession();
  // Read through a ref so the lifecycle effect stays mount-only while still
  // seeing the current user.
  const userIdRef = useRef<string | null>(null);
  // Assigned in an effect, never during render.
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    void loadAnonymousId().then(() => analytics.startSession());
    configureForegroundHandler();
    // No-op unless EXPO_PUBLIC_SENTRY_DSN is set, so dev and CI stay silent.
    initCrashReporting();
    // Blocks screenshots, screen recordings, and the app-switcher snapshot.
    // Best-effort: a failure here degrades privacy, it must not stop startup.
    void enableScreenProtection();
    const stopNetwork = startNetworkMonitor();
    const stopAutoFlush = offlineQueue.startAutoFlush(() => userIdRef.current);

    const stopNotifications = subscribeToNotifications({
      onNavigate: (destination) => {
        // The destination is validated + allowlisted (routing.ts). Protected
        // targets are PARKED rather than pushed: navigating first and letting
        // the guard bounce means the protected screen mounts and fetches before
        // the session is known. The guard replays it once status settles.
        if (destination.requiresAuth) {
          pendingDestination.current = destination;
          return;
        }
        router.push({ pathname: destination.pathname, params: destination.params } as never);
      },
    });

    const onAppState = (state: AppStateStatus): void => {
      if (state === 'active') {
        const userId = userIdRef.current;
        if (userId) void offlineQueue.flush(userId);
      } else {
        // Backgrounding can be followed by termination with no further JS, so
        // buffered analytics are sent now rather than lost.
        void flush();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      stopNetwork();
      stopAutoFlush();
      stopNotifications();
      sub.remove();
      analytics.endSession();
    };
  }, []);

  return null;
}

/**
 * Config is validated once, lazily, outside React. It depends only on build-time
 * env, so deriving it in a state initializer (instead of an effect that calls
 * setState) avoids a render → setState → re-render cascade before first paint.
 */
function readConfigError(): string[] | null {
  const missing = missingRequiredConfig();
  if (missing.length) return missing;
  // Throwing would crash before any UI could explain why, so the failure is
  // surfaced as a screen instead.
  try {
    assertTransportSecurity();
    return null;
  } catch (e) {
    return [(e as Error).message];
  }
}

export default function RootLayout(): React.ReactElement {
  const [configError] = useState<string[] | null>(readConfigError);

  if (configError) {
    return (
      <SafeAreaProvider>
        <Screen testID="config-error">
          <Txt variant="title">Configuration problem</Txt>
          <Banner
            tone="error"
            title="This build is missing required configuration"
            body={configError.join(', ')}
          />
          <Txt variant="caption" color={colors.paleStone}>
            See VISAAIDocs/mobile/setup.md for the required EXPO_PUBLIC_* values.
          </Txt>
        </Screen>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <AppLifecycle />
          <ScreenTracking />
          <StatusBar style="dark" />
          <ErrorBoundary>
            <RouteGuard>
              <Stack
                screenOptions={{
                  // Headers ON for non-tab routes: with them hidden there was no
                  // back control anywhere, so a deep link stranded the user.
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.paperCanvas },
                }}
              />
            </RouteGuard>
          </ErrorBoundary>
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
