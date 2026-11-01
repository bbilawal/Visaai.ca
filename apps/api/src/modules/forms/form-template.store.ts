import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { FormCapability } from './capability/form-capability.probe';

export const FORM_TEMPLATES_BUCKET = 'form-templates';

export interface FormTemplateRow {
  id: string;
  country_code: string;
  program: string;
  form_code: string;
  form_name: string;
  landing_url: string;
  resolved_pdf_url: string | null;
  version_label: string | null;
  storage_path: string | null;
  sha256: string | null;
  byte_size: number | null;
  capability: FormCapability;
  field_count: number | null;
  fetched_at: string | null;
  last_checked_at: string | null;
  /** Last SUCCESSFUL verification against the authority. See freshness.ts. */
  last_verified_at: string | null;
  status: 'ok' | 'stale' | 'blocked' | 'error';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type FormTemplateKey = {
  countryCode: string;
  program: string;
  formCode: string;
};

export type FormTemplateUpsert = Partial<
  Omit<FormTemplateRow, 'id' | 'created_at' | 'updated_at'>
> &
  Pick<
    FormTemplateRow,
    'country_code' | 'program' | 'form_code' | 'landing_url'
  >;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `<country>/<program>/<form-slug>/<version>.pdf`
 *
 * Version-scoped so a revision lands beside its predecessor instead of
 * overwriting it — a signed URL already handed to a user keeps resolving, and
 * the previous revision stays available if the new one turns out to be wrong.
 *
 * Every segment is slugged: form codes contain spaces and slashes, and a
 * version label is attacker-adjacent input (it comes from a remote page), so
 * `../` must never survive into a storage key.
 *
 * `slug()` trims leading/trailing separators, so a label that is nothing but
 * separators (`'..'`, `'-'`, whitespace — portals commonly render missing
 * metadata this way) collapses to `''` and the `|| 'current'` fallback below
 * fires. Without the trim, degenerate labels like those would all slug to a
 * bare `'-'`, which is truthy, so the fallback would never run and distinct
 * "no version" pages would silently overwrite each other at the same `-.pdf`
 * path via `putBytes`'s `upsert: true` — exactly what version-scoping this
 * path exists to prevent.
 *
 * `sha256`, when given, is appended as a short content-addressed suffix.
 * Version scoping alone is not enough: a portal can re-issue different bytes
 * under the SAME version label (a silent re-issue, or a label IRCC reuses),
 * and `putBytes` upserts in place — two different files would otherwise land
 * on the same key and the second overwrite would destroy a live cached copy.
 * The parameter is optional so every existing call site that passes only
 * (key, versionLabel) keeps its exact prior path.
 */
export function storagePathFor(
  key: FormTemplateKey,
  versionLabel: string | null,
  sha256?: string | null,
): string {
  const version = versionLabel ? slug(versionLabel) : 'current';
  const base = version || 'current';
  const suffix = sha256 ? `-${sha256.slice(0, 12)}` : '';
  return `${slug(key.countryCode).toUpperCase()}/${key.program}/${slug(
    key.formCode,
  )}/${base}${suffix}.pdf`;
}

/**
 * The only code that touches `form_templates` or the `form-templates` bucket.
 *
 * Uses `SupabaseService.admin` throughout. That is correct here and is not the
 * usual RLS exception: these rows are not user-owned, the writer is a
 * background job with no request context, and reads are mediated by
 * FormsService, which authorises the application first.
 */
@Injectable()
export class FormTemplateStore {
  private readonly log = new Logger(FormTemplateStore.name);

  constructor(private readonly supabase: SupabaseService) {}

  async find(key: FormTemplateKey): Promise<FormTemplateRow | null> {
    const { data, error } = await this.supabase.admin
      .from('form_templates')
      .select('*')
      .eq('country_code', key.countryCode)
      .eq('program', key.program)
      .eq('form_code', key.formCode)
      .maybeSingle();
    // `maybeSingle()` does NOT error on zero rows — a genuine miss still
    // returns `data: null, error: null` and falls through to the `null`
    // below. Only a real query failure throws. Conflating the two would let
    // callers (Task 7's refresh) treat a transient DB error as "never
    // cached" and overwrite a preserved storage_path/sha256 with nulls.
    if (error) throw new Error(`form_templates read failed: ${error.message}`);
    return (data as FormTemplateRow | null) ?? null;
  }

