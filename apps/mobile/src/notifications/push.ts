import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationsApi } from '@/api/endpoints';
import { analytics, EVENTS } from '@/analytics/analytics';
import { destinationFromPushData, type Destination } from './routing';

/**
 * Push notification registration and handling.
 *
 * Delivery path: API → Expo Push Service → APNs/FCM → device. The token is
 * registered against the signed-in user via POST /notifications/devices and
 * removed on sign-out, because a device token left registered keeps delivering
 * the *previous* user's notifications to whoever holds the phone.
 *
 * PRIVACY: notification content is authored server-side and deliberately
 * generic (see NotificationDispatchService). The app never adds case detail to
 * a local notification either — a lock screen is a public surface.
 */
const LAST_TOKEN_KEY = 'visaai.pushToken';

export type PermissionOutcome = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/**
 * Foreground presentation. Alerts are shown but content still comes from the
 * server payload, so nothing sensitive is introduced client-side.
 */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

export async function getPermissionStatus(): Promise<PermissionOutcome> {
  if (!Device.isDevice) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Ask for permission. Call this from a screen that has explained *why* —
 * a cold OS prompt on first launch is the reliable way to get denied forever.
 */
export async function requestPermission(): Promise<PermissionOutcome> {
  if (!Device.isDevice) return 'unsupported';
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return 'granted';
  // iOS only allows one prompt ever; if it was denied, the user must go to
  // Settings, so do not burn the request on a re-ask that cannot show UI.
  if (existing.status === 'denied' && !existing.canAskAgain) return 'denied';
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Application updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    // Content hidden on a locked screen: the notification still arrives, but a
    // passer-by does not read it. The app shows the detail after unlock.
    // SECRET (=3). `0` is UNKNOWN — the previous value did NOT hide anything,
    // inverting the stated privacy guarantee.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    showBadge: true,
  });
}

/**
 * Register this device for push. Idempotent — safe to call on every foreground.
 * Returns the token, or null when unavailable (simulator, denied permission).
 */
export async function registerForPush(): Promise<string | null> {
  const permission = await getPermissionStatus();
  if (permission !== 'granted') return null;

  await ensureAndroidChannel();

  try {
    // getExpoPushTokenAsync REQUIRES a projectId in a real build; without it it
    // throws "No projectId found" and the bare catch below silently returned
    // null, so push was dead with zero signal.
    const projectId =
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) {
      // Loud in dev, harmless in prod: no token is obtainable, and pretending
      // otherwise hides a misconfigured build until users report silence.
      console.warn('[push] no EAS projectId configured — push token unavailable');
      return null;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const previous = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    // Re-register on every cold start anyway: the row's last_seen_at drives
    // stale-token pruning server-side, and a silent APNs token rotation would
    // otherwise leave the user unreachable.
    await notificationsApi.registerDevice({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceName: Device.modelName ?? null,
      appVersion: Application.nativeApplicationVersion ?? null,
    });

    if (previous && previous !== token) {
      // Token rotated: drop the old row so we stop pushing into the void.
      await notificationsApi.unregisterDevice(previous).catch(() => undefined);
    }
    await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
    analytics.track(EVENTS.pushRegistered, { platform: Platform.OS });
    return token;
  } catch {
    // Push is an enhancement; failing to register must never block app start.
    return null;
  }
}

/** Remove this device's registration. Always call on sign-out. */
export async function unregisterFromPush(): Promise<void> {
  const token = await AsyncStorage.getItem(LAST_TOKEN_KEY);
  if (!token) return;
  await notificationsApi.unregisterDevice(token).catch(() => undefined);
  await AsyncStorage.removeItem(LAST_TOKEN_KEY);
}

/**
 * Subscribe to taps (background + quit) and foreground arrivals.
 * `onNavigate` receives an already-validated destination — see routing.ts.
 */
export function subscribeToNotifications(handlers: {
  onNavigate: (destination: Destination) => void;
  onForeground?: (title: string | null, body: string | null) => void;
}): () => void {
  const received = Notifications.addNotificationReceivedListener((notification) => {
    const content = notification.request.content;
    handlers.onForeground?.(content.title ?? null, content.body ?? null);
  });

  // expo-notifications REPLAYS the launch response to a newly added listener,
  // and getLastNotificationResponseAsync returns it too. Both paths fired for a
  // single tap, navigating twice. Dedupe on the notification identifier.
  const handled = new Set<string>();
  const navigateOnce = (response: Notifications.NotificationResponse): void => {
    const id = response.notification.request.identifier;
    if (id && handled.has(id)) return;
    if (id) handled.add(id);
    analytics.track(EVENTS.pushOpened);
    handlers.onNavigate(destinationFromPushData(response.notification.request.content.data));
  };

  const responded = Notifications.addNotificationResponseReceivedListener(navigateOnce);

  // Cold start from a notification tap: on some paths the listener above is
  // added after the response was already delivered.
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) navigateOnce(response);
  });

  return () => {
    received.remove();
    responded.remove();
  };
}
