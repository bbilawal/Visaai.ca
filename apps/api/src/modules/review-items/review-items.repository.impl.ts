import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  DecisionRow,
  DocumentRow,
  ExtractedFieldRow,
  GeneratedRow,
  HolderConfirmationRow,
  IReviewItemsRepository,
  VerificationRow,
} from './review-items.repository';

/**
 * Service-role implementation. Read errors THROW — a swallowed error here would
 * render as "no documents" / "no decision", which a consultant would read as a
 * clean application.
 */
@Injectable()
export class ReviewItemsRepository implements IReviewItemsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.admin;
  }

  async listDocuments(applicationId: string): Promise<DocumentRow[]> {
    const { data, error } = await this.db
      .from('documents')
      .select(
        'id, application_id, document_type, file_name, storage_path, upload_status, ocr_status, created_at, checklist_item_id',
      )
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`listDocuments failed: ${error.message}`);
    return data ?? [];
  }

  async getDocument(
    applicationId: string,
    documentId: string,
  ): Promise<DocumentRow | null> {
    const { data, error } = await this.db
      .from('documents')
      .select(
        'id, application_id, document_type, file_name, storage_path, upload_status, ocr_status, created_at, checklist_item_id',
      )
      .eq('application_id', applicationId)
      .eq('id', documentId)
      .maybeSingle();
    if (error) throw new Error(`getDocument failed: ${error.message}`);
    return data ?? null;
  }

  async listVerifications(documentIds: string[]): Promise<VerificationRow[]> {
    if (documentIds.length === 0) return [];
    const { data, error } = await this.db
      .from('document_verifications')
      .select(
        'document_id, verification_type, result, details_json, verified_at',
      )
      .in('document_id', documentIds);
    if (error) throw new Error(`listVerifications failed: ${error.message}`);
    return data ?? [];
  }

  async listExtractedFields(
    applicationId: string,
  ): Promise<ExtractedFieldRow[]> {
    const { data, error } = await this.db
      .from('field_provenance')
      .select(
        'source_document_id, field_key, value_snapshot, origin, confidence',
      )
      .eq('application_id', applicationId)
      .is('superseded_by', null)
      .order('field_key', { ascending: true });
    if (error) throw new Error(`listExtractedFields failed: ${error.message}`);
    return data ?? [];
  }

  async listGenerated(applicationId: string): Promise<GeneratedRow[]> {
    const { data, error } = await this.db
      .from('generated_documents')
      .select(
        'id, application_id, doc_type, content_md, approved_by_user, generated_at',
      )
      .eq('application_id', applicationId);
    if (error) throw new Error(`listGenerated failed: ${error.message}`);
    return data ?? [];
  }

  async getGenerated(
    applicationId: string,
    id: string,
  ): Promise<GeneratedRow | null> {
    const { data, error } = await this.db
      .from('generated_documents')
      .select(
        'id, application_id, doc_type, content_md, approved_by_user, generated_at',
      )
      .eq('application_id', applicationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getGenerated failed: ${error.message}`);
    return data ?? null;
  }

  async listDecisions(applicationId: string): Promise<DecisionRow[]> {
    const { data, error } = await this.db
      .from('application_item_reviews')
      .select(
        'item_kind, item_id, decision, note, reviewer_id, reviewer_role, created_at',
      )
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`listDecisions failed: ${error.message}`);
    return data ?? [];
  }

  /**
   * The applicant's own confirmations. A missing table (migration
   * 20261030120000 not applied yet) reads as none — no confirmation can exist
   * then. Any other error throws, like every read here.
   */
  async listHolderConfirmations(
    applicationId: string,
  ): Promise<HolderConfirmationRow[]> {
    const { data, error } = await this.db
      .from('document_holder_confirmations')
      .select(
        'application_id, document_id, confirmed_by, holder_name, stated_name, created_at',
      )
      .eq('application_id', applicationId)
      .order('created_at', { ascending: true });
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') return [];
      throw new Error(`listHolderConfirmations failed: ${error.message}`);
    }
    return data ?? [];
  }

  async insertDecision(
    row: DecisionRow & { application_id: string },
  ): Promise<void> {
    const { error } = await this.db
      .from('application_item_reviews')
      .insert(row);
    if (error) throw new Error(`insertDecision failed: ${error.message}`);
  }

  async insertRevision(row: {
    generated_document_id: string;
    application_id: string;
    content_md: string;
    edited_by: string;
    edited_role: 'consultant' | 'admin';
    note: string | null;
  }): Promise<void> {
    const { error } = await this.db
      .from('generated_document_revisions')
      .insert(row);
    if (error) throw new Error(`insertRevision failed: ${error.message}`);
  }

  async updateGeneratedContent(
    applicationId: string,
    id: string,
    contentMd: string,
  ): Promise<void> {
    // The applicant approved the previous text, not this one.
    const { error } = await this.db
      .from('generated_documents')
      .update({ content_md: contentMd, approved_by_user: false })
      .eq('application_id', applicationId)
      .eq('id', id);
    if (error)
      throw new Error(`updateGeneratedContent failed: ${error.message}`);
  }

  async signedDocumentUrl(
    storagePath: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    const { data, error } = await this.db.storage
      .from('documents')
      .createSignedUrl(storagePath, ttlSeconds);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  async logDocumentAccess(row: {
    document_id: string;
    application_id: string;
    user_id: string;
    action: 'view';
  }): Promise<void> {
    // Fail closed: an unlogged view of a passport is exactly what the access
    // log exists to prevent, so the URL is not handed out without the row.
    const { error } = await this.db.from('document_access_logs').insert(row);
    if (error) throw new Error(`access log insert failed: ${error.message}`);
  }
}
