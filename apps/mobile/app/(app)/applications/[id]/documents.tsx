import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import type { Document } from '@visaai/types';
import { documentsApi } from '@/api/endpoints';
import { useAsync } from '@/hooks/use-async';
import { useI18n } from '@/i18n/i18n';
import { isApiError } from '@/api/errors';
import { assessImageQuality } from '@/documents/validation';
import { DocumentValidationError, uploadDocument, type UploadProgress } from '@/documents/upload';
import { Badge, Banner, Button, Card, Loading, Screen, Txt } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

/**
 * Document capture and upload.
 *
 * Capture → optional rotate/compress → presigned direct upload → register →
 * OCR status. The temporary camera/picker file is deleted after a successful
 * upload (see upload.ts) so scans of passports and bank statements do not
 * accumulate in the app cache.
 */
export default function DocumentsScreen(): React.ReactElement {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const applicationId = String(id ?? '');

  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const cancelRef = useRef<null | (() => Promise<void>)>(null);

  const documents = useAsync<Document[]>(
    () => documentsApi.list(applicationId),
    applicationId,
    { enabled: Boolean(applicationId) },
  );

  const upload = useCallback(
    async (input: {
      uri: string;
      fileName: string;
      mimeType?: string | null;
      sizeBytes?: number | null;
    }): Promise<void> => {
      setError(null);
      try {
        const handle = uploadDocument({ applicationId, ...input }, setProgress);
        cancelRef.current = handle.cancel;
        await handle.promise;
        await documents.refresh();
      } catch (e) {
        if (e instanceof DocumentValidationError) {
          setError(
            e.reason === 'too-large'
              ? t('documents.tooLarge', { max: e.maxMb ?? 20 })
              : t('documents.badType'),
          );
        } else {
          setError(isApiError(e) ? e.userMessage : t('documents.uploadFailed'));
        }
      } finally {
        setProgress(null);
        cancelRef.current = null;
      }
    },
    [applicationId, documents, t],
  );

  const capture = async (): Promise<void> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera permission is required to photograph a document.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      // The built-in editor gives crop + rotate without shipping our own.
      allowsEditing: true,
      quality: 0.9,
      exif: false, // strip location metadata — a document photo should not carry GPS
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    const quality = assessImageQuality({
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      sizeBytes: asset.fileSize ?? null,
    });
    // Warn, never block: a poor scan of the only copy of a document must still
    // be uploadable.
    setWarning(quality.acceptable ? null : t('documents.blurry'));

    // Downscale very large captures before upload — a 12 MP photo is far more
    // than OCR needs and costs the user real cellular data.
    const processed = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: Math.min(asset.width ?? 2000, 2400) } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );

    await upload({
      uri: processed.uri,
      fileName: `capture-${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: null,
    });
  };

  const pickImage = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.9, exif: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await upload({
      uri: asset.uri,
      fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      sizeBytes: asset.fileSize ?? null,
    });
  };

  const pickFile = async (): Promise<void> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await upload({
      uri: asset.uri,
      fileName: asset.name,
      mimeType: asset.mimeType ?? null,
      sizeBytes: asset.size ?? null,
    });
  };

  return (
    <Screen testID="documents-screen">
      <Txt variant="display">{t('documents.title')}</Txt>

      {error ? <Banner tone="error" title={t('documents.uploadFailed')} body={error} /> : null}
      {warning ? <Banner tone="warning" title={warning} /> : null}

      {progress ? (
        <Card testID="upload-progress">
          <Txt variant="label">
            {progress.stage === 'uploading'
              ? `${t('documents.uploading')} ${Math.round(progress.fraction * 100)}%`
              : t('documents.processing')}
          </Txt>
          <Button
            title={t('documents.cancelUpload')}
            variant="ghost"
            onPress={() => void cancelRef.current?.()}
            testID="cancel-upload"
          />
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Button title={t('documents.capture')} onPress={capture} testID="capture-button" />
          <Button
            title={t('documents.choose')}
            variant="secondary"
            onPress={pickImage}
            testID="pick-image-button"
          />
          <Button
            title={t('documents.file')}
            variant="secondary"
            onPress={pickFile}
            testID="pick-file-button"
          />
        </View>
      )}

      {documents.loading && !documents.data ? <Loading label={t('common.loading')} /> : null}

      {(documents.data ?? []).map((doc) => (
        <Card key={doc.id} testID={`document-${doc.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <Txt variant="label" style={{ flex: 1 }}>
              {doc.file_name}
            </Txt>
            <Badge
              label={doc.ocr_status ?? 'pending'}
              tone={
                doc.ocr_status === 'complete'
                  ? 'success'
                  : doc.ocr_status === 'failed'
                    ? 'danger'
                    : 'warning'
              }
            />
          </View>
          {doc.ocr_status === 'failed' ? (
            <Txt variant="caption" color={colors.paleStone}>
              {t('documents.ocrFailed')}
            </Txt>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