  /**
   * Best cached row for a form code, irrespective of country/program — but
   * FAILS CLOSED the moment "irrespective of country" stops being safe.
   *
   * The renderer registry is keyed by form code alone, so this lookup matches
   * its semantics. A form required by several programs has one row per program
   * (the upsert key includes program) — IMM 5257 already has two, under
   * visitor_visa and family_sponsorship. Prefer a current copy over a stale
   * one; either is better than reading a hardcoded program's row.
   *
   * Only safe today because every cached row is CA. The day a second country
   * carries a same-coded form, picking "the best row" across countries would
   * hand PrefillModule's loader the WRONG country's blank PDF — it gets
   * filled with the applicant's data and returned looking entirely correct,
   * a silent wrong-form delivery (Important 4), strictly worse than the null
   * this method replaced. So: fetch every matching row (no `.limit(1)`) and
   * check BEFORE picking one. If the rows span more than one distinct
   * country_code, there is no safe choice — log which form code and which
   * countries collided, and return null so callers degrade the same way they
   * already do for "nothing cached", rather than guess.
   *
   * Verified: 'ok' < 'stale' under plain ASCII/default-collation ascending
   * order ('o' = 0x6F precedes 's' = 0x73), so `order('status', { ascending:
   * true })` genuinely prefers an 'ok' row over a 'stale' one when both exist
   * for the same form code — this is not an assumption.
   */
  async findByFormCode(formCode: string): Promise<FormTemplateRow | null> {
    const { data, error } = await this.supabase.admin
      .from('form_templates')
      .select('*')
      .eq('form_code', formCode)
      .in('status', ['ok', 'stale'])
      .order('status', { ascending: true }); // 'ok' sorts before 'stale'
    if (error) throw new Error(`form_templates read failed: ${error.message}`);

    const rows = (data as FormTemplateRow[] | null) ?? [];
    if (rows.length === 0) return null;

    const countries = new Set(rows.map((r) => r.country_code));
    if (countries.size > 1) {
      this.log.error(
        `findByFormCode(${formCode}): cached rows span multiple countries ` +
          `(${[...countries].join(', ')}) — refusing to guess which one ` +
          `applies; returning null`,
      );
      return null;
    }

    return rows[0];
  }

  async listAll(): Promise<FormTemplateRow[]> {
    const { data, error } = await this.supabase.admin
      .from('form_templates')
      .select('*')
      .order('last_checked_at', { nullsFirst: true });
    if (error) throw new Error(`form_templates read failed: ${error.message}`);
    return (data as FormTemplateRow[] | null) ?? [];
  }

  async upsert(row: FormTemplateUpsert): Promise<void> {
    // Read BEFORE writing: once the upsert lands, the row that is being
    // superseded no longer exists to compare against. This is the only moment
    // the previous revision is still knowable.
    const previous =
      row.sha256 && row.storage_path
        ? await this.find({
            countryCode: row.country_code,
            program: row.program,
            formCode: row.form_code,
          })
        : null;

    const { error } = await this.supabase.admin
      .from('form_templates')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'country_code,program,form_code' },
      );
    if (error)
      throw new Error(`form_templates upsert failed: ${error.message}`);

