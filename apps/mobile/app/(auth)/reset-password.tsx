import React, { useState } from 'react';
import { router } from 'expo-router';
import { getSupabase } from '@/auth/supabase';
import { useI18n } from '@/i18n/i18n';
import { scorePassword } from '@/auth/password';
import { Banner, Button, Field, Screen, Txt } from '@/components/ui';

/**
 * Completes a password reset. Reached from the emailed deep link, which
 * supabase-js exchanges for a recovery session; `updateUser` then sets the new
 * password on that session. No token is read from the URL by this screen — the
 * SDK owns that exchange, so nothing here can be spoofed by a crafted link.
 */
export default function ResetPasswordScreen(): React.ReactElement {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength = scorePassword(password);

  const submit = async (): Promise<void> => {
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (strength.score < 2) {
      setError(strength.feedback);
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await getSupabase().auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      router.replace('/(app)/dashboard');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="reset-password-screen">
      <Txt variant="title">{t('auth.resetPassword')}</Txt>
      {error ? <Banner tone="error" title={error} /> : null}
      <Field
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        hint={password ? strength.feedback : undefined}
        testID="password-input"
        required
      />
      <Field
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        testID="confirm-input"
        required
      />
      <Button title={t('common.save')} onPress={submit} loading={busy} testID="reset-submit" />
    </Screen>
  );
}
