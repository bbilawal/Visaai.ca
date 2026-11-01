import React, { useEffect, useState } from 'react';
import { useSession } from '@/auth/session';
import { useI18n } from '@/i18n/i18n';
import { analytics, EVENTS } from '@/analytics/analytics';
import { Banner, Button, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Biometric lock screen. Shown when the user enabled the app lock and the gate
 * has not been satisfied for this foreground session.
 *
 * The session itself is still valid in the keychain — this gate governs *local
 * access on this device*, which is the threat it exists for (a borrowed or
 * stolen unlocked phone). Signing out is always offered so a user whose
 * biometrics stop working is never trapped in the app.
 */
export default function LockedScreen(): React.ReactElement {
  const { t } = useI18n();
  const { unlock, signOut } = useSession();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const attempt = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const ok = await unlock();
      if (ok) analytics.track(EVENTS.authBiometricUnlock);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  // Prompt immediately on mount — making the user tap first adds a step with no
  // security value. Deferred to a microtask so the state updates inside
  // `attempt` do not run synchronously inside the effect body.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void attempt();
    });
    return () => {
      cancelled = true;
    };
    // `attempt` is re-created each render; re-running this effect on every
    // render would re-prompt in a loop, so mount-only is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen testID="locked-screen" scroll={false}>
      <Txt variant="title" style={{ marginTop: spacing['3xl'] }}>
        {t('auth.lockedTitle')}
      </Txt>
      <Txt variant="body" color={colors.paleStone}>
        {t('auth.lockedBody')}
      </Txt>

      {failed ? <Banner tone="warning" title="Unlock cancelled or failed" /> : null}

      <Button
        title={t('auth.biometricUnlock')}
        onPress={attempt}
        loading={busy}
        testID="unlock-button"
        style={{ marginTop: spacing.lg }}
      />
      <Button
        title={t('auth.signOut')}
        variant="ghost"
        onPress={() => void signOut()}
        testID="locked-sign-out"
      />
    </Screen>
  );
}
