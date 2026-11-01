import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Env-aware Expo config. `APP_ENV` selects the variant so development, test,
 * staging and production produce *distinct installable apps* (own bundle id,
 * own icon badge text, own deep-link host) and can coexist on one device.
 *
 *   APP_ENV=staging pnpm --filter mobile start
 *
 * Runtime values are NOT baked here beyond non-secret public config: the app
 * reads `EXPO_PUBLIC_*` at runtime (see src/config/env.ts). Never put service
 * keys, Stripe secrets, or VAPID private keys in this file — everything in
 * `extra` ships inside the binary and is readable by anyone.
 */
type AppEnv = 'development' | 'test' | 'staging' | 'production';

const APP_ENV = (process.env.APP_ENV ?? 'development') as AppEnv;

interface Variant {
  name: string;
  bundleId: string;
  scheme: string;
  /** Universal-link / App-Link host. Empty string disables verified links. */
  linkHost: string;
}

const VARIANTS: Record<AppEnv, Variant> = {
  development: {
    name: 'VisaAI (Dev)',
    bundleId: 'co.visaai.app.dev',
    scheme: 'visaai-dev',
    linkHost: '',
  },
  test: {
    name: 'VisaAI (Test)',
    bundleId: 'co.visaai.app.test',
    scheme: 'visaai-test',
    linkHost: '',
  },
  staging: {
    name: 'VisaAI (Staging)',
    bundleId: 'co.visaai.app.staging',
    scheme: 'visaai-staging',
    linkHost: 'staging.visaai.co',
  },
  production: {
    name: 'VisaAI',
    bundleId: 'co.visaai.app',
    scheme: 'visaai',
    linkHost: 'visaai.co',
  },
};

const v = VARIANTS[APP_ENV] ?? VARIANTS.development;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: v.name,
  slug: 'visaai',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: v.scheme,
  userInterfaceStyle: 'light',
  // No `newArchEnabled`: the New Architecture is the only architecture from
  // SDK 55 onward, and the key was removed from ExpoConfig.
  // Monad `paper-canvas` — matches apps/web globals.css so the launch surface
  // does not flash a different colour than the first rendered screen.
  backgroundColor: '#f6f3f1',
  // PLACEHOLDER ARTWORK. These are flat brand-colour marks generated so the app
  // does not ship the stock Expo icon and so `prebuild`/EAS have real assets to
  // process. They are NOT final: design must supply a 1024x1024 icon, an Android
  // adaptive foreground, and a splash mark before store submission.
  icon: './assets/icon.png',
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: v.bundleId,
    supportsTablet: true,
    // Verified universal links. The apple-app-site-association file must be
    // served by the web app before these resolve (see VISAAIDocs/mobile/ios-release.md).
    associatedDomains: v.linkHost ? [`applinks:${v.linkHost}`] : undefined,
    infoPlist: {
      // Immigration documents are sensitive: no arbitrary cleartext loads.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      ITSAppUsesNonExemptEncryption: false,
      NSFaceIDUsageDescription:
        'Unlock VisaAI with Face ID so your immigration data stays protected.',
      NSCameraUsageDescription:
        'Take photos of your immigration documents to upload them to your application.',
      NSPhotoLibraryUsageDescription:
        'Choose existing photos or scans of your immigration documents to upload.',
      // No NSMicrophoneUsageDescription: the app has no voice-recording UI.
      // Declaring a purpose string for a capability that is never used invites
      // an App Review question we cannot answer, and asks the user to trust us
      // with something we do not need.
    },
  },
  android: {
    package: v.bundleId,
    adaptiveIcon: {
      // Without a foregroundImage the adaptiveIcon block has NO effect and the
      // stock icon ships.
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#f6f3f1',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.USE_BIOMETRIC',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
    // Expo modules merge permissions we never asked for into the built
    // manifest. Verified by running `expo prebuild` and reading
    // android/app/src/main/AndroidManifest.xml — the declared list above is NOT
    // what ships. These two are removed with tools:node="remove":
    //   RECORD_AUDIO      — pulled in by expo-image-picker for video capture,
    //                       which this app does not use.
    //   SYSTEM_ALERT_WINDOW — React Native's dev menu overlay. Shipping
    //                       "draw over other apps" on an app that holds
    //                       immigration documents is an unjustifiable ask and a
    //                       Play review risk.
    // READ/WRITE_EXTERNAL_STORAGE are intentionally KEPT: expo-image-picker
    // needs them to read the photo library on Android <= 12, and they are
    // already scoped with maxSdkVersion="32" so they do not apply on 13+.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    // Verified App Links. assetlinks.json is served by the web app from
    // apps/web/app/.well-known/assetlinks.json/route.ts, which needs
    // ANDROID_CERT_FINGERPRINTS set in the web deployment or it 404s and
    // verification fails silently (MOB-001).
    //
    // Paths are scoped (MOB-002). `pathPrefix: '/'` claimed the ENTIRE domain,
    // so once verification succeeded every visaai.co URL — pricing, privacy,
    // the marketing root — would have been yanked out of the browser and into
    // the app. Only paths with a real in-app destination are claimed. Keep this
    // list in sync with DEEP_LINK_PATHS in the apple-app-site-association route.
    intentFilters: v.linkHost
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              { scheme: 'https', host: v.linkHost, pathPrefix: '/applications' },
              { scheme: 'https', host: v.linkHost, pathPrefix: '/my-applications' },
              { scheme: 'https', host: v.linkHost, pathPrefix: '/messages' },
              { scheme: 'https', host: v.linkHost, pathPrefix: '/invite' },
              { scheme: 'https', host: v.linkHost, pathPrefix: '/reset-password' },
            ],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : undefined,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        backgroundColor: '#f6f3f1',
        resizeMode: 'contain',
        imageWidth: 160,
      },
    ],
    [
      'expo-notifications',
      { color: '#000000', defaultChannel: 'default' },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Choose existing photos or scans of your immigration documents to upload.',
        cameraPermission:
          'Take photos of your immigration documents to upload them to your application.',
      },
    ],
    // Wires the native Sentry SDK into the iOS/Android projects. Without the
    // plugin the JS SDK is present but native crashes are never captured.
    '@sentry/react-native/expo',
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'Unlock VisaAI with Face ID so your immigration data stays protected.',
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    appEnv: APP_ENV,
    linkHost: v.linkHost,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? undefined },
  },
});
