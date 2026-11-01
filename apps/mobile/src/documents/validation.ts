/**
 * Client-side document validation.
 *
 * This is a *usability* layer, not a security boundary: it catches the 25 MB
 * screenshot before it wastes ten minutes of a cellular upload. The real
 * enforcement is server-side (Supabase Storage limits + the documents module),
 * and this file must never be the only thing standing between a user and a
 * malicious upload.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

export type ValidationFailure =
  | { ok: false; reason: 'too-large'; maxMb: number }
  | { ok: false; reason: 'bad-type' }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'bad-name' };

export type ValidationResult = { ok: true; mimeType: AllowedMime; fileName: string } | ValidationFailure;

const EXTENSION_MIME: Record<string, AllowedMime> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
};

/**
 * Filenames reach a storage path, so they are sanitised the same way the API
 * does (documents.service uses basename + a character allowlist). Doing it here
 * too means the user sees the corrected name before uploading rather than
 * finding a mangled one afterwards.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 120);
}

export function mimeFromName(fileName: string): AllowedMime | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? null;
}

export function validateDocument(input: {
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}): ValidationResult {
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName || fileName === '_') return { ok: false, reason: 'bad-name' };

  if (input.sizeBytes !== undefined && input.sizeBytes !== null) {
    if (input.sizeBytes <= 0) return { ok: false, reason: 'empty' };
    if (input.sizeBytes > MAX_FILE_BYTES) {
      return { ok: false, reason: 'too-large', maxMb: Math.floor(MAX_FILE_BYTES / (1024 * 1024)) };
    }
  }

  // Trust the extension over the reported MIME type: pickers on both platforms
  // hand back `application/octet-stream` for perfectly ordinary files, and a
  // caller-supplied MIME is not evidence of anything anyway.
  const byName = mimeFromName(fileName);
  const declared = (input.mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  const byDeclared = (ALLOWED_MIME_TYPES as readonly string[]).includes(declared)
    ? (declared as AllowedMime)
    : null;

  const resolved = byName ?? byDeclared;
  if (!resolved) return { ok: false, reason: 'bad-type' };

  return { ok: true, mimeType: resolved, fileName };
}

/**
 * Cheap capture-quality heuristic for a photographed document.
 *
 * Deliberately conservative — it warns, never blocks. A genuinely low-resolution
 * scan of a valid passport page must still be uploadable; false-rejecting a
 * user's only copy of a document is worse than sending a mediocre image to OCR.
 */
export interface QualityAssessment {
  acceptable: boolean;
  warnings: ('low-resolution' | 'extreme-aspect' | 'tiny-file')[];
}

export function assessImageQuality(input: {
  width: number;
  height: number;
  sizeBytes?: number | null;
}): QualityAssessment {
  const warnings: QualityAssessment['warnings'] = [];
  const shortEdge = Math.min(input.width, input.height);
  const longEdge = Math.max(input.width, input.height);

  // Below ~1000px on the short edge, OCR accuracy on passport MRZ lines drops sharply.
  if (shortEdge < 1000) warnings.push('low-resolution');
  // A very long, thin image is usually a mis-crop rather than a document.
  if (longEdge > 0 && longEdge / Math.max(shortEdge, 1) > 3) warnings.push('extreme-aspect');
  // A large image that compressed to almost nothing is typically blank or blurred.
  if (input.sizeBytes !== undefined && input.sizeBytes !== null && input.sizeBytes < 40_000) {
    warnings.push('tiny-file');
  }

  return { acceptable: warnings.length === 0, warnings };
}
