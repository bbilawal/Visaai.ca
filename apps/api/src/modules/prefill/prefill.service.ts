import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  openRequestSlots,
  withOpenRequestSlots,
} from '../review-items/open-document-requests';
import {
  documentsCompletion,
  type PrefilledFormField,
  type PrefilledFormPayload,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { safeLog } from '../shared/log/redact';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import type { Env } from '../../config/configuration';
import { buildPrefillGraph } from './graphs/prefill.graph';
import {
  ROUTE_UNANSWERED_NOTE,
  UNANSWERED_NOTE,
} from './graphs/nodes/finalize-fields';
import { renderPrefilledFormPdf } from './prefill-pdf';
import { tryRenderOfficialForm, isOfficialFormSupported } from './forms';
import { preparedFormNote } from '../../strategies/form-mapping/prepared-forms';
import { PreflightFieldEditService } from '../preflight/preflight-field-edit.service';

const FORM_CHANGED_MESSAGE =
  'This form changed since you opened it (your consultant may have corrected it). Reload to see the latest values, then make your change again.';

/** Keys whose value differs between two versions of the form (incl. added/removed). */
export function changedFormKeys(
  before: PrefilledFormField[] | null | undefined,
  after: PrefilledFormField[] | null | undefined,
): string[] {
  const a = new Map((before ?? []).map((f) => [f.key, f.value]));
  const b = new Map((after ?? []).map((f) => [f.key, f.value]));
  const out: string[] = [];
  for (const [k, v] of b) if (a.get(k) !== v) out.push(k);
  for (const k of a.keys()) if (!b.has(k)) out.push(k);
  return out;
}

/** Opaque version token: the hash of the stored form JSON. */
function formVersion(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

@Injectable()
export class PrefillService {
  private readonly openaiKey: string;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService<Env>,
    private meter: AiUsageMeter,
    private formListener: PreflightFieldEditService,
  ) {
    this.openaiKey = this.config.get('OPENAI_API_KEY', { infer: true })!;
  }

  private async verifyOwnership(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    const { data } = await db
      .from('applications')
      .select('id')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();
    if (!data) throw new ForbiddenException('Access denied');
  }

  async generate(db: SupabaseClient, applicationId: string, userId: string) {
    await this.verifyOwnership(db, applicationId, userId);
    // Reuse the same preferred_language read used for PDF rendering (no double
    // fetch) so generated field labels/groups come back in the user's language.
    const language = await this.resolveLocale(db, userId);
    // F1: per-request graph with the scoped client.
    const graph = buildPrefillGraph(db, this.openaiKey, language, this.meter, {
      applicationId,
      userId,
    });
    const before = await this.loadRecord(db, applicationId);
    const result = await graph.invoke({ applicationId });
    // Regenerating rewrites values: un-tick any in-progress review category
    // that covered a value which moved.
    const changed = changedFormKeys(
      before?.payload.fields,
      (result.payload as PrefilledFormPayload | undefined)?.fields,
    );
    if (changed.length > 0)
      await this.formListener.onApplicantFormSaved(applicationId, changed);
    const after = await this.loadRecord(db, applicationId);
    return {
      generatedDocumentId: result.generatedDocumentId,
      payload: result.payload,
      version: after ? formVersion(after.raw) : null,
      paid: await this.hasPaid(db, applicationId),
    };
  }

  /**
   * Auto-fill once every required document is verified. Called by the documents
   * BullMQ processor (no user request context), so it uses the service-role
   * client. Free to run; downloading/portal auto-fill remain paid.
   */
  async autoGenerateIfReady(applicationId: string): Promise<boolean> {
    const admin = this.supabase.admin;
    const { data: items } = await admin
      .from('checklist_items')
      .select('id, status, required, meta')
      .eq('application_id', applicationId);

    // A slot whose document the consultant sent back does not count (same
    // rule as the vault and progress). Unreadable: do not auto-generate yet —
    // the next processed upload tries again.
    let requestSlots: Set<string>;
    try {
      requestSlots = await openRequestSlots(admin, applicationId);
    } catch (err) {
      safeLog.warn(
        'prefill.auto',
        `skipped for ${applicationId}: open document requests unreadable: ${(err as Error).message}`,
      );
      return false;
    }

    // Shared with the documents page's Generate gate and computeProgress —
    // see documentsCompletion in @visaai/types. A local copy of this rule would
    // let the button say "ready" while the server disagrees.
    const { complete } = documentsCompletion(
      withOpenRequestSlots(items ?? [], requestSlots),
    );
    if (!complete) return false;

    // Don't overwrite an existing prefill (which the user may have edited).
    if (await this.loadRecord(admin, applicationId)) return false;

    // Background path (no request context): resolve the owning user's language
    // so the auto-generated labels/groups still respect their preference.
    const language = await this.resolveLocaleForApplication(
      admin,
      applicationId,
    );
    const graph = buildPrefillGraph(admin, this.openaiKey, language);
    await graph.invoke({ applicationId });
    return true;
  }

  async get(db: SupabaseClient, applicationId: string, userId: string) {
    await this.verifyOwnership(db, applicationId, userId);
    const record = await this.loadRecord(db, applicationId);
    return {
      payload: record?.payload ?? null,
      generatedDocumentId: record?.id ?? null,
      // Send this back with updateFields: a save based on an older copy is
      // refused instead of silently overwriting a newer (e.g. consultant) edit.
      version: record ? formVersion(record.raw) : null,
      approved: record?.approved ?? false,
      paid: await this.hasPaid(db, applicationId),
    };
  }

  /** Throw HTTP 402 when the one-time form fee hasn't been paid for this visa. */
  private async requirePaid(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<void> {
    if (!(await this.hasPaid(db, applicationId))) {
      throw new HttpException(
        'Pay the one-time form fee to download or submit this application',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async updateFields(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    fields: PrefilledFormField[],
    baseVersion?: string,
  ) {
    await this.verifyOwnership(db, applicationId, userId);
    const record = await this.loadRecord(db, applicationId);
    if (!record)
      throw new NotFoundException('No prefilled form yet — generate one first');

    if (!Array.isArray(fields))
      throw new BadRequestException('fields must be an array');

    // Optimistic concurrency: the client saves the WHOLE field list, so a save
    // built from an older copy would revert anything changed since — notably
    // a consultant's correction, which is what auto-fill writes.
    if (baseVersion && baseVersion !== formVersion(record.raw)) {
      throw new ConflictException(FORM_CHANGED_MESSAGE);
    }

    const storedByKey = new Map(record.payload.fields.map((f) => [f.key, f]));

    // Legacy client (no token): never let it overwrite a consultant correction.
    if (!baseVersion) {
      const incoming = new Map(fields.map((f) => [String(f.key ?? ''), f]));
      for (const prev of record.payload.fields) {
        if (prev.source !== 'consultant') continue;
        const next = incoming.get(prev.key);
        const nextValue = next?.value == null ? '' : String(next.value);
        if (!next || nextValue !== prev.value) {
          throw new ConflictException(FORM_CHANGED_MESSAGE);
        }
      }
    }

    const changedKeys: string[] = [];
    const sanitized: PrefilledFormField[] = fields
      .map((f): PrefilledFormField => {
        const key = String(f.key ?? '');
        const value = f.value == null ? '' : String(f.value);
        const prev = storedByKey.get(key);
        const changed = !prev || prev.value !== value;
        if (changed && key) changedKeys.push(key);
        // The source is the SERVER's record of who set the value. A client
        // could otherwise label its own value "consultant". Unchanged keeps
        // the stored source (none, for a question nobody has answered yet);
        // a changed or new value is the applicant's.
        const source: PrefilledFormField['source'] = changed
          ? 'applicant'
          : prev
            ? prev.source
            : 'profile';
        // An IRCC question VisaAI added unanswered stops asking once the
        // applicant answers it.
        const answered =
          (f.note === UNANSWERED_NOTE || f.note === ROUTE_UNANSWERED_NOTE) &&
          value.trim() !== '';
        return {
          key,
          label: String(f.label ?? f.key ?? ''),
          value,
          group: f.group ? String(f.group) : undefined,
          ...(source ? { source } : {}),
          // Keep the review note on save: a host's email the applicant left in
          // place is still the host's email.
          ...(f.note && !answered ? { note: String(f.note) } : {}),
          ...(f.needsReview === true && !answered ? { needsReview: true } : {}),
        };
      })
      .filter((f) => f.key);
    // A key the applicant removed is a change too.
    const keptKeys = new Set(sanitized.map((f) => f.key));
    for (const prev of record.payload.fields)
      if (!keptKeys.has(prev.key)) changedKeys.push(prev.key);

    const payload: PrefilledFormPayload = {
      ...record.payload,
      fields: sanitized,
    };
    const raw = JSON.stringify(payload);
    const { error } = await db
      .from('generated_documents')
      .update({ content_md: raw })
      .eq('id', record.id);
    if (error) throw new Error(`Failed to update fields: ${error.message}`);

    if (changedKeys.length > 0) {
      // A changed auto-fill value un-ticks its category in an in-progress
      // review (a completed lock breaks by hash on its own).
      await this.formListener.onApplicantFormSaved(applicationId, changedKeys);
    }
    return { payload, version: formVersion(raw) };
  }

  async approve(db: SupabaseClient, applicationId: string, userId: string) {
    await this.verifyOwnership(db, applicationId, userId);
    const record = await this.loadRecord(db, applicationId);
    if (!record) throw new NotFoundException('No prefilled form yet');
    const { error } = await db
      .from('generated_documents')
      .update({ approved_by_user: true })
      .eq('id', record.id);
    if (error) throw new Error(`Failed to approve form: ${error.message}`);
    return { approved: true };
  }

  async getPdf(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ): Promise<Uint8Array> {
    await this.verifyOwnership(db, applicationId, userId);
    await this.requirePaid(db, applicationId);
    const record = await this.loadRecord(db, applicationId);
    if (!record) throw new NotFoundException('No prefilled form yet');
    const locale = await this.resolveLocale(db, userId);
    return renderPrefilledFormPdf(record.payload, locale);
  }

  async getOfficialPdf(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    formCode: string,
  ): Promise<Uint8Array> {
    await this.verifyOwnership(db, applicationId, userId);
    await this.requirePaid(db, applicationId);
    const record = await this.loadRecord(db, applicationId);
    if (!record) throw new NotFoundException('No prefilled form yet');

    // Some forms are prepared from answers the saved form never carried
    // (IMM 5476's representative), so the renderer also gets the profile.
    const { data: profileRow } = await db
      .from('application_profiles')
      .select('profile_json')
      .eq('application_id', applicationId)
      .maybeSingle();
    const rawProfile = (profileRow as { profile_json?: unknown } | null)
      ?.profile_json;
    const profile =
      rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? (rawProfile as Record<string, unknown>)
        : {};

    const filled = await tryRenderOfficialForm(formCode, record.payload, {
      profile,
    });
    if (!filled && preparedFormNote(formCode)) {
      // IMM 5476 is skipped when no representative is used; IMM 1294 always
      // renders, so a null there is a failure to prepare it.
      throw new NotFoundException(
        /5476/.test(formCode)
          ? `${formCode} is not needed: your application does not record a representative`
          : `${formCode} could not be prepared from your application — fill in the official form from your IRCC account`,
      );
    }
    if (!filled) {
      throw new HttpException(
        `Official template for ${formCode} is not available — download the formatted summary instead`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return filled;
  }

  async listAvailableOfficialForms(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    await this.verifyOwnership(db, applicationId, userId);
    // Pull form items from the application's checklist so we expose download
    // buttons only for forms the user actually needs.
    const { data: items } = await db
      .from('checklist_items')
      .select('meta')
      .eq('application_id', applicationId);

    const forms = (items ?? [])
      .map(
        (i) =>
          i.meta as {
            kind?: string;
            owner?: string;
            form_code?: string;
            form_name?: string;
          } | null,
      )
      .filter(
        (
          m,
        ): m is {
          kind: string;
          owner?: string;
          form_code: string;
          form_name?: string;
        } => !!m && m.kind === 'form' && typeof m.form_code === 'string',
      );

    return {
      forms: forms.map((f) => ({
        form_code: f.form_code,
        form_name: f.form_name ?? f.form_code,
        owner: f.owner === 'sponsor' ? 'sponsor' : 'applicant',
        official_supported: isOfficialFormSupported(f.form_code),
        // Set for forms VisaAI prepares from the application (IMM 5476):
        // the download is an answer sheet to copy, print and sign.
        prepared_note: preparedFormNote(f.form_code) ?? null,
      })),
    };
  }

  async getFillInstructions(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    await this.verifyOwnership(db, applicationId, userId);
    const record = await this.loadRecord(db, applicationId);
    if (!record) throw new NotFoundException('No prefilled form yet');

    return {
      visaType: record.payload.visaType,
      countryCode: record.payload.countryCode,
      fields: record.payload.fields.map((f) => ({
        key: f.key,
        label: f.label,
        value: f.value,
      })),
    };
  }

  async hasPaid(db: SupabaseClient, applicationId: string): Promise<boolean> {
    const { data } = await db
      .from('payments')
      .select('id')
      .eq('application_id', applicationId)
      .eq('feature', 'prefill')
      .eq('status', 'complete')
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  private async loadRecord(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<{
    id: string;
    raw: string;
    payload: PrefilledFormPayload;
    approved: boolean;
  } | null> {
    const { data } = await db
      .from('generated_documents')
      .select('id, content_md, approved_by_user')
      .eq('application_id', applicationId)
      .eq('doc_type', 'prefilled_form_json')
      .maybeSingle();

    if (!data) return null;
    const row: {
      id: string;
      content_md: string;
      approved_by_user: boolean;
    } = data;
    try {
      const payload = JSON.parse(row.content_md) as PrefilledFormPayload;
      return {
        id: row.id,
        raw: row.content_md,
        payload,
        approved: row.approved_by_user,
      };
    } catch {
      return null;
    }
  }

  /** UI locale for PDF rendering; mirrors users.preferred_language. */
  private async resolveLocale(
    db: SupabaseClient,
    userId: string,
  ): Promise<string> {
    const { data } = await db
      .from('users')
      .select('preferred_language')
      .eq('id', userId)
      .maybeSingle();
    return (data?.preferred_language as string | null) || 'en';
  }

  /** Background variant: resolve the owning user's locale from an applicationId
   *  (no userId in scope on the auto-generate path). Falls back to 'en'. */
  private async resolveLocaleForApplication(
    db: SupabaseClient,
    applicationId: string,
  ): Promise<string> {
    const { data: app } = await db
      .from('applications')
      .select('user_id')
      .eq('id', applicationId)
      .maybeSingle<{ user_id: string }>();
    if (!app?.user_id) return 'en';
    return this.resolveLocale(db, app.user_id);
  }
}
