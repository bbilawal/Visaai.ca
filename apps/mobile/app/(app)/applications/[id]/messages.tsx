import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { Message } from '@visaai/types';
import { messagingApi } from '@/api/endpoints';
import { useI18n } from '@/i18n/i18n';
import { useSession } from '@/auth/session';
import { isApiError } from '@/api/errors';
import { isOnline, useNetwork } from '@/offline/network';
import { offlineQueue } from '@/offline/queue';
import { analytics, EVENTS } from '@/analytics/analytics';
import { Badge, Banner, Button, Field, Loading, Txt } from '@/components/ui';
import { colors, radii, spacing } from '@/theme/tokens';

/**
 * Consultant ↔ applicant messaging.
 *
 * Realtime: the API exposes an SSE stream (GET /messaging/stream). React
 * Native's fetch has no streaming body, and EventSource is not built in, so
 * this screen polls while focused. Poll rather than an extra dependency, and
 * documented as a known limitation rather than pretended away.
 *
 * Offline: a message composed without connectivity is queued (offline/queue)
 * and shown with a "will send" marker rather than being silently dropped.
 *
 * Replay safety: each send carries a `clientId` UUID that the API stores on the
 * message, with a partial unique index on (conversation, sender, client_id). A
 * queued send whose response was lost in transit therefore resolves to the
 * SAME message on replay rather than creating a duplicate.
 */
const POLL_MS = 10_000;

interface PendingMessage {
  clientId: string;
  body: string;
  queued: boolean;
}

export default function MessagesScreen(): React.ReactElement {
  const { t } = useI18n();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const network = useNetwork();
  const { id } = useLocalSearchParams<{ id: string }>();
  const applicationId = String(id ?? '');

  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const page = await messagingApi.messages(applicationId);
      const fetched = page.messages ?? [];
      setMessages(fetched);
      setError(null);
      // Exact match on the idempotency key, with a body match as a fallback for
      // messages sent before this field existed (or by another client).
      setPending((prev) =>
        prev.filter(
          (p) =>
            !fetched.some(
              (m) =>
                m.client_id === p.clientId ||
                (m.sender_role === 'user' && m.body === p.body),
            ),
        ),
      );
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [applicationId, t]);

  useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;

    // Kicked to a microtask so the first state update lands after the effect
    // returns rather than synchronously inside it (react-hooks/set-state-in-effect:
    // a synchronous setState in an effect body causes a cascading render).
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    void messagingApi.markRead(applicationId).catch(() => undefined);

    timer.current = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, [applicationId, load]);

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;
    const clientId = Crypto.randomUUID();
    setDraft('');
    setSending(true);

    if (!isOnline()) {
      // Queued, not lost — and safe to replay: the server dedupes on clientId.
      await offlineQueue.enqueue({
        userId: userId ?? '',
        op: 'message.send',
        path: `/messaging/${applicationId}/messages`,
        method: 'POST',
        body: { body, clientId },
      });
      setPending((p) => [...p, { clientId, body, queued: true }]);
      setSending(false);
      return;
    }

    setPending((p) => [...p, { clientId, body, queued: false }]);
    try {
      await messagingApi.send(applicationId, { body, clientId });
      analytics.track(EVENTS.messageSent);
      await load();
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('messages.failedToSend'));
      // Actually queue it. The badge used to say "Queued" while nothing was
      // enqueued, so navigating away lost the message — a durability guarantee
      // the UI stated and the code did not implement.
      if (userId) {
        await offlineQueue
          .enqueue({
            userId,
            op: 'message.send',
            path: `/messaging/${applicationId}/messages`,
            method: 'POST',
            body: { body, clientId },
          })
          .catch(() => undefined);
      }
      setPending((p) => p.map((m) => (m.clientId === clientId ? { ...m, queued: true } : m)));
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Loading label={t('common.loading')} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.paperCanvas }} testID="messages-screen">
      {!network.isReachable ? (
        <Banner tone="warning" title={t('common.offline')} body={t('messages.queued')} />
      ) : null}
      {error ? <Banner tone="error" title={error} /> : null}

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        renderItem={({ item }) => (
          <View
            // Without `accessible`, RN DROPS accessibilityLabel on a plain View
            // and the sender is never announced — colour/alignment was the only
            // cue that a message came from the consultant.
            accessible
            accessibilityLabel={`${item.sender_role === 'user' ? 'You' : item.sender_role}: ${item.body}, ${new Date(item.created_at).toLocaleTimeString()}`}
            style={{
              alignSelf: item.sender_role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              backgroundColor: item.sender_role === 'user' ? colors.atmosphereWash : '#ffffff',
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: colors.hairline1,
              padding: spacing.md,
            }}
          >
            <Txt variant="body">{item.body}</Txt>
            {/* paleStone, not faintText: on the atmosphereWash sender bubble
                faintText measures 3.68:1, below the AA minimum. */}
            <Txt variant="caption" color={colors.paleStone}>
              {new Date(item.created_at).toLocaleTimeString()}
            </Txt>
          </View>
        )}
        ListFooterComponent={
          <View style={{ gap: spacing.sm }}>
            {pending.map((p) => (
              <View
                key={p.clientId}
                testID={`pending-${p.clientId}`}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  backgroundColor: colors.bg2,
                  borderRadius: radii.lg,
                  padding: spacing.md,
                  gap: spacing.xs,
                }}
              >
                <Txt variant="body" color={colors.paleStone}>
                  {p.body}
                </Txt>
                <Badge label={p.queued ? t('messages.queued') : 'Sending'} tone="warning" />
              </View>
            ))}
          </View>
        }
      />

      <View
        style={{
          padding: spacing.lg,
          gap: spacing.sm,
          borderTopWidth: 1,
          borderTopColor: colors.hairline1,
        }}
      >
        <Field
          label={t('messages.placeholder')}
          value={draft}
          onChangeText={setDraft}
          multiline
          testID="message-input"
        />
        <Button
          title={t('messages.send')}
          onPress={send}
          loading={sending}
          testID="send-button"
        />
      </View>
    </View>
  );
}
