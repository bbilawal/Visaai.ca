import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppNotification, ApplicantApplicationView } from '@visaai/types';
import { applicationsApi, consultantsApi, messagingApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useNow } from '@/hooks/use-now';
import { useSession } from '@/auth/session';
import { useI18n } from '@/i18n/i18n';
import { useNetwork } from '@/offline/network';
import { isApiError } from '@/api/errors';
import { Badge, Banner, Button, Card, EmptyState, Loading, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Mobile dashboard.
 *
 * Reads through the API (`GET /applicant/applications`) rather than querying
 * Supabase directly. The HTTP client is where retry, timeout, error typing and
 * the 401 handler live, and that endpoint additionally returns the derived
 * assignment status. The web app does query tables directly, but it does so in
 * *server* components — not the equivalent boundary for a mobile client.
 */
export default function DashboardScreen(): React.ReactElement {
  const { t } = useI18n();
  const { user } = useSession();
  const network = useNetwork();
  const insets = useSafeAreaInsets();
  const now = useNow();

  const isRealAccount = Boolean(user?.id) && user?.isAnonymous === false;

  const apps = useAsync<ApplicantApplicationView[]>(
    () => applicationsApi.list(),
    user?.id ?? '',
    { enabled: Boolean(user?.id) },
  );

  const notifications = useAsync<AppNotification[]>(
    () => messagingApi.notifications(),
    user?.id ?? '',
    { enabled: isRealAccount },
  );

  const bookings = useAsync(() => consultantsApi.bookings(), user?.id ?? '', {
    enabled: isRealAccount,
  });

  const upcoming = useMemo(
    () =>
      (bookings.data ?? []).filter(
        (b) => b.status !== 'cancelled' && new Date(b.scheduled_start).getTime() > now,
      ),
    [bookings.data, now],
  );

  const refreshAll = async (): Promise<void> => {
    await Promise.all([apps.refresh(), notifications.refresh(), bookings.refresh()]);
  };

  if (apps.loading && !apps.data) return <Loading label={t('common.loading')} />;

  const unread = (notifications.data ?? []).length;

  return (
    <ScrollView
      testID="dashboard-screen"
      style={{ flex: 1, backgroundColor: colors.paperCanvas }}
      contentContainerStyle={{
        padding: spacing.lg,
        // Without this the title renders under the status bar / notch.
        paddingTop: insets.top + spacing.lg,
        gap: spacing.md,
        paddingBottom: spacing['3xl'],
      }}
      refreshControl={
        <RefreshControl refreshing={apps.refreshing} onRefresh={() => void refreshAll()} />
      }
    >
      <Txt variant="display" accessibilityRole="header">
        {t('dashboard.title')}
      </Txt>

      {/* Pull-to-refresh is not operable under VoiceOver or Switch Control, so
          the same action needs a real control. */}
      <Button
        title={t('common.retry')}
        variant="ghost"
        onPress={() => void refreshAll()}
        accessibilityHint="Reloads your applications"
        testID="refresh-button"
      />

      {!network.isReachable ? (
        <Banner tone="warning" title={t('common.offline')} body={t('common.offlineBody')} />
      ) : null}

      {apps.error ? (
        <Banner
          tone="error"
          title={t('common.error')}
          body={isApiError(apps.error) ? apps.error.userMessage : apps.error.message}
        />
      ) : null}

      {(apps.data ?? []).length === 0 ? (
        <EmptyState
          title={t('dashboard.empty')}
          body={t('dashboard.emptyBody')}
          action={
            <Button
              title={t('dashboard.startApplication')}
              onPress={() => router.push('/(app)/eligibility')}
              testID="start-application"
            />
          }
        />
      ) : (
        (apps.data ?? []).map((app) => (
          <Card
            key={app.id}
            testID={`application-${app.id}`}
            // A Pressable's label REPLACES its children for assistive tech, so
            // everything meaningful in the row has to be named here.
            accessibilityLabel={[
              app.destination_country ?? 'Application',
              app.status ?? 'draft',
              app.assignment_status === 'ASSIGNED' && app.assigned_consultant
                ? `assigned to ${app.assigned_consultant.email ?? 'a consultant'}`
                : 'not yet assigned',
            ].join(', ')}
            onPress={() =>
              router.push({ pathname: '/(app)/applications/[id]', params: { id: app.id } })
            }
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Txt variant="heading" style={{ flex: 1 }}>
                {app.destination_country ?? 'Application'}
              </Txt>
              <Badge
                label={app.status ?? 'draft'}
                tone={app.status === 'submitted' ? 'success' : 'neutral'}
              />
            </View>
            <Txt variant="caption" color={colors.paleStone}>
              {app.assignment_status === 'ASSIGNED'
                ? (app.assigned_consultant?.email ?? 'Assigned')
                : 'Not yet assigned'}
            </Txt>
          </Card>
        ))
      )}

      {unread > 0 ? (
        <Card
          testID="messages-card"
          accessibilityLabel={`${t('dashboard.messages')}, ${unread} unread`}
          onPress={() => router.push('/(app)/notifications')}
        >
          <Txt variant="heading">{t('dashboard.messages')}</Txt>
          <Txt variant="caption" color={colors.paleStone}>
            {`${unread} unread`}
          </Txt>
        </Card>
      ) : null}

      {upcoming.length > 0 ? (
        <Card
          testID="appointments-card"
          accessibilityLabel={`${t('dashboard.appointments')}, next ${new Date(
            upcoming[0]!.scheduled_start,
          ).toLocaleString()}`}
          onPress={() => router.push('/(app)/appointments')}
        >
          <Txt variant="heading">{t('dashboard.appointments')}</Txt>
          <Txt variant="caption" color={colors.paleStone}>
            {new Date(upcoming[0]!.scheduled_start).toLocaleString()}
          </Txt>
        </Card>
      ) : null}
    </ScrollView>
  );
}
