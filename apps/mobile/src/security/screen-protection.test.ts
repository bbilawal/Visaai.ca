import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { disableScreenProtection, enableScreenProtection } from './screen-protection';

const prevent = ScreenCapture.preventScreenCaptureAsync as jest.Mock;
const allow = ScreenCapture.allowScreenCaptureAsync as jest.Mock;
const enableSwitcher = ScreenCapture.enableAppSwitcherProtectionAsync as jest.Mock;
const disableSwitcher = ScreenCapture.disableAppSwitcherProtectionAsync as jest.Mock;

function setPlatform(os: 'ios' | 'android'): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

describe('screen protection', () => {
  beforeEach(() => {
    [prevent, allow, enableSwitcher, disableSwitcher].forEach((m) => {
      m.mockReset();
      m.mockResolvedValue(undefined);
    });
  });

  it('blocks capture on Android (FLAG_SECURE also blanks the recents preview)', async () => {
    setPlatform('android');
    await expect(enableScreenProtection()).resolves.toBe(true);
    expect(prevent).toHaveBeenCalledWith('visaai-app-wide');
    // iOS-only API must not be called on Android.
    expect(enableSwitcher).not.toHaveBeenCalled();
  });

  it('blocks capture AND blurs the app switcher on iOS', async () => {
    setPlatform('ios');
    await expect(enableScreenProtection()).resolves.toBe(true);
    expect(prevent).toHaveBeenCalled();
    expect(enableSwitcher).toHaveBeenCalledWith(0.85);
  });

  it('never throws when the native module is unavailable', async () => {
    setPlatform('ios');
    prevent.mockRejectedValue(new Error('unavailable on simulator'));
    // Degraded privacy is acceptable; a crash on launch is not.
    await expect(enableScreenProtection()).resolves.toBe(false);
  });

  it('reports failure when only the switcher blur fails', async () => {
    setPlatform('ios');
    enableSwitcher.mockRejectedValue(new Error('iOS < 13'));
    await expect(enableScreenProtection()).resolves.toBe(false);
    expect(prevent).toHaveBeenCalled();
  });

  it('releases both mechanisms on disable', async () => {
    setPlatform('ios');
    await disableScreenProtection();
    expect(allow).toHaveBeenCalledWith('visaai-app-wide');
    expect(disableSwitcher).toHaveBeenCalled();
  });

  it('disable never throws', async () => {
    setPlatform('android');
    allow.mockRejectedValue(new Error('boom'));
    await expect(disableScreenProtection()).resolves.toBeUndefined();
  });
});
