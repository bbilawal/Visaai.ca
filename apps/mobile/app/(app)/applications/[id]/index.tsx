import React from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { AppProgress, ChecklistItem } from '@visaai/types';
import { applicationsApi, aiApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useI18n } from '@/i18n/i18n';
import { isApiError } from '@/api/errors';
import { Badge, Banner, Button, Card, Loading, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Application detail: stage progress, outstanding checklist items, and the
 * readiness score. Reads the same progress state machine the web stage nav uses
 * (GET /progress/:id) so a user switching between web and phone sees one story.
 */
const STAGE_LABEL: Record<string, string> = {
  intake: 'Intake',
  documents: 'Documents',
  narrative: 'Drafted documents',
  readiness: 'Readiness',
  submission: 'Submission',
  tracking: 'Tracking',
};

export default function ApplicationScreen(): React.ReactElement {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const applicationId = String(id ?? '');

  const progress = useAsync<AppProgress>(
    () => applicationsApi.progress(applicationId),
    applicationId,
    { enabled: Boolean(applicationId) },
  );
  const checklist = useAsync<ChecklistItem[]>(
    () => applicationsApi.checklist(applicationId),
    applicationId,
    { enabled: Boolean(applicationId) },
  );
  const vri = useAsync(
    () => aiApi.vri(applicationId),
    applicationId,
    { enabled: Boolean(applicationId) },
  );

  if (progress.loading && !progress.data) return <Loading label={t('common.loading')} />;

  const outstanding = (checklist.data ?? []).filter((item) => item.status === 'missing');

  return (
    <Screen testID="application-screen">
      <Txt variant="display">{t('application.progress')}</Txt>

      {progress.error ? (
        <Banner
          tone="error"
          title={t('common.error')}
          body={isApiError(progress.error) ? progress.error.userMessage : progress.error.message}
        />
      ) : null}

      {(progress.data?.stages ?? []).map((stage) => (
        <Card key={stage.slug} testID={`stage-${stage.slug}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <Txt variant="heading" style={{ flex: 1 }}>
              {STAGE_LABEL[stage.slug] ?? stage.slug}
            </Txt>
            <Badge
              label={stage.state}
              tone={
                stage.state === 'complete'
                  ? 'success'
                  : stage.state === 'locked'
                    ? 'neutral'
                    : 'warning'
              }
            />
          </View>
        </Card>
      ))}

      {outstanding.length > 0 ? (
        <Card testID="outstanding-card">
          <Txt variant="heading">{t('dashboard.documents')}</Txt>
          {outstanding.slice(0, 5).map((item) => (
            <Txt key={item.id} variant="caption" color={colors.paleStone}>
              • {item.label}
            </Txt>
          ))}
          <Button
            title={t('documents.title')}
            onPress={() =>
              router.push({
                pathname: '/(app)/applications/[id]/documents',
                params: { id: applicationId },
              })
            }
            testID="go-documents"
          />
        </Card>
      ) : null}

      {vri.data ? (
        <Card testID="vri-card">
          <Txt variant="heading">Readiness</Txt>
          <Txt variant="display">{Math.round((vri.data.overall_score ?? 0) as number)}</Txt>
          <Txt variant="caption" color={colors.paleStone}>
            {t('eligibility.disclaimer')}
          </Txt>
        </Card>
      ) : null}

      <Button
        title={t('messages.title')}
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: '/(app)/applications/[id]/messages',
            params: { id: applicationId },
          })
        }
        testID="go-messages"
      />
    </Screen>
  );
}
