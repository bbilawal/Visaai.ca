import { File, Paths, UploadTask, UploadType } from 'expo-file-system';
import type { Document } from '@visaai/types';
import { documentsApi } from '@/api/endpoints';
import { ApiError, isApiError } from '@/api/errors';
import { analytics, EVENTS } from '@/analytics/analytics';
import { validateDocument } from './validation';

/**
 * Document upload pipeline.
 *
 *   presign (API, RLS-scoped)  →  PUT bytes to Supabase Storage  →  register (API)
 *
 * The bytes go straight from the device to storage using a short-lived signed
 * URL, so the API never proxies a passport scan and no immigration document is
 * buffered in application memory on the server.
 *
 * Local copies: the picker writes a temporary file into the app cache. We delete
 * it after a successful upload. Immigration documents must not accumulate in a
 * cache directory that survives sign-out or lands in a device backup.
 */
export type UploadStage = 'validating' | 'preparing' | 'uploading' | 'registering' | 'done';

export interface UploadProgress {
  stage: UploadStage;
  /** 0..1, only meaningful during `uploading`. */
  fraction: number;
}

export interface UploadRequest {
  applicationId: string;
  uri: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  checklistItemId?: string;
}

export interface UploadHandle {
  promise: Promise<Document>;
  /** Aborts the in-flight transfer; the promise rejects with kind 'timeout'. */
  cancel: () => Promise<void>;
}

export class DocumentValidationError extends Error {
  constructor(readonly reason: string, readonly maxMb?: number) {
    super(`Document rejected: ${reason}`);
    this.name = 'DocumentValidationError';
  }
}

/**
 * Upload one document. Returns a handle so the caller can cancel — a user on a
 * train who realises they picked the wrong file should not have to wait out a
 * 20 MB transfer.
 */
export function uploadDocument(
  request: UploadRequest,
  onProgress?: (p: UploadProgress) => void,
): UploadHandle {
  let uploadTask: UploadTask | null = null;
  let cancelled = false;

  const promise = (async (): Promise<Document> => {
    onProgress?.({ stage: 'validating', fraction: 0 });

    const validation = validateDocument({
      fileName: request.fileName,
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
    });
    if (!validation.ok) {
      analytics.track(EVENTS.documentUploadFailed, { reason: validation.reason });
      throw new DocumentValidationError(
        validation.reason,
        'maxMb' in validation ? validation.maxMb : undefined,
      );
    }

    analytics.track(EVENTS.documentUploadStarted, { mime: validation.mimeType });
    onProgress?.({ stage: 'preparing', fraction: 0 });

    const presign = await documentsApi.presign(request.applicationId, {
      fileName: validation.fileName,
      mimeType: validation.mimeType,
    });

    // 'cancelled', not 'timeout': timeout is in DEFAULT_RETRYABLE, so a
    // cancelled 20 MB passport scan was re-uploaded up to three times.
    if (cancelled) throw new ApiError({ kind: 'cancelled', status: 0, message: 'Upload cancelled' });

    onProgress?.({ stage: 'uploading', fraction: 0 });

    // expo-file-system (SDK 54+) is the File/Directory API; uploads go through a
    // task created from the source File rather than a module-level helper.
    const source = new File(request.uri);
    uploadTask = source.createUploadTask(presign.uploadUrl, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: validation.mimeType,
      headers: {
        'Content-Type': validation.mimeType,
        // Supabase signed-upload URLs authorise via the token in the URL; the
        // user's JWT is deliberately NOT sent to the storage host.
        'x-upsert': 'false',
      },
      onProgress: ({ bytesSent, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : 1;
        onProgress?.({ stage: 'uploading', fraction: bytesSent / total });
      },
    });

    let result;
    try {
      result = await uploadTask.uploadAsync();
    } catch (err) {
      // The native task REJECTS on cancel; without this it fell through as an
      // unknown error and was retried.
      if (cancelled) {
        throw new ApiError({ kind: 'cancelled', status: 0, message: 'Upload cancelled' });
      }
      throw err;
    }
    if (cancelled) throw new ApiError({ kind: 'cancelled', status: 0, message: 'Upload cancelled' });
    if (!result || result.status >= 300) {
      analytics.track(EVENTS.documentUploadFailed, { status: result?.status ?? 0 });
      throw new ApiError({
        kind: result && result.status >= 500 ? 'server' : 'unknown',
        status: result?.status ?? 0,
        message: 'Upload to storage failed',
      });
    }

    onProgress?.({ stage: 'registering', fraction: 1 });

    const document = await documentsApi.register(request.applicationId, {
      storagePath: presign.storagePath,
      mimeType: validation.mimeType,
      fileName: validation.fileName,
      checklistItemId: request.checklistItemId,
    });

    // Drop the picker's temp copy now that storage owns the bytes.
    await deleteLocalCopy(request.uri);

    analytics.track(EVENTS.documentUploadSucceeded, { mime: validation.mimeType });
    onProgress?.({ stage: 'done', fraction: 1 });
    return document;
  })();

  return {
    promise,
    cancel: async () => {
      // Set FIRST: during the presign round-trip `uploadTask` is still null, so
      // the flag is the only thing that can stop the transfer starting.
      cancelled = true;
      try {
        // No-op once the task reached a terminal state, per the SDK contract.
        uploadTask?.cancel();
      } catch {
        // Cancelling an already-released task can throw; nothing to do.
      }
      // The picker's temp copy is ours to clean up on this path too.
      await deleteLocalCopy(request.uri);
    },
  };
}

/**
 * Best-effort deletion of a cached pick/capture. Only touches the app's own
 * cache directory — never the user's photo library, which we must not mutate.
 */
export async function deleteLocalCopy(uri: string): Promise<void> {
  try {
    const cacheDir = Paths.cache.uri;
    if (!cacheDir || !uri.startsWith(cacheDir)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A failed cleanup must not fail the upload the user already completed.
  }
}

/**
 * Retry wrapper. Only retries transport-class failures: a rejected file type or
 * a 403 will fail identically forever, and re-uploading a 20 MB scan to prove
 * that wastes the user's data plan.
 */
export async function uploadWithRetry(
  request: UploadRequest,
  onProgress?: (p: UploadProgress) => void,
  maxAttempts = 3,
): Promise<Document> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await uploadDocument(request, onProgress).promise;
    } catch (e) {
      lastError = e;
      if (e instanceof DocumentValidationError) throw e;
      if (isApiError(e) && (e.kind === 'cancelled' || !e.retryable)) throw e;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
