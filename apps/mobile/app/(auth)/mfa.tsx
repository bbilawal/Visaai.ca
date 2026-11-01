import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { getSupabase } from '@/auth/supabase';
import { useI18n } from '@/i18n/i18n';
import { useSession } from '@/auth/session';
import { meApi } from '@/api/endpoints';
import { Banner, Button, Field, Loading, Screen, Txt } from '@/components/ui';
import { colors } from '@/theme/tokens';

/**
 * TOTP step-up (aal1 → aal2).
 *
 * Uses Supabase's native MFA — factors live in `auth.mfa_factors` and no TOTP
 * secret is ever stored by VisaAI, matching the web implementation. The API
 * reads `aal` straight from the verified JWT (auth/jwt-claims.ts), so a
 * successful verify here is what makes MfaGuard-protected routes answer.
 */
export default function MfaScreen(): React.ReactElement {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await getSupabase().auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === 'verified');
      setFactorId(verified?.id ?? null);
      setLoading(false);
    })();
  }, []);

  const submit = async (): Promise<void> => {
    if (!factorId) return;
    const trimmed = code.trim();
    // TOTP codes are exactly six digits; rejecting anything else locally avoids
    // burning a server-side attempt on an obvious typo.
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      const challenge = await sb.auth.mfa.challenge({ factorId });
      if (challenge.error || !challenge.data) {
        setError(challenge.error?.message ?? t('common.error'));
        return;
      }
      const verify = await sb.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: trimmed,
      });
      if (verify.error) {
        setError(verify.error.message);
        return;
      }
      // Best-effort audit signal; never block the user on it.
      void meApi.mfaEvent('mfa_verified').catch(() => undefined);
      await refresh();
      router.replace('/(app)/dashboard');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label={t('common.loading')} />;

  return (
    <Screen testID="mfa-screen">
      <Txt variant="title">{t('auth.mfaTitle')}</Txt>
      <Txt variant="body" color={colors.paleStone}>
        {t('auth.mfaBody')}
      </Txt>

      {error ? <Banner tone="error" title={error} /> : null}
      {!factorId ? (
        <Banner
          tone="warning"
          title="No authenticator enrolled"
          body="Add a second factor in Settings on the web app first."
        />
      ) : (
        <>
          <Field
            label={t('auth.mfaCode')}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            // One-time codes are autofillable from the OS keychain / SMS on iOS.
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            testID="mfa-code-input"
            required
          />
          <Button
            title={t('common.continue')}
            onPress={submit}
            loading={busy}
            testID="mfa-submit"
          />
        </>
      )}
    </Screen>
  );
}
