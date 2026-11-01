import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { ConsultantCard } from '@visaai/types';
import { consultantsApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useNow } from '@/hooks/use-now';
import { useI18n } from '@/i18n/i18n';
import { isApiError } from '@/api/errors';
import { analytics, EVENTS } from '@/analytics/analytics';
import { Badge, Banner, Button, Card, EmptyState, Loading, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Consultant discovery + booking.
 *
 * Availability comes from the consultant's own timezone and working hours; slots
 * arrive as absolute UTC instants and are rendered with `toLocaleString`, so the
 * user always reads them in *their* device timezone. Mixing the two zones is the
 * classic way to make someone miss a meeting, so the device zone is stated
 * explicitly on screen.
 */
const DAY_MS = 86_400_000;
const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function ConsultantsScreen(): React.ReactElement {
  const { t } = useI18n();
  const [selected, setSelected] = useState<ConsultantCard | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Returns a BARE ARRAY. Reading `.items` here rendered a permanent empty
  // state and made every downstream booking flow unreachable.
  const consultants = useAsync(() => consultantsApi.browse({}), 'consultants');

  // Derived from the ticking clock rather than read during render. `useNow`
  // returns 0 until its first effect, which the `enabled` guard below waits for
  // so we never request a window starting at the epoch.
  const now = useNow(15 * 60_000);
  const window = useMemo(
    () => ({
      from: new Date(now).toISOString(),
      to: new Date(now + 14 * DAY_MS).toISOString(),
    }),
    [now],
  );

  const slots = useAsync(
    () => consultantsApi.slots(selected?.id ?? '', window.from, window.to),
    `${selected?.id ?? ''}:${window.from}`,
    { enabled: Boolean(selected?.id) && now > 0 },
  );

  const book = async (start: string, end: string): Promise<void> => {
    if (!selected) return;
    setBooking(start);
    setError(null);
    try {
      await consultantsApi.book({
        consultantId: selected.id,
        scheduledStart: start,
        scheduledEnd: end,
        // The booking records the *user's* zone so reminders render correctly
        // for them; the consultant's zone lives on their availability row.
        timezone: DEVICE_TZ,
      });
      analytics.track(EVENTS.bookingCreated);
      setConfirmed(true);
      await slots.refresh();
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBooking(null);
    }
  };

  if (consultants.loading && !consultants.data) return <Loading label={t('common.loading')} />;

  if (selected) {
    return (
      <Screen testID="consultant-detail">
        <Button
          title={t('common.close')}
          variant="ghost"
          onPress={() => {
            setSelected(null);
            setConfirmed(false);
          }}
          testID="close-detail"
        />
        <Txt variant="title">{selected.full_name ?? 'Consultant'}</Txt>
        <Txt variant="caption" color={colors.paleStone}>
          {t('booking.timezoneNote', { tz: DEVICE_TZ })}
        </Txt>

        {confirmed ? <Banner tone="success" title={t('booking.booked')} /> : null}
        {error ? <Banner tone="error" title={error} /> : null}

        <Txt variant="heading">{t('booking.availability')}</Txt>
        {slots.loading ? <Loading label={t('common.loading')} /> : null}
        {slots.error ? (
          <Banner
            tone="error"
            title={t('common.error')}
            body={isApiError(slots.error) ? slots.error.userMessage : slots.error.message}
          />
        ) : null}
        {/* Only claim "no availability" when the fetch actually succeeded —
            otherwise a failed request reads as a consultant with no free time. */}
        {!slots.loading && !slots.error && (slots.data?.slots ?? []).length === 0 ? (
          <Banner tone="info" title={t('booking.noSlots')} />
        ) : null}

        <View style={{ gap: spacing.sm }}>
          {(slots.data?.slots ?? []).slice(0, 24).map((slot) => (
            <Button
              key={slot.start}
              title={new Date(slot.start).toLocaleString()}
              variant="secondary"
              loading={booking === slot.start}
              onPress={() => void book(slot.start, slot.end)}
              testID={`slot-${slot.start}`}
            />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen testID="consultants-screen">
      <Txt variant="display">{t('booking.consultants')}</Txt>

      {consultants.error ? (
        <Banner
          tone="error"
          title={t('common.error')}
          body={
            isApiError(consultants.error)
              ? consultants.error.userMessage
              : consultants.error.message
          }
        />
      ) : null}

      {(consultants.data ?? []).length === 0 ? (
        <EmptyState title="No consultants available" body="Check back shortly." />
      ) : null}

      {(consultants.data ?? []).map((consultant) => (
        <Card
          key={consultant.id}
          testID={`consultant-${consultant.id}`}
          accessibilityLabel={[
            consultant.full_name ?? 'Consultant',
            consultant.rating_avg ? `rated ${consultant.rating_avg.toFixed(1)} out of 5` : null,
            consultant.headline ?? null,
          ]
            .filter(Boolean)
            .join(', ')}
          onPress={() => setSelected(consultant)}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <Txt variant="heading" style={{ flex: 1 }}>
              {consultant.full_name ?? 'Consultant'}
            </Txt>
            {consultant.rating_avg ? (
              <Badge label={`${consultant.rating_avg.toFixed(1)} / 5`} />
            ) : null}
          </View>
          {consultant.headline ? (
            <Txt variant="caption" color={colors.paleStone}>
              {consultant.headline}
            </Txt>
          ) : null}
        </Card>
      ))}

      <Button
        title={t('dashboard.appointments')}
        variant="secondary"
        onPress={() => router.push('/(app)/appointments')}
        testID="go-appointments"
      />
    </Screen>
  );
}
