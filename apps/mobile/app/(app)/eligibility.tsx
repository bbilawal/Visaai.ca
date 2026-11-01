import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { aiApi, applicationsApi, referenceApi, type VisaAnalysis } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useAsync } from '@/hooks/use-async';
import { useSession } from '@/auth/session';
import { useI18n } from '@/i18n/i18n';
import { drafts } from '@/offline/drafts';
import { analytics, EVENTS } from '@/analytics/analytics';
import { Banner, Button, Card, Field, Loading, Screen, Txt } from '@/components/ui';
import { spacing } from '@/theme/tokens';

/**
 * AI eligibility assessment — the mobile front door to the existing engine.
 *
 * CONTRACT (apps/api/src/modules/visa/visa.dto.ts): POST /visa/analyze requires
 * { country, visaType, profile } and returns { ok, research, evaluation,
 * report }. An earlier version posted only { description } and read a
 * `suggestions` array that the API has never returned — it 400'd on every call.
 * The screen now collects what the pipeline actually needs.
 *
 * Two non-negotiables for a legally sensitive product:
 *  1. AI output is never presented as a decision, an approval, or legal advice.
 *     The disclaimer is a warning banner pinned directly above the result, not
 *     an info banner at the top of a form the user has already scrolled past.
 *  2. A consultant review path is always offered alongside the output.
 */
const DRAFT_NAME = 'eligibility.input';

interface EligibilityDraft {
  country: string;
  visaType: string;
  profile: string;
}

export default function EligibilityScreen(): React.ReactElement {
  const { t } = useI18n();
  const { user } = useSession();

  const [country, setCountry] = useState('');
  const [visaType, setVisaType] = useState('');
  const [profile, setProfile] = useState('');
  const [result, setResult] = useState<VisaAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [creating, setCreating] = useState(false);

  // Destination list comes from the strategy registry, so the picker can never
  // offer a country the backend cannot resolve.
  const countries = useAsync(() => referenceApi.countries(), 'countries');

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      const draft = await drafts.load<EligibilityDraft>(user.id, DRAFT_NAME);
      if (draft?.data) {
        setCountry(draft.data.country ?? '');
        setVisaType(draft.data.visaType ?? '');
        setProfile(draft.data.profile ?? '');
        setRestored(true);
      }
    })();
  }, [user?.id]);

  const persist = (next: Partial<EligibilityDraft>): void => {
    const merged = { country, visaType, profile, ...next };
    setRestored(false);
    if (user?.id) void drafts.save(user.id, DRAFT_NAME, merged);
  };

  const analyze = async (): Promise<void> => {
    setError(null);
    if (country.trim().length < 2) {
      setError('Choose a destination country.');
      return;
    }
    if (visaType.trim().length < 2) {
      setError('Enter the visa type you are considering.');
      return;
    }
    if (profile.trim().length < 20) {
      setError('Tell us a bit more about your situation — at least a sentence or two.');
      return;
    }

    setBusy(true);
    analytics.track(EVENTS.eligibilityStarted);
    try {
      const response = await aiApi.analyze({
        country: country.trim(),
        visaType: visaType.trim(),
        profile: profile.trim(),
      });
      setResult(response);
      analytics.track(EVENTS.eligibilityCompleted);
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const startApplication = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      // Returns { applicationId } — not an Application.
      const { applicationId } = await applicationsApi.create({ country: country.trim() });
      analytics.track(EVENTS.applicationCreated);
      if (user?.id) await drafts.clear(user.id, DRAFT_NAME);
      router.push({ pathname: '/(app)/applications/[id]', params: { id: applicationId } });
    } catch (e) {
      setError(isApiError(e) ? e.userMessage : t('common.error'));
    } finally {
      setCreating(false);
    }
  };

  const options = countries.data?.countries ?? [];

  return (
    <Screen testID="eligibility-screen">
      <Txt variant="display">{t('eligibility.title')}</Txt>

      {restored ? <Banner tone="info" title={t('application.draftRestored')} /> : null}
      {error ? <Banner tone="error" title={t('common.error')} body={error} /> : null}
      {countries.error ? (
        <Banner
          tone="warning"
          title="Could not load destinations"
          body="You can still type a country code."
        />
      ) : null}

      <Field
        label="Destination country"
        value={country}
        onChangeText={(v) => {
          setCountry(v);
          persist({ country: v });
        }}
        autoCapitalize="characters"
        hint={options.length ? `e.g. ${options.slice(0, 3).map((c) => c.code).join(', ')}` : undefined}
        testID="country-input"
        required
      />

      {options.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {options.slice(0, 8).map((c) => (
            <Button
              key={c.code}
              title={c.code}
              variant={country === c.code ? 'primary' : 'secondary'}
              onPress={() => {
                setCountry(c.code);
                persist({ country: c.code });
              }}
              accessibilityHint={`Select ${c.name}`}
              testID={`country-${c.code}`}
            />
          ))}
        </View>
      ) : null}

      <Field
        label="Visa type"
        value={visaType}
        onChangeText={(v) => {
          setVisaType(v);
          persist({ visaType: v });
        }}
        hint="For example: visitor, study permit, skilled worker"
        testID="visa-type-input"
        required
      />

      <Field
        label={t('eligibility.describeSituation')}
        value={profile}
        onChangeText={(v) => {
          setProfile(v);
          persist({ profile: v });
        }}
        multiline
        numberOfLines={6}
        style={{ minHeight: 140, textAlignVertical: 'top', paddingTop: spacing.md }}
        testID="situation-input"
        required
      />

      <Button
        title={t('common.continue')}
        onPress={analyze}
        loading={busy}
        testID="analyze-button"
      />

      {busy ? <Loading label={t('eligibility.analyzing')} /> : null}

      {result ? (
        <View style={{ gap: spacing.md }}>
          <Txt variant="title">{t('eligibility.results')}</Txt>

          {/* Pinned immediately above the output, and a warning rather than an
              info tone so it does not read as a neutral notice. */}
          <Banner tone="warning" title={t('eligibility.disclaimer')} />

          <Card testID="analysis-report">
            <Txt variant="body">{result.report}</Txt>
          </Card>

          <Button
            title={t('dashboard.startApplication')}
            onPress={() => void startApplication()}
            loading={creating}
            testID="start-application"
          />
          <Button
            title={t('eligibility.escalate')}
            variant="secondary"
            onPress={() => router.push('/(app)/consultants')}
            testID="escalate-button"
          />
        </View>
      ) : null}
    </Screen>
  );
}