    if (row.sha256 && row.storage_path && previous?.sha256 !== row.sha256) {
      // Re-read for the id rather than asking the upsert to return it. Only the
      // change path pays for the extra query, and it is the rare one — a
      // steady-state refresh re-fetches identical bytes and never gets here.
      const id =
        previous?.id ??
        (
          await this.find({
            countryCode: row.country_code,
            program: row.program,
            formCode: row.form_code,
          })
        )?.id;
      if (id) await this.recordVersion(id, row);
    }
  }

  /**
   * File a new revision of a cached government form and retire the previous one.
   *
   * WHY THIS EXISTS
   *
   * `form_templates` has a UNIQUE index on (country_code, program, form_code),
   * so a new revision overwrites its predecessor's row. The BYTES survived that
   * — `storagePathFor` is version-scoped, so a revision lands at a new object
   * path — but every pointer to them did not. The previous PDF became an orphan
   * blob no query could find and no reviewer could compare against, which is not
   * what spec §9 means by "preserve history".
   *
   * The comment above `putBytes` used to call keeping that promise "a caller
   * obligation, not something this method enforces". This method enforces it,
   * because a codebase that has already lost nineteen months to two lists held
   * together by a comment should not accept another one.
   *
   * Failure here is logged, not thrown. The cached form and its bytes are
   * already safely written by the time this runs, and losing a history row is
   * strictly better than failing a refresh that otherwise succeeded — but it is
   * logged at error level because silent history loss is the actual bug.
   */
  private async recordVersion(
    formTemplateId: string,
    row: FormTemplateUpsert,
  ): Promise<void> {
    try {
      const { data: existing, error: readErr } = await this.supabase.admin
        .from('form_template_versions')
        .select('id, version_number, sha256, is_active')
        .eq('form_template_id', formTemplateId)
        .order('version_number', { ascending: false });
      if (readErr) throw new Error(readErr.message);

      const versions = (existing ?? []) as {
        id: string;
        version_number: number;
        sha256: string;
        is_active: boolean;
      }[];

      // Already filed. A refresh that re-fetches identical bytes must not mint a
      // second row for the same content — B-23 was exactly this shape on the
      // source side, where a re-queued version collided every night forever.
      if (versions.some((v) => v.sha256 === row.sha256)) return;

      // HIGHEST, not active. An inactive version above the active one is a
      // normal state, and numbering from the active one is what deadlocked
      // visa_source_versions in B-23.
      const next = (versions[0]?.version_number ?? 0) + 1;

      // Retire the incumbent first: a partial unique index permits exactly one
      // active row per form, so inserting before retiring would be refused.
      const active = versions.find((v) => v.is_active);
      if (active) {
        const { error: retireErr } = await this.supabase.admin
          .from('form_template_versions')
          .update({ is_active: false, superseded_at: new Date().toISOString() })
          .eq('id', active.id);
        if (retireErr) throw new Error(retireErr.message);
      }

      const { error: insErr } = await this.supabase.admin
        .from('form_template_versions')
        .insert({
          form_template_id: formTemplateId,
          version_number: next,
          sha256: row.sha256,
          storage_path: row.storage_path,
          version_label: row.version_label ?? null,
          byte_size: row.byte_size ?? null,
          capability: row.capability ?? null,
          field_count: row.field_count ?? null,
          resolved_pdf_url: row.resolved_pdf_url ?? null,
          is_active: true,
        });
      if (insErr) throw new Error(insErr.message);

      this.log.log(
        `${row.form_code}: filed version ${next}` +
          (active ? ` (superseded version ${active.version_number})` : ''),
      );
    } catch (e) {
      this.log.error(
        `form_template_versions write failed for ${row.form_code} — the form and ` +
          `its bytes are stored, but this revision has no history row: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // `upsert: true` overwrites in place at `storagePath`. That is safe only
  // because `storagePathFor` is version-scoped and callers compare sha256
  // before calling this — a *new* version gets a *new* path, so nothing at
  // an existing path is ever overwritten with different bytes. Keeping the
  // "previous revision stays available" promise is therefore a caller
  // obligation, not something this method enforces.
  async putBytes(storagePath: string, bytes: Uint8Array): Promise<void> {
    const { error } = await this.supabase.admin.storage
      .from(FORM_TEMPLATES_BUCKET)
      .upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (error) throw new Error(`form template upload failed: ${error.message}`);
  }

  async getBytes(storagePath: string): Promise<Uint8Array | null> {
    const { data, error } = await this.supabase.admin.storage
      .from(FORM_TEMPLATES_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async signedUrl(
    storagePath: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.admin.storage
      .from(FORM_TEMPLATES_BUCKET)
      .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  }
}
