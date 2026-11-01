import React, { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { router } from 'expo-router';
import { meApi, notificationsApi, privacyApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useSession } from '@/auth/session';
import { useI18n } from '@/i18n/i18n';
import { isApiError } from '@/api/errors';
import { biometrics } from '@/auth/biometrics';
import {
  getPermissionStatus,
  registerForPush,
  requestPermission,
  unregisterFromPush,
} from '@/notifications/push';
import { drafts } from '@/offline/drafts';
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/messages';
import { Banner, Button, Card, Field, Loading, Screen, Txt } from '@/components/ui';
import { colors, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';

/**
 * Profile, preferences, security and privacy.
 *
 * Privacy controls are wired to the real GDPR/PIPEDA endpoints added in
 * prod-hardening wave 2 (GET /me/privacy/export, POST /me/privacy/delete).
 * Deletion is irreversible and cascades across every user-owned table, so it
 * requires the user to type DELETE — the same confirmation the API demands.
 */
function Row({
  label,
  hint,
  value,
  onValueChange,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  testID?: string;
}): React.ReactElement {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: MIN_TOUCH_TARGET,
        gap: spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Txt variant="label">{label}</Txt>
        {hint ? (
          <Txt variant="caption" color={colors.paleStone}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        accessibilityRole="switch"
        testID={testID}
      />
    </View>
  );
}

export default function SettingsScreen(): React.ReactElement {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut } = useSession();

  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [pushGranted, setPushGranted] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prefs = useAsync(() => notificationsApi.preferences(), 'notification-prefs');

  useEffect(() => {
    void (async () => {
      setBiometricAvailable(await biometrics.isAvailable());
      setBiometricEnabled(await biometrics.isEnabled());
      setPushGranted((await getPermissionStatus()) === 'granted');
    })();
  }, []);

  const toggleBiometrics = async (next: boolean): Promise<void> => {
    const ok = await biometrics.setEnabled(next);
    // Enabling requires passing the prompt once, so a failed attempt must not
    // leave the switch showing "on".
    setBiometricEnabled(ok && next);
    if (!ok && next) setError('Could not enable biometric unlock.');
  };

  const togglePush = async (next: boolean): Promise<void> => {
    if (next) {
      const outcome = await requestPermission();
      setPushGranted(outcome === 'granted');
      if (outcome === 'denied') {
        setError('Notifications are blocked. Enable them in your device settings.');
        return;
      }
      // Granting permission is not registration. The layout effect that
      // registers is keyed on session status, which has not changed here, so
      // without this call no token reached the API until the next cold start.
      if (outcome === 'granted') {
        await registerForPush();
        await notificationsApi.updatePreferences({ push_enabled: true }).catch(() => undefined);
        await prefs.refresh();
      }
      return;
    }
    // Turning off in-app updates the server preference; the OS-level permission
    // stays as the user set it.
    await notificationsApi.updatePreferences({ push_enabled: false }).catch(() => undefined);
    await prefs.refresh();
  };

  const changeLanguage = async (next: Locale): Promise<void> => {
    await setLocale(next);
    // Mirror to the account so web and email pick up the same language.
    await meApi.setLanguage(next).catch(() => undefined);
  };

  const exportData = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await privacyApi.export();
      setMessage('Your data export is ready — check your email.');
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async (): Promise<void> => {
    if (deleteConfirm !== 'DELETE') return;
    setBusy(true);
    setError(null);
    try {
      await privacyApi.requestDeletion();
      // Local traces go too: leaving drafts and a push registration behind after
      // an erasure request would defeat the point.
      if (user?.id) {
        await drafts.clearAllForUser(user.id, ['eligibility.description']);
      }
      await unregisterFromPush();
      await signOut();
      router.replace('/(auth)/sign-in');
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // Teardown (push token, drafts, queue) lives in SessionProvider.signOut so
  // every exit path gets it — this screen, the lock screen, and the 401 handler.
  const handleSignOut = async (): Promise<void> => {
    await signOut();
  };

  if (prefs.loading && !prefs.data) return <Loading label={t('common.loading')} />;

  return (
    <Screen testID="settings-screen">
      <Txt variant="display">{t('settings.title')}</Txt>

      {message ? <Banner tone="success" title={message} /> : null}
      {error ? <Banner tone="error" title={error} /> : null}

      <Card testID="profile-card">
        <Txt variant="heading">{t('settings.profile')}</Txt>
        <Txt variant="body" color={colors.paleStone}>
          {user?.email || 'Guest'}
        </Txt>
      </Card>

      <Card testID="security-card">
        <Txt variant="heading">{t('settings.security')}</Txt>
        {biometricAvailable ? (
          <Row
            label={t('settings.biometrics')}
            hint="Require Face ID / fingerprint to open the app."
            value={biometricEnabled}
            onValueChange={(next) => void toggleBiometrics(next)}
            testID="biometric-switch"
          />
        ) : (
          <Txt variant="caption" color={colors.paleStone}>
            Biometrics are not set up on this device.
          </Txt>
        )}
      </Card>

      <Card testID="notifications-card">
        <Txt variant="heading">{t('settings.notifications')}</Txt>
        <Row
          label="Push notifications"
          value={pushGranted && (prefs.data?.push_enabled ?? true)}
          onValueChange={(next) => void togglePush(next)}
          testID="push-switch"
        />
        <Row
          label="Email notifications"
          value={prefs.data?.email_enabled ?? true}
          onValueChange={(next) => {
            void notificationsApi
              .updatePreferences({ email_enabled: next })
              .then(() => prefs.refresh())
              .catch(() => undefined);
          }}
          testID="email-switch"
        />
      </Card>

      <Card testID="language-card">
        <Txt variant="heading">{t('settings.language')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {SUPPORTED_LOCALES.map((code) => (
            <Button
              key={code}
              title={code}
              variant={code === locale ? 'primary' : 'secondary'}
              onPress={() => void changeLanguage(code)}
              testID={`locale-${code}`}
            />
          ))}
        </View>
      </Card>

      <Card testID="privacy-card">
        <Txt variant="heading">{t('settings.privacy')}</Txt>
        <Button
          title={t('settings.exportData')}
          variant="secondary"
          onPress={() => void exportData()}
          loading={busy}
          testID="export-data"
        />
        <Txt variant="caption" color={colors.rose}>
          {t('settings.deleteAccountWarning')}
        </Txt>
        <Field
          label={t('settings.deleteConfirmPrompt')}
          value={deleteConfirm}
          onChangeText={setDeleteConfirm}
          autoCapitalize="characters"
          testID="delete-confirm-input"
        />
        <Button
          title={t('settings.deleteAccount')}
          variant="danger"
          disabled={deleteConfirm !== 'DELETE'}
          loading={busy}
          onPress={() => void deleteAccount()}
          testID="delete-account"
        />
      </Card>

      <Button
        title={t('auth.signOut')}
        variant="ghost"
        onPress={() => void handleSignOut()}
        testID="sign-out"
      />
    </Screen>
  );
}
