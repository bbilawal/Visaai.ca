import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';

export type RevisionSource = 'form' | 'document';
export type ChangeKind = 'first_cache' | 'revision' | 'silent_reissue';

export interface TemplateRevisionRow {
  id: string;
  source: RevisionSource;
  country_code: string;
  program: string;
  code: string;
  name: string;
  change_kind: ChangeKind;
  previous_sha256: string | null;
  new_sha256: string;
  previous_version_label: string | null;
  new_version_label: string | null;
  previous_field_count: number | null;
  new_field_count: number | null;
  resolved_url: string | null;
  byte_size: number | null;
  storage_path: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export interface RecordRevisionInput {
  source: RevisionSource;
  countryCode: string;
  program: string;
  code: string;
  name: string;
  previousSha256: string | null;
  newSha256: string;
  previousVersionLabel: string | null;
  newVersionLabel: string | null;
  previousFieldCount?: number | null;
  newFieldCount?: number | null;
  resolvedUrl?: string | null;
  byteSize?: number | null;
  storagePath?: string | null;
}

/**
 * Classify what actually happened, because the three cases carry very
 * different risk.
 *
 * `silent_reissue` — same version label, different bytes — is the one that
 * matters most. The label is what a human reads to decide "nothing changed";
 * when the authority re-issues under it, any field mapping built against the
 * old revision keeps filling boxes that may have moved, and it looks entirely
 * correct on the way out. That is why the checksum exists at all, and why it
 * gets its own kind here rather than being folded into 'revision'.
 */
export function classifyChange(
  previousSha256: string | null,
  previousLabel: string | null,
  newLabel: string | null,
): ChangeKind {
  if (!previousSha256) return 'first_cache';
  return previousLabel === newLabel ? 'silent_reissue' : 'revision';
}

/**
 * Append-only history for both caches.
 *
 * Uses `SupabaseService.admin` on the same grounds as the template stores: the
 * writer is a background job with no request context, and the rows are not
 * user-owned. The table carries no RLS policy at all, so nothing but the
 * service role can reach it.
 */
@Injectable()
export class TemplateRevisionStore {
  private readonly log = new Logger(TemplateRevisionStore.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Never throws.
   *
   * The ledger is observability, not the product. A refresh run that
   * successfully cached a new government form must not be reported as failed
   * because the audit insert hit a constraint or the DB blipped — that would
   * turn a working cache into a `stale` row and cost applicants the very
   * document we just fetched. A failure here is logged at ERROR and swallowed.
   */
  async record(input: RecordRevisionInput): Promise<void> {
    const change_kind = classifyChange(
      input.previousSha256,
      input.previousVersionLabel,
      input.newVersionLabel,
    );
    try {
      const { error } = await this.supabase.admin
        .from('template_revisions')
        .insert({
          source: input.source,
          country_code: input.countryCode,
          program: input.program,
          code: input.code,
          name: input.name,
          change_kind,
          previous_sha256: input.previousSha256,
          new_sha256: input.newSha256,
          previous_version_label: input.previousVersionLabel,
          new_version_label: input.newVersionLabel,
          previous_field_count: input.previousFieldCount ?? null,
          new_field_count: input.newFieldCount ?? null,
          resolved_url: input.resolvedUrl ?? null,
          byte_size: input.byteSize ?? null,
          storage_path: input.storagePath ?? null,
        });
      if (error) throw new Error(error.message);

      // A silent re-issue is worth a line in the log on its own, because it is
      // the case a human reading version labels would otherwise never see.
      if (change_kind === 'silent_reissue') {
        this.log.warn(
          `${input.countryCode}/${input.code}: bytes changed under an UNCHANGED ` +
            `version label (${input.newVersionLabel ?? 'none'}) — review any field mapping`,
        );
      } else {
        this.log.log(
          `${input.countryCode}/${input.code}: ${change_kind} ` +
            `(${input.previousVersionLabel ?? '-'} → ${input.newVersionLabel ?? '-'})`,
        );
      }
    } catch (err) {
      this.log.error(
        `failed to record revision for ${input.countryCode}/${input.code}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Unreviewed changes, newest first. The ops queue. */
  async listUnreviewed(limit = 50): Promise<TemplateRevisionRow[]> {
    const { data, error } = await this.supabase.admin
      .from('template_revisions')
      .select('*')
      .is('reviewed_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error)
      throw new Error(`template_revisions read failed: ${error.message}`);
    return (data as TemplateRevisionRow[] | null) ?? [];
  }

  async listRecent(limit = 100): Promise<TemplateRevisionRow[]> {
    const { data, error } = await this.supabase.admin
      .from('template_revisions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error)
      throw new Error(`template_revisions read failed: ${error.message}`);
    return (data as TemplateRevisionRow[] | null) ?? [];
  }

  async markReviewed(id: string, userId: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('template_revisions')
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq('id', id);
    if (error)
      throw new Error(`template_revisions update failed: ${error.message}`);
  }
}
