import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { getSupabase } from '@/auth/supabase';
import { useI18n } from '@/i18n/i18n';
import { analytics, EVENTS } from '@/analytics/analytics';
import { Banner, Button, Field, LinkButton, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';
import { useNetwork } from '@/offline/network';

/**
 * Email + password sign-in against Supabase — the same and only auth backend
 * the web app uses (no NextAuth, no Passport). MFA step-up is handled after
 * sign-in: Supabase returns a session at aal1 and the API's MfaGuard demands
 * aal2 for protected routes, so the challenge screen is reached on demand
 * rather than pre-emptively.
 */
export default function SignInScreen(): React.ReactElement {
  const { t } = useI18n();
  const network = useNetwork();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setError(null);
    if (!email.trim() || !password) {
      setError(t('common.required'));
      return;
    }
    setBusy(true);
    try {
      const { data, error: authError } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        // Supabase already returns a deliberately vague "Invalid login
        // credentials" for both wrong-email and wrong-password; surface it as
        // given rather than distinguishing the two (account enumeration).
        analytics.track(EVENTS.authFailed, { reason: 'credentials' });
        setError(authError.message);
        return;
      }
      analytics.track(EVENTS.authSignedIn);
      // A verified TOTP factor means the session is aal1 and needs step-up
      // before protected routes will answer.
      const factors = data.session?.user?.factors ?? [];
      if (factors.some((f) => f.status === 'verified')) {
        router.push('/(auth)/mfa');
        return;
      }
      // Otherwise the root guard moves us to the dashboard on the auth event.
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="sign-in-screen">
      <View style={{ gap: spacing.xs, marginTop: spacing['2xl'] }}>
        <Txt variant="display">{t('common.appName')}</Txt>
        <Txt variant="body" color={colors.paleStone}>
          {t('auth.signIn')}
        </Txt>
      </View>

      {!network.isConnected ? (
        <Banner tone="warning" title={t('common.offline')} body={t('common.offlineBody')} />
      ) : null}
      {error ? <Banner tone="error" title={t('common.error')} body={error} /> : null}

      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        testID="email-input"
        required
      />
      <Field
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        // Lets the OS password manager fill and save; a manager-generated
        // password is stronger than one a user can retype on a phone keyboard.
        autoComplete="current-password"
        textContentType="password"
        testID="password-input"
        required
      />

      <Button
        title={t('auth.signIn')}
        onPress={submit}
        loading={busy}
        disabled={!network.isConnected}
        testID="sign-in-submit"
      />

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <LinkButton
          title={t('auth.forgotPassword')}
          onPress={() => router.push('/(auth)/forgot-password')}
          testID="forgot-password-link"
        />
        <LinkButton
          title={t('auth.signUp')}
          onPress={() => router.push('/(auth)/sign-up')}
          testID="sign-up-link"
        />
      </View>
    </Screen>
  );
}
