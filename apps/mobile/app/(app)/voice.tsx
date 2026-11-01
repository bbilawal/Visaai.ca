import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { isApiError } from '@/api/errors';
import { useI18n } from '@/i18n/i18n';
import { analytics } from '@/analytics/analytics';
import { Badge, Banner, Button, Card, EmptyState, Loading, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';
import {
  VoiceClient,
  voiceApi,
  type VoiceState,
  type VoiceTurnEvent,
} from '@/voice/voice-client';

/**
 * Voice assistant screen.
 *
 * ACCESSIBILITY IS THE DESIGN, not a layer on top. A voice interface excludes
 * people by default, so:
 *  - the live transcript is the primary surface; audio is the supplement
 *  - every state change is announced (`announceForAccessibility`), because
 *    `accessibilityLiveRegion` is Android-only
 *  - recording state is stated in words, never by colour alone
 *  - the whole feature is usable with sound off — the answer is always text
 *  - a non-voice fallback (chat/messaging) is one tap away at all times
 */
interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
}

export default function VoiceScreen(): React.ReactElement {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [capabilities, setCapabilities] = useState<{
    languages: string[];
    disclaimer: string;
  } | null>(null);
  const [consented, setConsented] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<VoiceState>('idle');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [escalate, setEscalate] = useState(false);
  const [busy, setBusy] = useState(false);

  const client = useRef<VoiceClient | null>(null);

  // Announce every state change: a sighted user sees the indicator, everyone
  // else needs to be told whether the microphone is live.
  const announceState = useCallback((next: VoiceState): void => {
    const message: Record<VoiceState, string> = {
      idle: 'Ready. Double tap to speak.',
      listening: 'Recording. Double tap to stop.',
      processing: 'Thinking.',
      speaking: 'Assistant is speaking.',
      ended: 'Session ended.',
    };
    AccessibilityInfo.announceForAccessibility(message[next]);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [caps, consents] = await Promise.all([
          voiceApi.capabilities(),
          voiceApi.consents(),
        ]);
        setCapabilities(caps);
        const granted = new Set(consents.filter((c) => c.granted).map((c) => c.kind));
        setConsented(granted.has('microphone') && granted.has('transcription'));
      } catch (e) {
        setError(isApiError(e) ? e.userMessage : t('common.error'));
      }
    })();
    return () => client.current?.disconnect();
  }, [t]);

  const handlers = {
    onState: (next: VoiceState) => {
      setState(next);
      announceState(next);
    },
    onTurn: (turn: VoiceTurnEvent) => {
      // Transcript first and unconditionally — this is the text alternative.
      setEntries((prev) => [
        ...prev,
        { role: 'user' as const, text: turn.transcript },
        { role: 'assistant' as const, text: turn.answer },
      ]);
      AccessibilityInfo.announceForAccessibility(turn.answer);
      if (turn.recommendsEscalation) setEscalate(true);
    },
    // Playback is intentionally not auto-started here: the answer is already on
    // screen and announced, and forcing audio would talk over a screen reader.
    onAudio: () => setState('idle'),
    onEnded: (reason: string) => {
      setError(reason);
      setSessionId(null);
    },
    onError: (message: string) => setError(message),
  };

  const grantConsent = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // OS permission first: consent to be recorded is meaningless if the
      // device will not allow recording anyway.
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is needed for the voice assistant.');
        return;
      }
      await voiceApi.recordConsent('microphone', true);
      await voiceApi.recordConsent('transcription', true);
      setConsented(true);
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const startSession = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const session = await voiceApi.start({});
      setSessionId(session.id);
      client.current = new VoiceClient(handlers);
      await client.current.connect(session.id);
      analytics.track('voice.session_started');
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const endSession = async (): Promise<void> => {
    if (!sessionId) return;
    client.current?.disconnect();
    client.current = null;
    await voiceApi.end(sessionId).catch(() => undefined);
    setSessionId(null);
    setState('ended');
    analytics.track('voice.session_ended');
  };

  const toggleRecording = async (): Promise<void> => {
    if (!sessionId) return;
    try {
      if (state === 'listening') {
        await recorder.stop();
        setState('processing');
        const uri = recorder.uri;
        if (!uri) return;
        const response = await fetch(uri);
        const buffer = await response.arrayBuffer();
        client.current?.sendUtterance(buffer, 'audio/m4a');
        return;
      }
      // Barge-in: speaking over the assistant stops playback.
      if (state === 'speaking') client.current?.interrupt();
      await recorder.prepareToRecordAsync();
      recorder.record();
      handlers.onState('listening');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
      setState('idle');
    }
  };

  if (!capabilities) return <Loading label={t('common.loading')} />;

  return (
    <ScrollView
      testID="voice-screen"
      style={{ flex: 1, backgroundColor: colors.paperCanvas }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingTop: insets.top + spacing.lg,
        paddingBottom: insets.bottom + spacing['3xl'],
        gap: spacing.md,
      }}
    >
      <Txt variant="display" accessibilityRole="header">
        Voice assistant
      </Txt>

      {/* The advice boundary, stated before the user speaks — not buried. */}
      <Banner tone="warning" title={capabilities.disclaimer} />

      {error ? <Banner tone="error" title={t('common.error')} body={error} /> : null}

      {!consented ? (
        <Card testID="voice-consent">
          <Txt variant="heading">Before we start</Txt>
          <Txt variant="body" color={colors.paleStone}>
            The assistant listens to your question, turns it into text, and answers. Your voice
            recording is never stored — only the text, and only so you can read it back.
          </Txt>
          <Button
            title="Allow microphone and transcription"
            onPress={() => void grantConsent()}
            loading={busy}
            testID="voice-consent-grant"
          />
        </Card>
      ) : null}

      {consented && !sessionId ? (
        <Button
          title="Start voice session"
          onPress={() => void startSession()}
          loading={busy}
          testID="voice-start"
        />
      ) : null}

      {sessionId ? (
        <Card testID="voice-controls">
          {/* State in WORDS, not colour alone. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Badge
              label={state === 'listening' ? 'Recording' : state === 'processing' ? 'Thinking' : 'Ready'}
              tone={state === 'listening' ? 'danger' : 'neutral'}
            />
            <Txt variant="caption" color={colors.paleStone}>
              {state === 'listening' ? 'Your microphone is on' : 'Your microphone is off'}
            </Txt>
          </View>

          <Button
            title={state === 'listening' ? 'Stop and send' : 'Hold a question'}
            onPress={() => void toggleRecording()}
            accessibilityHint={
              state === 'listening'
                ? 'Stops recording and sends your question'
                : 'Starts recording your question'
            }
            testID="voice-record-toggle"
          />
          <Button
            title="End session"
            variant="secondary"
            onPress={() => void endSession()}
            testID="voice-end"
          />
        </Card>
      ) : null}

      {escalate ? (
        <Card testID="voice-escalation">
          <Txt variant="heading">Talk to a consultant</Txt>
          <Txt variant="body" color={colors.paleStone}>
            This question needs a licensed consultant. Sharing your transcript is optional and asked
            for separately.
          </Txt>
          <Button
            title="Find a consultant"
            onPress={() => router.push('/(app)/consultants')}
            testID="voice-escalate"
          />
        </Card>
      ) : null}

      <Txt variant="heading" accessibilityRole="header">
        Transcript
      </Txt>
      {entries.length === 0 ? (
        <EmptyState title="Nothing yet" body="Your conversation will appear here as text." />
      ) : (
        entries.map((entry, index) => (
          <Card key={`${entry.role}-${index}`} testID={`voice-turn-${index}`}>
            <Txt variant="caption" color={colors.paleStone}>
              {entry.role === 'user' ? 'You' : 'Assistant'}
            </Txt>
            <Txt variant="body">{entry.text}</Txt>
          </Card>
        ))
      )}

      {/* Non-voice fallback, always available. */}
      <Button
        title="Type instead"
        variant="ghost"
        onPress={() => router.push('/(app)/dashboard')}
        accessibilityHint="Use the app without voice"
        testID="voice-fallback"
      />
    </ScrollView>
  );
}
