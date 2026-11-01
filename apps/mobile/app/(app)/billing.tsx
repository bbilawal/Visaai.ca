import React, { useState } from 'react';
import { View } from 'react-native';
import { applicationsApi, billingApi, subscriptionsApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useI18n } from '@/i18n/i18n';
import { isApiError } from '@/api/errors';
import { payments } from '@/payments/checkout';
import { Badge, Banner, Button, Card, EmptyState, Loading, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Plan, subscription and payment history.
 *
 * Checkout and subscription management open Stripe in the system browser
 * (see src/payments/checkout.ts for the store-policy reasoning). On return the
 * screen re-reads state from the API — the browser result is a hint about what
 * the user did, never the source of truth about what was paid.
 */
function formatAmount(cents?: number, currency = 'USD'): string {
  if (cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

export default function BillingScreen(): React.ReactElement {
  const { t } = useI18n();
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subscription = useAsync(() => subscriptionsApi.mine(), 'subscription');
  const history = useAsync(() => billingApi.history(), 'billing-history');
  // Checkout is priced per application, so an upgrade needs one to attach to.
  const apps = useAsync(() => applicationsApi.list(), 'billing-applications');

  const refreshAll = async (): Promise<void> => {
    await Promise.all([subscription.refresh(), history.refresh()]);
  };

  const openPortal = async (): Promise<void> => {
    setBusy('portal');
    setError(null);
    try {
      const result = await payments.openBillingPortal();
      if (result.outcome === 'failed') setError(t('common.error'));
      // Always re-read: a change made in the portal is only visible server-side.
      await refreshAll();
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBusy(null);
    }
  };

  const upgrade = async (): Promise<void> => {
    const applicationId = (apps.data ?? [])[0]?.id;
    if (!applicationId) {
      setError('Start an application first — plans are priced per application.');
      return;
    }
    setBusy('checkout');
    setError(null);
    try {
      const result = await payments.startCheckout({ applicationId, planTier: 'copilot' });
      if (result.outcome === 'cancelled') {
        // Not a failure: the webhook may still land, so say so honestly.
        setNotice('Checkout closed. If you completed payment, it may take a moment to appear.');
      }
      await refreshAll();
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBusy(null);
    }
  };

  if (subscription.loading && !subscription.data) return <Loading label={t('common.loading')} />;

  const sub = subscription.data;

  return (
    <Screen testID="billing-screen">
      <Txt variant="display">{t('billing.title')}</Txt>
      <Banner tone="info" title={t('billing.opensBrowser')} />

      {notice ? <Banner tone="info" title={notice} /> : null}
      {error ? <Banner tone="error" title={error} /> : null}

      <Card testID="subscription-card">
        <Txt variant="heading">{t('billing.currentPlan')}</Txt>
        {sub ? (
          <>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}
            >
              <Txt variant="body" style={{ flex: 1 }}>
                {sub.plan ?? sub.tier ?? '—'}
              </Txt>
              <Badge
                label={sub.status ?? 'unknown'}
                tone={sub.status === 'active' ? 'success' : 'warning'}
              />
            </View>
            {sub.current_period_end ? (
              <Txt variant="caption" color={colors.paleStone}>
                {sub.cancel_at_period_end ? 'Ends' : 'Renews'}{' '}
                {new Date(sub.current_period_end).toLocaleDateString()}
              </Txt>
            ) : null}
          </>
        ) : (
          <Txt variant="body" color={colors.paleStone}>
            {t('billing.noSubscription')}
          </Txt>
        )}
      </Card>

      <Button
        title={sub ? t('billing.manage') : t('billing.upgrade')}
        onPress={() => void (sub ? openPortal() : upgrade())}
        loading={busy !== null}
        disabled={!sub && (apps.data ?? []).length === 0}
        accessibilityHint={
          !sub && (apps.data ?? []).length === 0
            ? 'Start an application before choosing a plan'
            : undefined
        }
        testID="billing-action"
      />

      {history.error ? (
        <Banner
          tone="error"
          title={t('common.error')}
          body={isApiError(history.error) ? history.error.userMessage : history.error.message}
        />
      ) : null}

      <Txt variant="heading">{t('billing.history')}</Txt>
      {(history.data ?? []).length === 0 ? (
        <EmptyState title="No payments yet" />
      ) : (
        (history.data ?? []).map((payment) => (
          <Card key={payment.id} testID={`payment-${payment.id}`}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}
            >
              <Txt variant="label" style={{ flex: 1 }}>
                {formatAmount(payment.amount_cents, payment.currency ?? 'USD')}
              </Txt>
              <Badge
                label={payment.status ?? '—'}
                tone={payment.status === 'succeeded' ? 'success' : 'neutral'}
              />
            </View>
            {payment.created_at ? (
              <Txt variant="caption" color={colors.paleStone}>
                {new Date(payment.created_at).toLocaleDateString()}
              </Txt>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
