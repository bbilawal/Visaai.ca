import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

/**
 * Screen-content protection.
 *
 * Closes the gap flagged in VISAAIDocs/mobile/security.md §6: the OS writes a snapshot
 * of the foreground screen to disk for the app switcher, and screenshots/screen
 * recordings can capture a passport scan or a case detail. For an app that
 * displays immigration documents, both are real exposures on a shared, borrowed,
 * or inspected device.
 *
 * Two mechanisms, deliberately both:
 *
 *  - `preventScreenCaptureAsync()` — on Android sets `FLAG_SECURE`, which blocks
 *    screenshots AND blanks the recents preview in one go. On iOS it blocks
 *    screen recordings (11+) and screenshots (13+).
 *  - `enableAppSwitcherProtectionAsync()` — iOS only; blurs the app-switcher and
 *    background snapshot, which `FLAG_SECURE` covers on Android but iOS does not.
 *
 * Applied app-wide rather than per screen: nearly every authenticated screen
 * shows case data, and an allowlist would inevitably miss one.
 *
 * Both calls are best-effort. A simulator, an unsupported OS version, or a
 * missing native module must never stop the app from starting — losing a blur
 * is a degraded state, a crash on launch is an outage.
 */
const KEY = 'visaai-app-wide';

export async function enableScreenProtection(): Promise<boolean> {
  let ok = true;

  try {
    await ScreenCapture.preventScreenCaptureAsync(KEY);
  } catch {
    ok = false;
  }

  if (Platform.OS === 'ios') {
    try {
      // 0.85 — heavy enough that text is unreadable in the switcher thumbnail,
      // while the app is still recognisable to the person switching to it.
      await ScreenCapture.enableAppSwitcherProtectionAsync(0.85);
    } catch {
      ok = false;
    }
  }

  return ok;
}

/**
 * Release the protection. Only for a deliberate, user-initiated exception (for
 * example a future "share my checklist" screen). Not called during normal use.
 */
export async function disableScreenProtection(): Promise<void> {
  try {
    await ScreenCapture.allowScreenCaptureAsync(KEY);
    if (Platform.OS === 'ios') {
      await ScreenCapture.disableAppSwitcherProtectionAsync();
    }
  } catch {
    // Best-effort by design.
  }
}
