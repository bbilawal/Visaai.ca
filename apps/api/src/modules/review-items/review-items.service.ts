import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ConsultantReviewItems,
  PrefilledFormField,
  ReviewDocumentApplicantConfirmation,
  ReviewGeneratedItem,
  ReviewItemDecision,
  ReviewItemDecisionRecord,
  ReviewItemKind,
} from '@visaai/types';
import { AuditService } from '../audit/audit.service';
import { ConsultantApprovalService } from '../consultant/consultant-approval.service';
import { MessagingService } from '../messaging/messaging.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  REVIEW_ITEMS_REPOSITORY,
  type DecisionRow,
  type IReviewItemsRepository,
} from './review-items.repository';
import { openDocumentRequests } from './open-document-requests';

export interface ReviewCaller {
  id: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

export interface DecideInput {
  itemKind: ReviewItemKind;
  itemId: string;
  decision: ReviewItemDecision;
  note?: string;
}

const LETTER_TYPES = [
  'loe',
  'itinerary',
  'cover_letter',
  'invitation_letter',
] as const;
type LetterType = (typeof LETTER_TYPES)[number];
const FORM_TYPE = 'prefilled_form_json';

const ALLOWED: Record<ReviewItemKind, ReviewItemDecision[]> = {
  document: ['approved', 'needs_reupload', 'rejected'],
  generated: ['approved', 'changes_requested'],
};

const SIGNED_URL_TTL_SECONDS = 300;

const LETTER_LABEL: Record<string, string> = {
  loe: 'Letter of explanation',
  itinerary: 'Travel itinerary',
  cover_letter: 'Cover letter',
  invitation_letter: 'Letter of invitation',
  [FORM_TYPE]: 'Application form',
};

const DECISION_LABEL: Record<ReviewItemDecision, string> = {
  approved: 'approved',
  needs_reupload: 'needs to be re-uploaded',
  changes_requested: 'needs changes',
  rejected: 'was rejected',
};

/**
 * ReviewItemsService — the consultant's review of everything the applicant
 * uploaded (documents) or the app generated (letters + the application form).
 *
 * Authorization: the ACTIVE assignee (primary or backup) or an admin, checked
 * here on every call — the route guards only establish "consultant role".
 * Items are always resolved by (application id, item id), so an id from
 * another application cannot be reached through an authorized application.
 *
 * - Documents open through a 5-minute signed URL; every open is written to
 *   document_access_logs (the applicant's Privacy & Security trail).
 * - Decisions are append-only rows (application_item_reviews); anything but an
 *   approval needs a note and is posted into the application's conversation so
 *   the applicant sees it.
 * - Letters are edited in place, but the prior text is kept first
 *   (generated_document_revisions) and the applicant's approval is reset.
 *   The application form is NOT edited here as a blob: its fields go through
 *   the preflight field-edit path, which keeps the auto-fill lock honest.
 */
@Injectable()
export class ReviewItemsService implements OnModuleInit {
  private readonly log = new Logger(ReviewItemsService.name);

  constructor(
    @Inject(REVIEW_ITEMS_REPOSITORY)
    private readonly repo: IReviewItemsRepository,
    private readonly consultant: ConsultantApprovalService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly supabase: SupabaseService,
  ) {}

  onModuleInit(): void {
    this.consultant.registerApplicationApprovalBlocker((id) =>
      this.approvalBlocker(id),
    );
  }

