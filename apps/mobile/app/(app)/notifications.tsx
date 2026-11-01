import React from 'react';
import { router } from 'expo-router';
import { notificationsApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useI18n } from '@/i18n/i18n';
import { resolveDeepLink } from '@/notifications/routing';
import { Badge, Button, Card, EmptyState, Loading, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * In-app notification feed (GET /notifications). Tapping an item routes through
 * the same validated deep-link resolver a push tap uses, so a malformed or
 * hostile `link` stored on a notification row cannot push an arbitrary route.
 */
export default function NotificationsScreen(): React.ReactElement {
  const { t } = useI18n();
  const feed = useAsync(() => notificationsApi.feed(30), 'notifications');

  const open = (link: string | null | undefined): void => {
    const destination = resolveDeepLink(link);
    router.push({ pathname: destination.pathname, params: destination.params } as never);
  };

  const markAll = async (): Promise<void> => {
    await notificationsApi.markAllRead().catch(() => undefined);
    await feed.refresh();
  };

  if (feed.loading && !feed.data) return <Loading label={t('common.loading')} />;

  const items = feed.data?.rows ?? [];

  return (
    <Screen testID="notifications-screen">
      <Txt variant="display">{t('dashboard.messages')}</Txt>

      {items.length === 0 ? (
        <EmptyState title="Nothing new" />
      ) : (
        <Button
          title="Mark all read"
          variant="ghost"
          onPress={() => void markAll()}
          testID="mark-all-read"
        />
      )}

      {items.map((item) => (
        <Card
          key={item.id}
          testID={`notification-${item.id}`}
          accessibilityLabel={item.title ?? 'Notification'}
          onPress={() => {
            void notificationsApi.markRead(item.id).catch(() => undefined);
            open(item.link);
          }}
        >
          <Txt variant="heading">{item.title ?? 'Update'}</Txt>
          {item.body ? (
            <Txt variant="caption" color={colors.paleStone}>
              {item.body}
            </Txt>
          ) : null}
          {!item.readAt ? (
            <Badge label="New" tone="warning" />
          ) : (
            <Txt variant="caption" color={colors.faintText} style={{ marginTop: spacing.xs }}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Txt>
          )}
        </Card>
      ))}
    </Screen>
  );
}
