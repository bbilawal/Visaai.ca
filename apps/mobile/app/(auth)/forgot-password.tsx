import React, { useState } from 'react';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { getSupabase } from '@/auth/supabase';
import { useI18n } from '@/i18n/i18n';
import { Banner, Button, Field, LinkButton, Screen, Txt } from '@/components/ui';

/**
 * Password reset request.
 *
 * The email link returns to the app through the registered scheme, so the reset
 * is completed in-app rather than bouncing the user to the website. The success
 * message is shown unconditionally — confirming whether an address has an
 * account would turn this screen into an account-enumeration oracle.
 */
export default function ForgotPasswordScreen(): React.ReactElement {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!email.trim()) {
      setError(t('common.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: Linking.createURL('reset-password'),
      });
      setSent(true);
    } catch {
      // Even a transport failure shows the neutral message; the user can retry.
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="forgot-password-screen">
      <Txt variant="title">{t('auth.resetPassword')}</Txt>

      {sent ? (
        <Banner tone="success" title={t('auth.resetSent')} />
      ) : (
        <>
          {error ? <Banner tone="error" title={error} /> : null}
          <Field
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            testID="email-input"
            required
          />
          <Button
            title={t('auth.resetPassword')}
            onPress={submit}
            loading={busy}
            testID="reset-submit"
          />
        </>
      )}

      <LinkButton
        title={t('auth.signIn')}
        onPress={() => router.push('/(auth)/sign-in')}
        testID="sign-in-link"
      />
    </Screen>
  );
}
