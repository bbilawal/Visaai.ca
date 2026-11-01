import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { basename } from 'path';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { DOCUMENT_QUEUE } from '../shared/queue/queue.constants';
import { safeLog } from '../shared/log/redact';
import type { Env } from '../../config/configuration';
import { reviewStoredCrossCheck } from './graphs/nodes/identity-compare';
import { makeSyncProfileNode } from './graphs/nodes/sync-profile';
import type { DocumentState } from './graphs/document.state';
import { HOLDER_CONFIRMATIONS_TABLE } from '../prefill/graphs/nodes/held-identity';
import type { AuthUser } from '../auth/jwt.guard';
import {
  isSuperseded,
  latestDocumentDecisions,
  type RequestDecisionRow,
} from '../review-items/open-document-requests';
import {
  isApplicantPhotoType,
  isPhotoDocumentType,
} from './ocr/extraction-schema';

/**
 * What the applicant sees of the consultant's review of one document: the
 * latest decision, its note and date. Never the reviewer's identity or role.
 * `open`: a needs_reupload / rejected request not yet answered by a newer
 * upload in the same slot — the vault stops counting that slot as verified.
 */
export interface ApplicantDocumentReview {
  decision: 'approved' | 'needs_reupload' | 'rejected';
  note: string | null;
  decided_at: string;
  open: boolean;
}

/** BullMQ states in which a re-read is already on its way. */
const PENDING_JOB_STATES = new Set([
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
]);

