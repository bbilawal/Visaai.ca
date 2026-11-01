import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { PortalFillFile } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { loadPortalDocuments } from '../preflight/portal-documents';
import {
  IRCC_UPLOAD_SLOTS,
  type UploadSlot,
} from '../automation/portal-fills/ircc-uploads';
import { PR_UPLOAD_SLOTS } from '../automation/portal-fills/canada-ircc-pr-family';

/** IRCC /doc-upload: 5 MB per file; these formats. */
export const PORTAL_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const PORTAL_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
};

/** Every upload slot whose form must be signed, on any portal. */
const SIGNED_SLOTS: readonly UploadSlot[] = [
  ...IRCC_UPLOAD_SLOTS,
  ...PR_UPLOAD_SLOTS,
].filter((s) => s.signatureRequired);

/**
 * Whether the upload write with this field key (the mapping's profileKey,
 * `<portal>_upload_<slot key>`, carried in the signed intent) attaches a form
 * that must be signed. Matched on the `_upload_<key>` suffix so any portal's
 * prefix is covered; an over-match only makes the check stricter.
 */
export function uploadNeedsSignature(fieldKey: string): boolean {
  return SIGNED_SLOTS.some((s) => fieldKey.endsWith(`_upload_${s.key}`));
}

/**
 * Reads one of the application's documents for an 'attach_file' write. The
 * document must still be one the portal fill may attach (portal-documents.ts:
 * read successfully, not rejected or sent back) — a decision made after the
 * lock is honoured at dispatch — and must fit the portal's size and format
 * rules. For a form that must be signed (ircc-uploads.ts signatureRequired)
 * the consultant's approval — their "it is signed" check — must ALSO still
 * stand: document decisions are not in the lock hash, so an approval
 * withdrawn after the lock is only seen here. Null on any failure: the write
 * then fails and the slot is left.
 */
@Injectable()
export class PortalDocumentFiles {
  private readonly log = new Logger(PortalDocumentFiles.name);

  constructor(@Optional() private readonly supabase?: SupabaseService) {}

  async load(
    applicationId: string,
    documentId: string,
    fieldKey: string,
  ): Promise<PortalFillFile | null> {
    if (!this.supabase) return null;
    const db = this.supabase.admin;
    const eligible = await loadPortalDocuments(db as never, applicationId);
    const doc = eligible.find((d) => d.id === documentId);
    if (!doc) {
      this.log.warn(
        `attach refused (${fieldKey}): document ${documentId} is no longer attachable (rejected, sent back, unreadable or a duplicate)`,
      );
      return null;
    }
    if (uploadNeedsSignature(fieldKey) && !doc.approved) {
      this.log.warn(
        `attach refused (${fieldKey}): document ${documentId} is a form to sign and is no longer consultant-approved`,
      );
      return null;
    }

    const { data: row, error } = await db
      .from('documents')
      .select('storage_path, file_name, mime_type')
      .eq('application_id', applicationId)
      .eq('id', documentId)
      .maybeSingle();
    if (error || !row) return null;
    const r = row as {
      storage_path: string;
      file_name: string;
      mime_type: string;
    };
    if (!PORTAL_UPLOAD_TYPES[r.mime_type]) return null;

    const { data: blob, error: dlErr } = await db.storage
      .from('documents')
      .download(r.storage_path);
    if (dlErr || !blob) return null;
    const bytes = Buffer.from(await blob.arrayBuffer());
    return toPortalFile(r.file_name, r.mime_type, bytes);
  }
}

/** Bytes → the wire shape, or null when the portal would refuse the file. */
export function toPortalFile(
  name: string,
  mimeType: string,
  bytes: Buffer,
): PortalFillFile | null {
  if (bytes.length === 0 || bytes.length > PORTAL_UPLOAD_MAX_BYTES) return null;
  if (!PORTAL_UPLOAD_TYPES[mimeType]) return null;
  return {
    name,
    mimeType,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'),
  };
}
