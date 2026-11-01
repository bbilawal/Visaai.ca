import React, { useState } from 'react';
import { View } from 'react-native';
import { consultantsApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useNow } from '@/hooks/use-now';
import { useI18n } from '@/i18n/i18n';
import { isApiError } from '@/api/errors';
import { analytics, EVENTS } from '@/analytics/analytics';
import { Badge, Banner, Button, Card, EmptyState, Loading, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Booked consultations. Times are stored as UTC instants and rendered in the
 * device timezone; the booking's own `timezone` column is shown too, because a
 * user who booked while travelling needs to see which zone the consultant will
 * actually be in.
 */
export default function AppointmentsScreen(): React.ReactElement {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const bookings = useAsync(() => consultantsApi.bookings(), 'bookings');
  // Ticking clock, so a booking that starts while the screen is open stops
  // offering "cancel" on its own.
  const now = useNow();

  const cancel = async (id: string): Promise<void> => {
    setCancelling(id);
    setError(null);
    try {
      await consultantsApi.cancelBooking(id);
      analytics.track(EVENTS.bookingCancelled);
      await bookings.refresh();
    } catch (e) {
      // The API refuses cancellation inside the 2-hour window; surface that
      // reason rather than a generic failure.
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setCancelling(null);
    }
  };

  if (bookings.loading && !bookings.data) return <Loading label={t('common.loading')} />;

  const items = bookings.data ?? [];

  return (
    <Screen testID="appointments-screen">
      <Txt variant="display">{t('dashboard.appointments')}</Txt>
      <Txt variant="caption" color={colors.paleStone}>
        {t('booking.timezoneNote', { tz: DEVICE_TZ })}
      </Txt>

      {error ? <Banner tone="error" title={error} /> : null}

      {items.length === 0 ? (
        <EmptyState title="No appointments" body="Book a consultation to see it here." />
      ) : null}

      {items.map((booking) => {
        const upcoming =
          booking.status !== 'cancelled' &&
          new Date(booking.scheduled_start).getTime() > now;
        return (
          <Card key={booking.id} testID={`booking-${booking.id}`}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}
            >
              <Txt variant="heading" style={{ flex: 1 }}>
                {new Date(booking.scheduled_start).toLocaleString()}
              </Txt>
              <Badge
                label={booking.status}
                tone={
                  booking.status === 'confirmed'
                    ? 'success'
                    : booking.status === 'cancelled'
                      ? 'danger'
                      : 'warning'
                }
              />
            </View>
            <Txt variant="caption" color={colors.paleStone}>
              {booking.provider} · {booking.timezone}
            </Txt>
            {upcoming ? (
              <Button
                title={t('booking.cancel')}
                variant="ghost"
                loading={cancelling === booking.id}
                onPress={() => void cancel(booking.id)}
                testID={`cancel-${booking.id}`}
              />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