  /**
   * The application cannot be approved while any of its documents carries an
   * open consultant request (latest decision needs_reupload / rejected, not
   * replaced by a newer upload in its slot — see open-document-requests.ts).
   * Read errors propagate: approval fails closed.
   */
  async approvalBlocker(applicationId: string): Promise<string | null> {
    const [docs, decisions] = await Promise.all([
      this.repo.listDocuments(applicationId),
      this.repo.listDecisions(applicationId),
    ]);
    const open = [...openDocumentRequests(docs, decisions).values()];
    if (open.length === 0) return null;
    const names = open
      .map(
        ({ doc, decision }) =>
          `${doc ? (doc.file_name ?? doc.document_type ?? 'Document') : 'a document the applicant deleted'} (${
            decision.decision === 'rejected' ? 'rejected' : 're-upload requested'
          })`,
      )
      .join(', ');
    return (
      `Cannot approve yet: ${open.length === 1 ? 'a document has' : `${open.length} documents have`} ` +
      `an open review request: ${names}. Wait for the applicant to upload a replacement, ` +
      `or approve ${open.length === 1 ? 'it' : 'them'} under Uploaded documents to close the request` +
      `${open.some((o) => !o.doc) ? ' (a deleted document is listed there as "Deleted by the applicant")' : ''}.`
    );
  }

  private async authorize(
    applicationId: string,
    caller: ReviewCaller,
  ): Promise<'consultant' | 'admin'> {
    if (caller.appRole === 'admin') return 'admin';
    await this.consultant.assertAssigned(applicationId, caller.id);
    return 'consultant';
  }

  async list(
    applicationId: string,
    caller: ReviewCaller,
  ): Promise<ConsultantReviewItems> {
    await this.authorize(applicationId, caller);
    const [docs, generated, fields, decisions, confirmations] =
      await Promise.all([
        this.repo.listDocuments(applicationId),
        this.repo.listGenerated(applicationId),
        this.repo.listExtractedFields(applicationId),
        this.repo.listDecisions(applicationId),
        this.repo.listHolderConfirmations(applicationId),
      ]);
    // The applicant's latest "this passport is mine" per document, from the
    // service-role table — never from details_json, which the owner can edit.
    const confirmationOf = new Map<
      string,
      ReviewDocumentApplicantConfirmation
    >();
    for (const c of [...confirmations]
      .filter((x) => x.application_id === applicationId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))))
      confirmationOf.set(c.document_id, {
        confirmedBy: c.confirmed_by,
        confirmedAt: c.created_at,
        holderName: c.holder_name,
        statedName: c.stated_name,
      });
    const verifications = await this.repo.listVerifications(
      docs.map((d) => d.id),
    );
    const latest = latestDecisions(decisions);

    const formRow = generated.find((g) => g.doc_type === FORM_TYPE);
    let formFields: PrefilledFormField[] = [];
    if (formRow) {
      try {
        const parsed = JSON.parse(formRow.content_md) as {
          fields?: PrefilledFormField[];
        };
        formFields = Array.isArray(parsed.fields) ? parsed.fields : [];
      } catch {
        this.log.warn(`form JSON for ${applicationId} is unreadable`);
      }
    }

