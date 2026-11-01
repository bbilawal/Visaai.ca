import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { buildNarrativeGraph } from './graphs/narrative.graph';
import type { DocType } from './graphs/narrative.state';
import type { Env } from '../../config/configuration';

const VALID_DOC_TYPES: DocType[] = ['loe', 'itinerary', 'cover_letter'];

@Injectable()
export class NarrativeService {
  private readonly openaiKey: string;

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService<Env>,
    private meter: AiUsageMeter,
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

  /** Best-effort read of the user's preferred UI language (drives AI response
   *  language). Falls back to null (English) on any error or unset preference. */
  private async getUserLanguage(
    db: SupabaseClient,
    userId: string,
  ): Promise<string | null> {
    try {
      const { data } = await db
        .from('users')
        .select('preferred_language')
        .eq('id', userId)
        .single();
      return (
        (data as { preferred_language?: string | null } | null)
          ?.preferred_language ?? null
      );
    } catch {
      return null;
    }
  }

  async generate(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    docType: DocType,
  ) {
    if (!VALID_DOC_TYPES.includes(docType)) {
      throw new BadRequestException(
        `Invalid docType. Must be one of: ${VALID_DOC_TYPES.join(', ')}`,
      );
    }
    await this.verifyOwnership(db, applicationId, userId);
    const language = await this.getUserLanguage(db, userId);

    // F1: graph built per-request with the scoped client (RLS-enforced nodes).
    const graph = buildNarrativeGraph(
      db,
      this.openaiKey,
      language,
      this.meter,
      {
        applicationId,
        userId,
      },
      this.keepPreviousLetter(applicationId, userId),
    );
    const result = await graph.invoke({ applicationId, docType });

    return {
      generatedDocumentId: result.generatedDocumentId,
      content: result.draft,
      revisionCount: result.revisionCount,
    };
  }

  /**
   * Revision writer for a regeneration: the text being replaced is kept
   * before the new draft overwrites it. Throws (so the graph stops before the
   * overwrite) when the revision cannot be written.
   */
  keepPreviousLetter(applicationId: string, userId: string) {
    return async (previous: { id: string; content_md: string }) => {
      const { error } = await this.supabase.admin
        .from('generated_document_revisions')
        .insert({
          generated_document_id: previous.id,
          application_id: applicationId,
          content_md: previous.content_md,
          edited_by: userId,
          edited_role: 'applicant',
          note: 'Replaced by a regenerated draft',
        });
      if (error)
        throw new Error(
          `Could not keep the previous letter, so it was not replaced: ${error.message}`,
        );
    };
  }

  private async loadOwnedLetter(
    db: SupabaseClient,
    documentId: string,
    userId: string,
  ) {
    const { data: doc } = await db
      .from('generated_documents')
      .select('id, application_id, content_md')
      .eq('id', documentId)
      .single();

    if (!doc) throw new NotFoundException('Document not found');
    await this.verifyOwnership(db, doc.application_id, userId);
    return doc as {
      id: string;
      application_id: string;
      content_md?: string | null;
    };
  }

  /**
   * The letter is edited in place. Keep the text it replaces (possibly a
   * consultant's rewrite) before overwriting — no overwrite without history.
   * Service-role write: the revisions table has no insert policy.
   */
  private async keepRevision(
    doc: { id: string; application_id: string; content_md?: string | null },
    userId: string,
    editedContent: string | undefined,
  ) {
    const previous = doc.content_md;
    if (
      editedContent === undefined ||
      previous == null ||
      editedContent === previous
    )
      return;
    const { error: revErr } = await this.supabase.admin
      .from('generated_document_revisions')
      .insert({
        generated_document_id: doc.id,
        application_id: doc.application_id,
        content_md: previous,
        edited_by: userId,
        edited_role: 'applicant',
        note: null,
      });
    if (revErr)
      throw new Error(
        `Could not keep the previous revision, so the letter was not changed: ${revErr.message}`,
      );
  }

  /** The applicant's explicit approval (optionally of an edited text). */
  async approve(
    db: SupabaseClient,
    documentId: string,
    userId: string,
    editedContent?: string,
  ) {
    const doc = await this.loadOwnedLetter(db, documentId, userId);
    await this.keepRevision(doc, userId, editedContent);

    const update: { approved_by_user: boolean; content_md?: string } = {
      approved_by_user: true,
    };
    if (editedContent !== undefined) update.content_md = editedContent;

    const { error } = await db
      .from('generated_documents')
      .update(update)
      .eq('id', documentId);
    if (error) throw new Error(`Failed to approve document: ${error.message}`);

    return { approved: true };
  }

  /**
   * Save an edit WITHOUT approving. Changed text is a new draft the applicant
   * has not yet approved, so an approved letter goes back to pending review.
   */
  async saveDraft(
    db: SupabaseClient,
    documentId: string,
    userId: string,
    content: string,
  ) {
    if (!content.trim())
      throw new BadRequestException('The letter cannot be empty');
    const doc = await this.loadOwnedLetter(db, documentId, userId);
    await this.keepRevision(doc, userId, content);

    const { error } = await db
      .from('generated_documents')
      .update({ content_md: content, approved_by_user: false })
      .eq('id', documentId);
    if (error) throw new Error(`Failed to save document: ${error.message}`);

    return { saved: true, approved: false };
  }

  async list(db: SupabaseClient, applicationId: string, userId: string) {
    await this.verifyOwnership(db, applicationId, userId);

    const { data } = await db
      .from('generated_documents')
      .select('*')
      .eq('application_id', applicationId)
      .order('generated_at', { ascending: false });

    return data ?? [];
  }
}
