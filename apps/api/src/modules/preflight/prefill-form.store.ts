import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { PrefilledFormPayload } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';

export interface PrefillFormRecord {
  id: string;
  /** The exact stored text — the optimistic-concurrency token for save(). */
  raw: string;
  payload: PrefilledFormPayload;
}

/**
 * Service-role access to the applicant's saved application form
 * (generated_documents, doc_type 'prefilled_form_json').
 *
 * Callers are the preflight mapping derivation (read) and the consultant field
 * edit (read + write). Authorization is the caller's job (route guards +
 * assignment checks) — this store only reads/writes the row.
 */
@Injectable()
export class PrefillFormStore {
  private readonly log = new Logger(PrefillFormStore.name);

  constructor(private readonly supabase: SupabaseService) {}

  async load(applicationId: string): Promise<PrefillFormRecord | null> {
    const { data, error } = await this.supabase.admin
      .from('generated_documents')
      .select('id, content_md')
      .eq('application_id', applicationId)
      .eq('doc_type', 'prefilled_form_json')
      .maybeSingle();
    // A swallowed read error would silently fall back to the intake profile —
    // exactly the stale value this store exists to replace. Fail loud.
    if (error)
      throw new Error(
        `could not load the saved form for ${applicationId}: ${error.message}`,
      );
    if (!data) return null;
    const raw = (data as { content_md: string | null }).content_md ?? '';
    try {
      const payload = JSON.parse(raw) as PrefilledFormPayload;
      if (!payload || !Array.isArray(payload.fields)) return null;
      return { id: (data as { id: string }).id, raw, payload };
    } catch {
      this.log.warn(`saved form for ${applicationId} is not valid JSON`);
      return null;
    }
  }

  /**
   * Write a new payload, but only if the row still holds `record.raw`. The
   * applicant edits the same document from the Forms page; a blind overwrite
   * would silently discard whichever save landed first.
   *
   * The compare is a re-read, not `.eq('content_md', raw)`: the form JSON is
   * tens of KB and PostgREST filters travel in the URL, which Kong rejects
   * above ~3.8KB. The re-read leaves a millisecond window, which is acceptable
   * for two humans editing the same form; the table has no version column.
   */
  async save(
    record: PrefillFormRecord,
    payload: PrefilledFormPayload,
  ): Promise<void> {
    const { data: now, error: readErr } = await this.supabase.admin
      .from('generated_documents')
      .select('content_md')
      .eq('id', record.id)
      .maybeSingle();
    if (readErr)
      throw new Error(`could not re-read the form: ${readErr.message}`);
    if (!now || now.content_md !== record.raw) {
      throw new ConflictException(
        'The application form changed while you were editing. Reload and try again.',
      );
    }
    const { error } = await this.supabase.admin
      .from('generated_documents')
      .update({ content_md: JSON.stringify(payload) })
      .eq('id', record.id);
    if (error) throw new Error(`could not save the form: ${error.message}`);
  }
}