export interface DocumentJob {
  documentId: string;
  applicationId: string;
  storagePath: string;
  mimeType: string;
  documentType: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private supabase: SupabaseService,
    private config: ConfigService<Env>,
    @InjectQueue(DOCUMENT_QUEUE) private documentQueue: Queue<DocumentJob>,
  ) {}

  async getPresignedUploadUrl(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    fileName: string,
    _mimeType: string,
  ) {
    const { data: app } = await db
      .from('applications')
      .select('id, framework_id')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();

    // SEC-103: a bare Error maps to 500. This is an authorization denial — the
    // row is invisible under the caller's RLS scope — so it must answer 403,
    // matching VriService.verifyOwnership. Identical for a foreign id and a
    // nonexistent one, so it is not an existence oracle.
    if (!app) throw new ForbiddenException('Access denied');

    // Sanitize user-supplied filename to prevent path traversal
    const safeName = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${applicationId}/${Date.now()}-${safeName}`;

    const { data, error } = await db.storage
      .from('documents')
      .createSignedUploadUrl(storagePath);

    if (error || !data)
      throw new Error(`Failed to create upload URL: ${error?.message}`);

    // Rewritten for the browser: supabase-js builds this from SUPABASE_URL,
    // which on the VPS is the loopback Kong address. Handing it over unmodified
    // is what broke every document upload in production (MEASURED 2026-08-13).
    return {
      uploadUrl: this.supabase.toPublicStorageUrl(data.signedUrl),
      storagePath,
      token: data.token,
    };
  }

  async registerUploadedDocument(
    db: SupabaseClient,
    params: {
      applicationId: string;
      userId: string;
      storagePath: string;
      mimeType: string;
      fileName: string;
      checklistItemId?: string;
    },
  ) {
    const { data: app } = await db
      .from('applications')
      .select('id')
      .eq('id', params.applicationId)
      .eq('user_id', params.userId)
      .single();

    if (!app) throw new ForbiddenException('Access denied');

    // Prevent registering a storage path belonging to another user/application.
    // Presigned paths are always `${userId}/${applicationId}/...`.
    if (
      !params.storagePath.startsWith(
        `${params.userId}/${params.applicationId}/`,
      )
    ) {
      throw new Error('Invalid storage path');
    }

    // The SLOT the user dropped the file into is the strongest signal of what
    // the document is — stronger than the filename, which is routinely
    // `scan_0001.pdf` or `IMG_2043.jpg`. Reading it here is what lets OCR ask
    // for admission-letter / deed / birth-certificate fields instead of
    // defaulting every unlabelled upload to the generic `document` schema.
    let documentType = inferDocumentType(params.fileName);
    if (params.checklistItemId) {
      const { data: slot } = await db
        .from('checklist_items')
        .select('document_type')
        .eq('id', params.checklistItemId)
        .eq('application_id', params.applicationId)
        .maybeSingle();
      const slotType = (slot as { document_type?: string | null } | null)
        ?.document_type;
      if (slotType?.trim()) documentType = slotType.trim().toLowerCase();
    }

    // Auto-match the upload to a still-missing checklist item with the same
    // document_type so the right-panel checkmark flips without the user
    // having to pick an item manually. Exact match first, then prefix match
    // to catch discovery names like `bank_statement_3mo`. Falls back to no
    // link if nothing fits.
    let resolvedChecklistItemId = params.checklistItemId ?? null;
    if (!resolvedChecklistItemId && documentType !== 'document') {
      const { data: exact } = await db
        .from('checklist_items')
        .select('id')
        .eq('application_id', params.applicationId)
        .eq('document_type', documentType)
        .eq('status', 'missing')
        .limit(1)
        .maybeSingle();
      if (exact?.id) {
        resolvedChecklistItemId = exact.id;
      } else {
        // `passport%` also matches the `passport_photos` slot, so a passport
        // must not land in a photo slot, nor a photo in a passport one
        // (prod 2026-10-24). The applicant's photo goes into THE missing
        // applicant-photo slot (`photo` -> `passport_photos`), which no prefix
        // would find — only when there is exactly one, and never a wedding
        // photo slot, since a photo there is graded pass.
        const photo = isPhotoDocumentType(documentType);
        const applicantPhoto = isApplicantPhotoType(documentType);
        let candidates = db
          .from('checklist_items')
          .select('id, document_type')
          .eq('application_id', params.applicationId)
          .eq('status', 'missing');
        if (!applicantPhoto) {
          candidates = candidates.like('document_type', `${documentType}%`);
        }
        const { data: found } = await candidates;
        const slots = (found ?? []) as Array<{
          id: string;
          document_type: string;
        }>;
        let prefix: { id: string } | undefined;
        if (applicantPhoto) {
          const photoSlots = slots.filter((i) =>
            isApplicantPhotoType(i.document_type),
          );
          prefix = photoSlots.length === 1 ? photoSlots[0] : undefined;
        } else {
          prefix = slots.find(
            (i) => isPhotoDocumentType(i.document_type) === photo,
          );
        }
        if (prefix?.id) resolvedChecklistItemId = prefix.id;
      }
    }

    const { data: doc, error } = await db
      .from('documents')
      .insert({
        application_id: params.applicationId,
        checklist_item_id: resolvedChecklistItemId,
        storage_path: params.storagePath,
        mime_type: params.mimeType,
        file_name: params.fileName,
        document_type: documentType,
        upload_status: 'complete',
        ocr_status: 'pending',
      })
      .select('id')
      .single();

    if (error || !doc)
      throw new Error(`Failed to register document: ${error?.message}`);

    await this.logAccess({
      documentId: doc.id,
      applicationId: params.applicationId,
      userId: params.userId,
      action: 'upload',
    });

    if (resolvedChecklistItemId) {
      // Scope to application to prevent updating a checklist item from another application
      await db
        .from('checklist_items')
        .update({ status: 'uploaded' })
        .eq('id', resolvedChecklistItemId)
        .eq('application_id', params.applicationId);
    }

    await this.documentQueue.add(
      'process',
      {
        documentId: doc.id,
        applicationId: params.applicationId,
        storagePath: params.storagePath,
        mimeType: params.mimeType,
        documentType,
      } satisfies DocumentJob,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    );

    return { documentId: doc.id };
  }

  async getDocuments(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    const { data: app } = await db
      .from('applications')
      .select('id')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();

    if (!app) throw new ForbiddenException('Access denied');

    const { data: documents } = await db
      .from('documents')
      .select('*, document_verifications(*)')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false });

    const { data: crossVerifications } = await db
      .from('cross_verifications')
      .select('*')
      .eq('application_id', applicationId);

    const reviews = await this.applicantDocumentReviews(
      db,
      applicationId,
      (documents ?? []) as Array<{
        id: string;
        checklist_item_id?: string | null;
        created_at: string | null;
      }>,
    );

    // Stored rows are not revisited when the comparison rules change; apply
    // the current untyped-upload rules on the way out (identity-compare.ts).
    const now = new Date();
    const current = (
      (crossVerifications ?? []) as Array<{
        field_compared: string;
        result: string;
        details_json: unknown;
      }>
    )
      .map((row) => reviewStoredCrossCheck(row, now))
      .filter((row) => row !== null);

    return {
      documents: ((documents ?? []) as Array<{ id: string }>).map((d) => ({
        ...d,
        consultant_review: reviews.get(d.id) ?? null,
      })),
      crossVerifications: current,
    };
  }

  /**
   * The consultant's latest decision per document, read with the caller's own
   * client: application_item_reviews RLS admits the application's owner, and
   * only decision + note + date are selected (no reviewer id or role).
   * A read error leaves the documents without a review rather than failing
   * the vault — logged, because it hides a consultant's request.
   */
  private async applicantDocumentReviews(
    db: SupabaseClient,
    applicationId: string,
    docs: Array<{
      id: string;
      checklist_item_id?: string | null;
      created_at: string | null;
    }>,
  ): Promise<Map<string, ApplicantDocumentReview>> {
    const out = new Map<string, ApplicantDocumentReview>();
    if (docs.length === 0) return out;
    const { data, error } = await db
      .from('application_item_reviews')
      .select('item_kind, item_id, decision, note, created_at')
      .eq('application_id', applicationId)
      .eq('item_kind', 'document');
    if (error) {
      safeLog.warn(
        'documents.reviews',
        `consultant reviews unreadable for ${applicationId}: ${error.message}`,
      );
      return out;
    }
    const latest = latestDocumentDecisions(
      (data ?? []) as RequestDecisionRow[],
    );
    for (const doc of docs) {
      const r = latest.get(doc.id);
      if (!r) continue;
      if (
        r.decision !== 'approved' &&
        r.decision !== 'needs_reupload' &&
        r.decision !== 'rejected'
      )
        continue;
      out.set(doc.id, {
        decision: r.decision,
        note: r.decision === 'approved' ? null : r.note,
        decided_at: r.created_at,
        open:
          r.decision !== 'approved' && !isSuperseded(doc, docs, r.created_at),
      });
    }
    return out;
  }

  async deleteDocument(db: SupabaseClient, documentId: string, userId: string) {
    // RLS (scoped client) already restricts visibility to the owner; the
    // explicit user_id check below is kept as defense-in-depth.
    const { data: doc } = (await db
      .from('documents')
      .select(
        'id, application_id, storage_path, checklist_item_id, applications!inner(user_id)',
      )
      .eq('id', documentId)
      .single()) as unknown as {
      data: {
        id: string;
        application_id: string;
        storage_path: string;
        checklist_item_id: string | null;
        applications: { user_id: string };
      } | null;
    };

    if (!doc || doc.applications.user_id !== userId) {
      throw new NotFoundException('Document not found');
    }

    // Row FIRST, file second. The old order removed the file and then let the
    // row delete fail (the 2026-10-14 500, an audit FK), leaving a document
    // that still listed but whose file was gone. A leftover file after a
    // successful row delete is invisible to the user and only logged.
    //
    // FK on document_verifications has on-delete-cascade; deleting the row
    // takes the verifications with it.
    const { data: deleted, error: dbErr } = await db
      .from('documents')
      .delete()
      .eq('id', documentId)
      .select('id');
    if (dbErr)
      throw new Error(`Failed to delete document record: ${dbErr.message}`);
    // Under RLS a delete the policy refuses is not an error, it is zero rows.
    // Reporting success then would tell the user a document is gone that is
    // still on file.
    if (!deleted || deleted.length === 0) {
      throw new NotFoundException('Document not found');
    }

    const { error: storageErr } = await db.storage
      .from('documents')
      .remove([doc.storage_path]);
    if (storageErr) {
      safeLog.warn(
        'documents.delete',
        `storage remove failed: ${storageErr.message}`,
      );
    }

    // Re-open the linked checklist item so the checkmark goes back to a dot —
    // but only when this was its last document. A slot can hold several
    // uploads (front/back, multiple statements); deleting one of them must
    // not mark the slot missing while the others still fill it.
    if (doc.checklist_item_id) {
      const { data: remaining } = await db
        .from('documents')
        .select('id')
        .eq('checklist_item_id', doc.checklist_item_id)
        .eq('application_id', doc.application_id)
        .limit(1);
      if (!remaining || remaining.length === 0) {
        await db
          .from('checklist_items')
          .update({ status: 'missing' })
          .eq('id', doc.checklist_item_id)
          .eq('application_id', doc.application_id);
      }
    }

    await this.logAccess({
      documentId: doc.id,
      applicationId: doc.application_id,
      userId,
      action: 'delete',
    });

    return { deleted: true };
  }

  /**
   * Re-run OCR and extraction on a document's stored file — the same pipeline
   * an upload runs, on the file already in storage.
   *
   * Parser fixes (#111) only reached new uploads: a nikah nama uploaded before
   * the fix kept yielding the old wrong marriage date. A re-read lets the
   * corrected parser replace that document-sourced value (sync-family's rules:
   * only a value an earlier document read produced is ever replaced, never the
   * applicant's own answer).
   *
   * Allowed to the application's owner, an admin, and the consultant with an
   * ACTIVE assignment. Anyone else gets 404, as for a missing document, so the
   * route is not an existence oracle. Idempotent: one re-read per document at
   * a time (BullMQ job id), and a second request while one is queued or
   * running is answered without queueing again. Audit-logged as an `ocr`
   * access.
   */
  async reprocessDocument(documentId: string, user: AuthUser) {
    const admin = this.supabase.admin;
    const { data: doc, error } = await admin
      .from('documents')
      .select(
        'id, application_id, storage_path, mime_type, document_type, ocr_status',
      )
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read document: ${error.message}`);
    const row: {
      id: string;
      application_id: string;
      storage_path: string;
      mime_type: string;
      document_type: string | null;
      ocr_status: string;
    } | null = doc;
    if (!row || !(await this.mayActOnApplication(row.application_id, user))) {
      throw new NotFoundException('Document not found');
    }

    const jobId = `reprocess-${documentId}`;
    const existing = await this.documentQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (PENDING_JOB_STATES.has(state)) {
        return { documentId, queued: false, status: 'already_queued' as const };
      }
      // A finished job kept under the same id would make BullMQ ignore the
      // new one.
      await existing.remove().catch(() => undefined);
    }

    // Pending BEFORE queueing: the worker may finish before a later write,
    // which would then overwrite its terminal status.
    await admin
      .from('documents')
      .update({ ocr_status: 'pending' })
      .eq('id', documentId);
    try {
      await this.documentQueue.add(
        'process',
        {
          documentId,
          applicationId: row.application_id,
          storagePath: row.storage_path,
          mimeType: row.mime_type,
          documentType: row.document_type ?? 'document',
        } satisfies DocumentJob,
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      await admin
        .from('documents')
        .update({ ocr_status: row.ocr_status })
        .eq('id', documentId);
      throw err;
    }

    await this.logAccess({
      documentId,
      applicationId: row.application_id,
      userId: user.id,
      action: 'ocr',
    });
    return { documentId, queued: true, status: 'queued' as const };
  }

  /**
   * "This is my passport": the applicant confirms a passport / ID that
   * sync_profile held because its name shares nothing with the name they gave
   * (holder_mismatch.needs_confirmation). Recorded append-only in
   * document_holder_confirmations — the audit trail the consultant sees, and
   * what releases the hold for the prefill and the portal attachment like a
   * consultant approval (held-identity.ts, portal-documents.ts). The profile
   * is then re-synced from the document's stored read (no new OCR), so its
   * identity fills the profile and the stated name stays as an other name.
   *
   * The application's OWNER only, checked with the caller's own client (RLS):
   * a consultant approves instead. A document that is clearly someone else's
   * (clearly_other) is never confirmable; nor is one that is not held.
   */
  async confirmHolder(db: SupabaseClient, documentId: string, user: AuthUser) {
    const { data: doc, error } = await db
      .from('documents')
      .select('id, application_id, document_type')
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read document: ${error.message}`);
    const row: {
      id: string;
      application_id: string;
      document_type: string | null;
    } | null = doc;
    if (!row || !user?.id) throw new NotFoundException('Document not found');
    const { data: app, error: appErr } = await db
      .from('applications')
      .select('id')
      .eq('id', row.application_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (appErr || !app) throw new NotFoundException('Document not found');

    const admin = this.supabase.admin;
    const { data: vers, error: vErr } = await admin
      .from('document_verifications')
      .select('id, details_json')
      .eq('document_id', documentId)
      .eq('verification_type', 'identity')
      .order('verified_at', { ascending: false })
      .limit(1);
    if (vErr) throw new Error(`Failed to read verification: ${vErr.message}`);
    const details = (
      (Array.isArray(vers) ? vers[0] : null) as {
        details_json?: Record<string, unknown> | null;
      } | null
    )?.details_json;
    const mismatch = details?.holder_mismatch as
      | {
          holder?: unknown;
          applicant?: unknown;
          needs_confirmation?: unknown;
          clearly_other?: unknown;
        }
      | undefined;
    if (mismatch?.clearly_other === true) {
      throw new ConflictException(
        'This document names someone else and cannot be confirmed as yours. Upload your own.',
      );
    }
    if (mismatch?.needs_confirmation !== true) {
      throw new ConflictException(
        'This document is not waiting for your confirmation.',
      );
    }

    const text = (v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null;
    const { error: insErr } = await admin
      .from(HOLDER_CONFIRMATIONS_TABLE)
      .insert({
        document_id: documentId,
        application_id: row.application_id,
        confirmed_by: user.id,
        holder_name: text(mismatch.holder),
        stated_name: text(mismatch.applicant),
      });
    if (insErr) {
      // e.g. the table is not migrated yet: a clean, retryable 503 — the
      // database's message stays in the log, not the response.
      safeLog.warn(
        'documents.confirm_holder',
        `could not record confirmation for ${documentId}: ${insErr.message}`,
      );
      throw new ServiceUnavailableException(
        "We couldn't record your confirmation right now. Please try again in a few minutes.",
      );
    }

    // Re-sync now from the stored read. sync_profile never throws.
    const extracted = details?.extracted_fields;
    const classified = details?.classified_from_content;
    await makeSyncProfileNode(admin)({
      documentId,
      applicationId: row.application_id,
      documentType:
        typeof classified === 'string' && classified
          ? classified
          : (row.document_type ?? 'passport'),
      rawOcrText: '',
      extractedFields:
        extracted && typeof extracted === 'object' && !Array.isArray(extracted)
          ? extracted
          : {},
      error: null,
    } as unknown as DocumentState);

    return { documentId, confirmed: true };
  }

  /** Owner, admin, or the consultant with an ACTIVE assignment (fails closed). */
  private async mayActOnApplication(
    applicationId: string,
    user: AuthUser,
  ): Promise<boolean> {
    if (!user?.id) return false;
    if (user.appRole === 'admin') return true;
    const admin = this.supabase.admin;
    const { data: app, error } = await admin
      .from('applications')
      .select('user_id')
      .eq('id', applicationId)
      .maybeSingle();
    if (error || !app) return false;
    if ((app as { user_id?: string }).user_id === user.id) return true;
    const { data: assignment, error: aErr } = await admin
      .from('consultant_assignments')
      .select('id')
      .eq('application_id', applicationId)
      .eq('consultant_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    return !aErr && !!assignment;
  }

  async getAccessLog(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    const { data: app } = await db
      .from('applications')
      .select('id')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();

    if (!app) throw new ForbiddenException('Access denied');

    const { data: logs } = await db
      .from('document_access_logs')
      .select('id, document_id, action, occurred_at, documents(file_name)')
      .eq('application_id', applicationId)
      .order('occurred_at', { ascending: false })
      .limit(20);

    return { logs: logs ?? [] };
  }

  private async logAccess(params: {
    documentId: string;
    applicationId: string;
    userId: string;
    action: 'upload' | 'view' | 'download' | 'delete' | 'ocr';
  }) {
    // Audit writes use the service-role client: document_access_logs has only a
    // SELECT policy (no INSERT), and this is a system-owned audit trail.
    const { error } = await this.supabase.admin
      .from('document_access_logs')
      .insert({
        document_id: params.documentId,
        application_id: params.applicationId,
        user_id: params.userId,
        action: params.action,
      });
    if (error) {
      safeLog.warn(
        'documents.audit',
        `access log insert failed: ${error.message}`,
      );
    }
  }
}

/** A filename that says photo and nothing else: `photo 2.jpg`, `my pictures.png`. */
const BARE_PHOTO_NAME =
  /^(?=.*\b(?:photo|photos|photograph|photographs|picture|pictures)\b)(?:(?:my|applicant|digital|recent|colou?r|size|photo|photos|photograph|photographs|picture|pictures|img|jpg|jpeg|png|heic|webp|\d+)(?: |$))+$/;

/**
 * Filename fallback, used only when the upload is not tied to a checklist slot
 * (the "Other documents" catch-all). Ordered most-specific first: the old list
 * matched a bare `letter` before anything else, so `admission_letter.pdf` was
 * filed as an employment letter and OCR asked it for a salary.
 *
 * A wrong type is worse than a generic one — it would prompt the extractor for
 * fields the document cannot have — so anything unrecognised stays `document`,
 * which resolves to the common identity schema only.
 */
export function inferDocumentType(fileName: string): string {
  // Normalise every separator to a single space so `\b` anchors behave the same
  // for `ITR_2024.pdf`, `itr-2024.pdf` and `ITR 2024.pdf` — an underscore is a
  // word character, so `\bitr\b` does NOT match `itr_2024`.
  const name = fileName.toLowerCase().replace(/[^a-z0-9]+/g, ' ');

  // `passport photo.jpg` is the photograph, not the passport (prod
  // 2026-10-24). Only an unambiguous photo name, though: "photo of passport",
  // "passport photo page", "passport photo copy", "cnic photo" and "bank
  // statement photo" are each
  // the document, and fall through to the rules below.
  if (
    /\bpassport (?:size )?(?:photo|photos|photograph|photographs)\b(?! (?:page|copy|scan)\b)/.test(
      name,
    ) ||
    BARE_PHOTO_NAME.test(name.trim())
  ) {
    return 'photo';
  }

  const rules: Array<[RegExp, string]> = [
    [/passport|travel doc/, 'passport'],
    [
      /admission|acceptance|offer letter|\bi ?20\b|\bcas\b|\bloa\b/,
      'admission_letter',
    ],
    [/\bbirth\b/, 'birth_certificate'],
    [/marriage|nikah|wedding cert/, 'marriage_certificate'],
    [
      // `lease deed.pdf` is a tenancy (below), not a title deed.
      /propert|(?<!(?:lease|rent|tenancy) )deed|title doc|land (record|title)|mutation/,
      'property_document',
    ],
    [/bank|statement|passbook/, 'bank_statement'],
    [/pay ?(slip|stub)|salary slip/, 'pay_stubs'],
    [/\bnoa\b|notice of assessment|assessment/, 'noa'],
    [/tax (return|record)|\bitr\b|\bt4\b|\bw ?2\b/, 'tax_return'],
    [/employment|employer|job letter|experience letter/, 'employment_letter'],
    [/invitation|invite/, 'invitation_letter'],
    [/itinerary|flight|ticket|boarding/, 'travel_itinerary'],
    [/hotel|accommodation|booking|reservation/, 'hotel_booking'],
    [/police|clearance|\bpcc\b|good conduct/, 'police_clearance'],
    // Insurance before medical: `Medical Insurance.pdf` is a policy, not an
    // exam report (prod 2026-10-14).
    [/insurance|policy/, 'medical_insurance'],
    [/medical|imm exam|panel physician/, 'medical_exam'],
    [/proof of funds|funds|fixed deposit/, 'proof_of_funds'],
    // After bank and funds: `bank statement rent.pdf` is the statement, and
    // `rental income proof.pdf` / `rent receipts.pdf` are not the lease.
    [
      /\brent (?:agreement|deed|contract)\b|\blease\b|\btenancy\b|\bkiraya ?nama\b/,
      'lease_agreement',
    ],
    // Deliberately last: `letter` alone says only that it is a letter.
    [/letter/, 'employment_letter'],
  ];

  for (const [pattern, type] of rules) {
    if (pattern.test(name)) return type;
  }
  return 'document';
}
