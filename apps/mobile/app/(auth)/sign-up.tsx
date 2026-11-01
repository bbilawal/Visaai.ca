import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { getSupabase } from '@/auth/supabase';
import { useI18n } from '@/i18n/i18n';
import { analytics, EVENTS } from '@/analytics/analytics';
import { Banner, Button, Field, LinkButton, Screen, Txt } from '@/components/ui';
import { colors, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import { scorePassword } from '@/auth/password';

/**
 * Registration. Mirrors the web signup contract: Supabase `signUp` with
 * `full_name` in user metadata, and the Terms/immigration-disclaimer checkbox
 * gating email signup (a decision already on record for apps/web).
 *
 * Passwords are never stored, logged, or sent anywhere but Supabase over TLS —
 * the strength meter runs entirely locally.
 */
export default function SignUpScreen(): React.ReactElement {
  const { t } = useI18n();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const strength = scorePassword(password);

  const submit = async (): Promise<void> => {
    setError(null);
    if (!email.trim() || !password) {
      setError(t('common.required'));
      return;
    }
    if (!accepted) {
      setError(t('auth.termsAgree'));
      return;
    }
    if (strength.score < 2) {
      setError(strength.feedback);
      return;
    }

    setBusy(true);
    try {
      const { error: authError } = await getSupabase().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() || undefined } },
      });
      if (authError) {
        analytics.track(EVENTS.authFailed, { reason: 'signup' });
        setError(authError.message);
        return;
      }
      analytics.track(EVENTS.authSignedUp);
      // With email confirmation on, there is no session yet — tell the user to
      // check their inbox instead of silently doing nothing.
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen testID="sign-up-sent">
        <Txt variant="title">{t('auth.verifyEmail')}</Txt>
        <Txt variant="body" color={colors.paleStone}>
          {t('auth.verifyEmailBody', { email: email.trim() })}
        </Txt>
        <LinkButton
          title={t('auth.signIn')}
          onPress={() => router.push('/(auth)/sign-in')}
          testID="sign-in-link"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="sign-up-screen">
      <Txt variant="display" style={{ marginTop: spacing['2xl'] }}>
        {t('auth.signUp')}
      </Txt>

      {error ? <Banner tone="error" title={t('common.error')} body={error} /> : null}

      <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
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
      <Field
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        hint={password ? strength.feedback : undefined}
        testID="password-input"
        required
      />

      <Pressable
        onPress={() => setAccepted((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel={t('auth.termsAgree')}
        testID="terms-checkbox"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: MIN_TOUCH_TARGET,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: colors.ink,
            backgroundColor: accepted ? colors.ink : 'transparent',
          }}
        />
        <Txt variant="caption" style={{ flex: 1 }}>
          {t('auth.termsAgree')}
        </Txt>
      </Pressable>

      <Button title={t('auth.signUp')} onPress={submit} loading={busy} testID="sign-up-submit" />

      <LinkButton
        title={t('auth.signIn')}
        onPress={() => router.push('/(auth)/sign-in')}
        testID="sign-in-link"
      />
    </Screen>
  );
}
