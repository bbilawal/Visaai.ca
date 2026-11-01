import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { biometrics } from './biometrics';
import { scorePassword } from './password';

const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const hasHardware = LocalAuthentication.hasHardwareAsync as jest.Mock;
const isEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;
const authenticate = LocalAuthentication.authenticateAsync as jest.Mock;

describe('biometrics', () => {
  beforeEach(() => {
    secureStore.clear();
    hasHardware.mockResolvedValue(true);
    isEnrolled.mockResolvedValue(true);
    authenticate.mockResolvedValue({ success: true });
  });

  it('is unavailable without hardware', async () => {
    hasHardware.mockResolvedValue(false);
    expect(await biometrics.isAvailable()).toBe(false);
  });

  it('is unavailable when nothing is enrolled', async () => {
    isEnrolled.mockResolvedValue(false);
    expect(await biometrics.isAvailable()).toBe(false);
  });

  it('stores the opt-in flag in the keychain, not plain storage', async () => {
    await biometrics.setEnabled(true);
    expect(secureStore.get('visaai.biometricLock')).toBe('true');
  });

  it('requires passing the prompt before enabling', async () => {
    authenticate.mockResolvedValue({ success: false });
    expect(await biometrics.setEnabled(true)).toBe(false);
    expect(secureStore.has('visaai.biometricLock')).toBe(false);
  });

  it('KEEPS the gate when enrolment is removed — passcode can still satisfy it', async () => {
    await biometrics.setEnabled(true);
    isEnrolled.mockResolvedValue(false);
    // Previously this returned false, silently disabling a lock the user
    // deliberately turned on. `authenticate()` runs with
    // disableDeviceFallback:false, so the device passcode still works.
    expect(await biometrics.isEnabled()).toBe(true);
  });

  it('fails CLOSED when the keychain cannot be read', async () => {
    // Happens when the app is launched into the background by a push while the
    // device is locked. Assuming "off" would disable the lock exactly when the
    // device is most exposed.
    const store = jest.requireMock('expo-secure-store') as {
      getItemAsync: jest.Mock;
    };
    store.getItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));
    expect(await biometrics.isEnabled()).toBe(true);
  });

  it('fails closed when the OS prompt throws', async () => {
    authenticate.mockRejectedValue(new Error('hardware busy'));
    expect(await biometrics.authenticate('Unlock')).toBe(false);
  });

  it('clears the flag when disabled', async () => {
    await biometrics.setEnabled(true);
    await biometrics.setEnabled(false);
    expect(secureStore.has('visaai.biometricLock')).toBe(false);
  });

  it('offers the device passcode as a fallback', async () => {
    await biometrics.authenticate('Unlock');
    expect(authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });
});

describe('scorePassword', () => {
  it('rejects an empty or short password', () => {
    expect(scorePassword('').score).toBe(0);
    expect(scorePassword('abc123').score).toBe(0);
  });

  it('rejects a well-known password even at sufficient length', () => {
    expect(scorePassword('password1').score).toBe(0);
    expect(scorePassword('PASSWORD1').score).toBe(0);
  });

  it('scores a mixed password above the signup threshold', () => {
    expect(scorePassword('Tr0ubadour!x').score).toBeGreaterThanOrEqual(2);
  });

  it('does not punish a long passphrase for lacking symbols', () => {
    expect(scorePassword('correct horse battery staple').score).toBeGreaterThanOrEqual(3);
  });

  it('always returns actionable feedback', () => {
    for (const candidate of ['', 'short', 'password1', 'Abcdef12', 'S0me!LongerPassphrase']) {
      expect(scorePassword(candidate).feedback.length).toBeGreaterThan(0);
    }
  });
});
