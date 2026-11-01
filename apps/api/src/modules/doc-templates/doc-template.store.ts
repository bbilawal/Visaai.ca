import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { DocumentTemplateKind } from '../../strategies/types';

export const DOCUMENT_TEMPLATES_BUCKET = 'document-templates';

export interface DocumentTemplateRow {
  id: string;
  country_code: string;
  program: string;
  template_code: string;
  template_name: string;
  kind: DocumentTemplateKind;
  document_code: string | null;
  source_url: string;
  resolved_pdf_url: string | null;
  version_label: string | null;
  storage_path: string | null;
  sha256: string | null;
  byte_size: number | null;
  content_type: string | null;
  fetched_at: string | null;
  last_checked_at: string | null;
  /** Last SUCCESSFUL verification against the authority. See ../forms/freshness.ts. */
  last_verified_at: string | null;
  status: 'ok' | 'stale' | 'blocked' | 'link_only' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentTemplateKey = {
  countryCode: string;
  program: string;
  templateCode: string;
};

export type DocumentTemplateUpsert = Partial<
  Omit<DocumentTemplateRow, 'id' | 'created_at' | 'updated_at'>
> &
  Pick<
    DocumentTemplateRow,
    'country_code' | 'program' | 'template_code' | 'source_url'
  >;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `<country>/<program>/<template-slug>/<version>[-<sha>].pdf`
 *
 * Identical path discipline to FormTemplateStore.storagePathFor, for the same
 * reasons and with the same failure in mind: every segment is slugged so a
 * `../` in a remotely-sourced version label can never escape the key, the
 * degenerate all-separator label collapses to `''` and falls back to
 * 'current', and the content hash is appended so a silent re-issue under an
 * unchanged label lands on a NEW key instead of overwriting a copy a live
 * signed URL still points at.
 */
export function documentStoragePathFor(
  key: DocumentTemplateKey,
  versionLabel: string | null,
  sha256?: string | null,
): string {
  const version = versionLabel ? slug(versionLabel) : 'current';
  const base = version || 'current';
  const suffix = sha256 ? `-${sha256.slice(0, 12)}` : '';
  return `${slug(key.countryCode).toUpperCase()}/${key.program}/${slug(
    key.templateCode,
  )}/${base}${suffix}.pdf`;
}

/**
 * The only code that touches `document_templates` or its bucket.
 *
 * Uses `SupabaseService.admin` throughout, on the same grounds as
 * FormTemplateStore: these rows are not user-owned, the writer is a background
 * job with no request context, and reads are mediated by a service that
 * authorises the application first.
 */
@Injectable()
export class DocumentTemplateStore {
  private readonly log = new Logger(DocumentTemplateStore.name);

  constructor(private readonly supabase: SupabaseService) {}

  async find(key: DocumentTemplateKey): Promise<DocumentTemplateRow | null> {
    const { data, error } = await this.supabase.admin
      .from('document_templates')
      .select('*')
      .eq('country_code', key.countryCode)
      .eq('program', key.program)
      .eq('template_code', key.templateCode)
      .maybeSingle();
    // `maybeSingle()` returns { data: null, error: null } for a genuine miss,
    // so only a real query failure throws here. Conflating the two would let
    // the refresh job treat a transient DB error as "never cached" and
    // overwrite a preserved storage_path/sha256 with nulls.
    if (error)
      throw new Error(`document_templates read failed: ${error.message}`);
    return (data as DocumentTemplateRow | null) ?? null;
  }

  /**
   * Best cached row for a template code, irrespective of program, scoped to
   * ONE country.
   *
   * Country is required, unlike FormTemplateStore.findByFormCode, because the
   * cross-country ambiguity that method has to detect at runtime is designed
   * out here: 'ICAO-PHOTO' legitimately exists for 29 Schengen countries, so
   * "rows span multiple countries" is the normal case, not a red flag. Asking
   * the caller for the country makes the safe choice the only expressible one.
   */
  async findByTemplateCode(
    countryCode: string,
    templateCode: string,
  ): Promise<DocumentTemplateRow | null> {
    const { data, error } = await this.supabase.admin
      .from('document_templates')
      .select('*')
      .eq('country_code', countryCode.toUpperCase())
      .eq('template_code', templateCode)
      .in('status', ['ok', 'stale'])
      .order('status', { ascending: true }); // 'ok' sorts before 'stale'
    if (error)
      throw new Error(`document_templates read failed: ${error.message}`);
    const rows = (data as DocumentTemplateRow[] | null) ?? [];
    return rows[0] ?? null;
  }

  async listAll(): Promise<DocumentTemplateRow[]> {
    const { data, error } = await this.supabase.admin
      .from('document_templates')
      .select('*')
      .order('last_checked_at', { nullsFirst: true });
    if (error)
      throw new Error(`document_templates read failed: ${error.message}`);
    return (data as DocumentTemplateRow[] | null) ?? [];
  }

  async upsert(row: DocumentTemplateUpsert): Promise<void> {
    const { error } = await this.supabase.admin
      .from('document_templates')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'country_code,program,template_code' },
      );
    if (error)
      throw new Error(`document_templates upsert failed: ${error.message}`);
  }

  // `upsert: true` overwrites in place. Safe only because the path is version-
  // AND content-scoped and callers compare sha256 first, so new bytes always
  // get a new key. Keeping the previous revision available is therefore a
  // caller obligation, exactly as in FormTemplateStore.
  async putBytes(
    storagePath: string,
    bytes: Uint8Array,
    contentType = 'application/pdf',
  ): Promise<void> {
    const { error } = await this.supabase.admin.storage
      .from(DOCUMENT_TEMPLATES_BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (error)
      throw new Error(`document template upload failed: ${error.message}`);
  }

  async getBytes(storagePath: string): Promise<Uint8Array | null> {
    const { data, error } = await this.supabase.admin.storage
      .from(DOCUMENT_TEMPLATES_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async signedUrl(
    storagePath: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.admin.storage
      .from(DOCUMENT_TEMPLATES_BUCKET)
      .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data) {
      this.log.warn(
        `signed URL failed for ${storagePath}: ${error?.message ?? 'no data'}`,
      );
      return null;
    }
    return data.signedUrl;
  }
}
