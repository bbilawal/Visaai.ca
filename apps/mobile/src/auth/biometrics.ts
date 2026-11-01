import * as LocalAuthentication from 'expo-local-authentication';
import { secureStorage } from '@/storage/secure-store';

/**
 * Biometric app lock (Face ID / Touch ID / Android BiometricPrompt).
 *
 * Deliberately a *local gate*, not an authentication factor: the Supabase
 * session in the keychain is what proves identity to the API. Biometrics only
 * decide whether this device's holder may use the already-stored session, which
 * is the right model for a shared or borrowed phone. Treating a fingerprint as
 * a credential would be false security — the OS returns a boolean we cannot
 * verify server-side.
 *
 * The preference flag lives in SecureStore rather than AsyncStorage: on a rooted
 * device, flipping a plaintext "biometricsEnabled=false" would silently disable
 * the gate.
 */
const PREF_KEY = 'visaai.biometricLock';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export const biometrics = {
  /** Hardware present AND at least one biometric enrolled. */
  async isAvailable(): Promise<boolean> {
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && enrolled;
  },

  async kind(): Promise<BiometricKind> {
    if (!(await this.isAvailable())) return 'none';
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
    return 'none';
  },

  async isEnabled(): Promise<boolean> {
    let stored: string | null = null;
    try {
      stored = await secureStorage.getItem(PREF_KEY);
    } catch {
      // The keychain can be unreadable — most importantly when the app is
      // launched into the BACKGROUND by a push while the device is locked.
      // Fail CLOSED: assume the gate is on. Returning false here would silently
      // disable the lock at exactly the moment the device is most exposed.
      return true;
    }
    if (stored !== 'true') return false;

    // The user opted in, so the gate stands even if biometric enrolment was
    // later removed: `authenticate()` runs with disableDeviceFallback:false, so
    // the device passcode can still satisfy it. Treating "no enrolment" as "no
    // gate" turned a deliberate security choice off without telling anyone.
    return true;
  },

  /** Enabling requires passing the prompt once, proving it works on this device. */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      await secureStorage.removeItem(PREF_KEY);
      return true;
    }
    if (!(await this.isAvailable())) return false;
    const ok = await this.authenticate('Enable biometric unlock');
    if (!ok) return false;
    await secureStorage.setItem(PREF_KEY, 'true');
    return true;
  },

  async authenticate(promptMessage: string): Promise<boolean> {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        // Allow the device passcode: biometrics can fail for physical reasons
        // (wet hands, a mask) and the passcode is an equally strong local gate.
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });
      return result.success;
    } catch {
      // A thrown prompt (no enrolment, hardware busy) must fail closed.
      return false;
    }
  },
};
