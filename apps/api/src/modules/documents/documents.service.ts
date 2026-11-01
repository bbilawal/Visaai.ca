import {
  ForbiddenException,
  Injectable,
  NotFoundException,
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
        const { data: prefix } = await db
          .from('checklist_items')
          .select('id')
          .eq('application_id', params.applicationId)
          .eq('status', 'missing')
          .like('document_type', `${documentType}%`)
          .limit(1)
          .maybeSingle();
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
      documents: documents ?? [],
      crossVerifications: current,
    };
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

  const rules: Array<[RegExp, string]> = [
    [/passport|travel doc/, 'passport'],
    [
      /admission|acceptance|offer letter|\bi ?20\b|\bcas\b|\bloa\b/,
      'admission_letter',
    ],
    [/\bbirth\b/, 'birth_certificate'],
    [/marriage|nikah|wedding cert/, 'marriage_certificate'],
    [
      /propert|deed|title doc|land (record|title)|mutation/,
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
    // Deliberately last: `letter` alone says only that it is a letter.
    [/letter/, 'employment_letter'],
  ];

  for (const [pattern, type] of rules) {
    if (pattern.test(name)) return type;
  }
  return 'document';
}
