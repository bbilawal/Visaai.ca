/**
 * Test environment shims. Native modules are unavailable under jest-expo's
 * JSDOM/node environment, so anything that touches the platform is mocked to a
 * deterministic in-memory implementation. Mocks are intentionally *behavioural*
 * (a real Map-backed store) rather than jest.fn() no-ops so the tests exercise
 * our chunking / eviction / expiry logic instead of asserting on call counts.
 */
// No `@testing-library/react-native/extend-expect` import: RNTL ships its
// matchers built in from v12.4, and that entry point no longer exists in v14.

// ── expo-secure-store → in-memory keychain with the real 2048-byte limit ──
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  const LIMIT = 2048;
  return {
    __store: store,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      if (v.length > LIMIT) {
        throw new Error(`Value too large for SecureStore (${v.length} > ${LIMIT})`);
      }
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    getAllKeys: jest.fn(async () => Array.from(store.keys())),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((k) => store.delete(k));
    }),
  };
});

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [2]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
  modelName: 'jest-device',
  osName: 'jest',
  osVersion: '1.0',
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.1.0',
  nativeBuildVersion: '1',
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US', regionCode: 'US' }],
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
  openAuthSessionAsync: jest.fn(async () => ({ type: 'success', url: 'visaai://callback' })),
  dismissBrowser: jest.fn(),
}));

// Must return a DISTINCT value per call. A constant stub silently made every
// queued item and every optimistic message share an id, which hid real
// id-collision bugs (and produced a false pass on queue dedupe).
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    },
  };
});

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
  enableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
  disableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
  isAvailableAsync: jest.fn(async () => true),
}));

// NOTE: no TS generics or type annotations inside a jest.mock factory — babel's
// out-of-scope-variable guard reads a type parameter like `(s: unknown) => void`
// as a reference to a variable `s` and fails the whole suite.
jest.mock('@react-native-community/netinfo', () => {
  const listeners = new Set<any>();
  let state = { isConnected: true, isInternetReachable: true, type: 'wifi' };
  return {
    __setState: (next: any) => {
      state = next;
      listeners.forEach((l: any) => l(state));
    },
    fetch: jest.fn(async () => state),
    addEventListener: jest.fn((cb: any) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
  };
});


// Silence the Reanimated/worklets warning banner in test output.
jest.mock('react-native-worklets', () => ({}), { virtual: true });