    return {
      applicationId,
      documents: docs.map((d) => ({
        id: d.id,
        type: d.document_type,
        name: d.file_name,
        uploadStatus: d.upload_status,
        ocrStatus: d.ocr_status,
        createdAt: d.created_at,
        verifications: verifications
          .filter((v) => v.document_id === d.id)
          .map((v) => ({
            verificationType: v.verification_type,
            result: v.result,
            details: v.details_json,
            verifiedAt: v.verified_at,
          })),
        extractedFields: fields
          .filter((f) => f.source_document_id === d.id)
          .map((f) => ({
            fieldKey: f.field_key,
            value: f.value_snapshot,
            origin: f.origin,
            confidence: f.confidence,
          })),
        decision: latest.get(`document:${d.id}`) ?? null,
        applicantConfirmation: confirmationOf.get(d.id) ?? null,
      })).concat(
        // A requested file the applicant deleted: listed so the consultant can
        // close the request (approve). Nothing to open.
        [...openDocumentRequests(docs, decisions).entries()]
          .filter(([, o]) => !o.doc)
          .map(([id]) => ({
            id,
            type: null,
            name: null,
            uploadStatus: 'deleted',
            ocrStatus: null,
            createdAt: null,
            verifications: [],
            extractedFields: [],
            decision: latest.get(`document:${id}`) ?? null,
            applicantConfirmation: null,
            deleted: true,
          })),
      ),
      generated: generated
        .filter((g): g is typeof g & { doc_type: LetterType } =>
          (LETTER_TYPES as readonly string[]).includes(g.doc_type),
        )
        .map((g) => this.toGenerated(g, latest.get(`generated:${g.id}`))),
      form: formRow
        ? {
            id: formRow.id,
            fields: formFields,
            approvedByUser: formRow.approved_by_user,
            decision: latest.get(`generated:${formRow.id}`) ?? null,
          }
        : null,
    };
  }

  async openDocument(
    applicationId: string,
    documentId: string,
    caller: ReviewCaller,
  ): Promise<{ url: string; expiresIn: number }> {
    await this.authorize(applicationId, caller);
    const doc = await this.repo.getDocument(applicationId, documentId);
    if (!doc) throw new NotFoundException('document not found');
    const signed = await this.repo.signedDocumentUrl(
      doc.storage_path,
      SIGNED_URL_TTL_SECONDS,
    );
    if (!signed)
      throw new NotFoundException('the file for this document is missing');
    await this.repo.logDocumentAccess({
      document_id: doc.id,
      application_id: applicationId,
      user_id: caller.id,
      action: 'view',
    });
    return {
      // The raw URL points at the server's loopback Kong; rewrite for the browser.
      url: this.supabase.toPublicStorageUrl(signed),
      expiresIn: SIGNED_URL_TTL_SECONDS,
    };
  }

  async decide(
    applicationId: string,
    caller: ReviewCaller,
    input: DecideInput,
    token: string,
  ): Promise<{ decision: ReviewItemDecisionRecord; notified: boolean }> {
    const role = await this.authorize(applicationId, caller);
    if (!ALLOWED[input.itemKind]?.includes(input.decision)) {
      throw new BadRequestException(
        `decision '${input.decision}' is not valid for a ${input.itemKind}`,
      );
    }
    const note = input.note?.trim() || null;
    if (input.decision !== 'approved' && !note) {
      throw new BadRequestException(
        'add a note so the applicant knows what to fix',
      );
    }

    const label = await this.itemLabel(applicationId, input);

    const row: DecisionRow = {
      item_kind: input.itemKind,
      item_id: input.itemId,
      decision: input.decision,
      note,
      reviewer_id: caller.id,
      reviewer_role: role,
      created_at: new Date().toISOString(),
    };
    await this.repo.insertDecision({ ...row, application_id: applicationId });

    await this.audit.append({
      applicationId,
      eventType: 'CONSULTANT_REVIEWED',
      actor: { id: caller.id, role },
      refs: {
        documentId: input.itemKind === 'document' ? input.itemId : null,
      },
      payload: {
        action: 'item_review',
        item_kind: input.itemKind,
        item_id: input.itemId,
        decision: input.decision,
        has_note: Boolean(note),
      },
    });

    let notified = false;
    if (input.decision !== 'approved') {
      try {
        await this.messaging.postMessage(token, caller, applicationId, {
          body: `Review: ${label} ${DECISION_LABEL[input.decision]}.\n\n${note}`,
          category: 'documents',
        });
        notified = true;
      } catch (err) {
        // The decision stands; the applicant still sees it on the review rows.
        this.log.warn(
          `review message for ${applicationId} failed: ${(err as Error).message}`,
        );
      }
    }

    return { decision: toRecord(row), notified };
  }

  async editGenerated(
    applicationId: string,
    caller: ReviewCaller,
    generatedId: string,
    contentMd: string,
    note?: string,
  ): Promise<ReviewGeneratedItem> {
    const role = await this.authorize(applicationId, caller);
    const doc = await this.repo.getGenerated(applicationId, generatedId);
    if (!doc) throw new NotFoundException('generated document not found');
    if (doc.doc_type === FORM_TYPE) {
      throw new BadRequestException(
        'The application form is edited field by field, not as a whole document.',
      );
    }
    if (!(LETTER_TYPES as readonly string[]).includes(doc.doc_type)) {
      throw new BadRequestException(`cannot edit a ${doc.doc_type}`);
    }
    const next = String(contentMd ?? '');
    if (!next.trim())
      throw new BadRequestException('the letter cannot be empty');
    if (next === doc.content_md) {
      return this.toGenerated(doc, undefined);
    }

    // History first: no edit without the text it replaces.
    await this.repo.insertRevision({
      generated_document_id: doc.id,
      application_id: applicationId,
      content_md: doc.content_md,
      edited_by: caller.id,
      edited_role: role,
      note: note?.trim() || null,
    });
    await this.repo.updateGeneratedContent(applicationId, doc.id, next);

    await this.audit.append({
      applicationId,
      eventType: 'CONSULTANT_REVIEWED',
      actor: { id: caller.id, role },
      refs: {},
      payload: {
        action: 'generated_edited',
        generated_document_id: doc.id,
        doc_type: doc.doc_type,
        previous_content_hash: sha(doc.content_md),
        content_hash: sha(next),
      },
    });

    const decisions = await this.repo.listDecisions(applicationId);
    return this.toGenerated(
      { ...doc, content_md: next, approved_by_user: false },
      latestDecisions(decisions).get(`generated:${doc.id}`),
    );
  }

  private async itemLabel(
    applicationId: string,
    input: DecideInput,
  ): Promise<string> {
    if (input.itemKind === 'document') {
      const d = await this.repo.getDocument(applicationId, input.itemId);
      if (d) return d.file_name ?? d.document_type ?? 'Document';
      // Deleted by the applicant after a decision: the consultant may still
      // close the request (approve) — otherwise approval would stay blocked
      // until some unrelated upload. Nothing else applies to a missing file.
      const decided = (await this.repo.listDecisions(applicationId)).some(
        (r) => r.item_kind === 'document' && r.item_id === input.itemId,
      );
      if (!decided) throw new NotFoundException('document not found');
      if (input.decision !== 'approved') {
        throw new BadRequestException(
          'This document was deleted by the applicant; approve it to close the request, or wait for a replacement upload.',
        );
      }
      return 'Deleted document';
    }
    const g = await this.repo.getGenerated(applicationId, input.itemId);
    if (!g) throw new NotFoundException('generated document not found');
    return LETTER_LABEL[g.doc_type] ?? g.doc_type;
  }

  private toGenerated(
    g: {
      id: string;
      doc_type: string;
      content_md: string;
      approved_by_user: boolean;
      generated_at: string | null;
    },
    decision: ReviewItemDecisionRecord | undefined,
  ): ReviewGeneratedItem {
    return {
      id: g.id,
      docType: g.doc_type as LetterType,
      contentMd: g.content_md,
      approvedByUser: g.approved_by_user,
      generatedAt: g.generated_at,
      // A regeneration replaces the letter in place (same id) and stamps
      // generated_at; a decision made before that judged different text.
      decision:
        decision && !decidedBefore(decision.createdAt, g.generated_at)
          ? decision
          : null,
    };
  }
}

function toRecord(d: DecisionRow): ReviewItemDecisionRecord {
  return {
    decision: d.decision,
    note: d.note,
    reviewerId: d.reviewer_id,
    reviewerRole: d.reviewer_role,
    createdAt: d.created_at,
  };
}

function latestDecisions(
  rows: DecisionRow[],
): Map<string, ReviewItemDecisionRecord> {
  const latest = new Map<string, DecisionRow>();
  for (const r of rows) {
    const k = `${r.item_kind}:${r.item_id}`;
    const prev = latest.get(k);
    if (!prev || r.created_at > prev.created_at) latest.set(k, r);
  }
  return new Map([...latest].map(([k, v]) => [k, toRecord(v)]));
}

function sha(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function decidedBefore(decidedAt: string, generatedAt: string | null): boolean {
  if (!generatedAt) return false;
  const d = Date.parse(decidedAt);
  const g = Date.parse(generatedAt);
  return Number.isFinite(d) && Number.isFinite(g) && d < g;
}
