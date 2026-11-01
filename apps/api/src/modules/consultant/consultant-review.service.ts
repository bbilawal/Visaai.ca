import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConsultantReviewData,
  ConsultantReviewDocument,
  ConsultantReviewField,
} from '@visaai/types';
import { ConsultantWriteClient } from './consultant-write-client';
import { ConsultantApprovalService } from './consultant-approval.service';
import { ASSIGNMENT_REPOSITORY } from './assignment.repository';
import type { IAssignmentRepository } from './assignment.repository';

interface ReviewCaller {
  id: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

/**
 * ConsultantReviewService — assembles the read-only review payload a consultant
 * needs to decide: application summary, current field values joined to their
 * approval state, and the uploaded documents. Read-only; authorizes the active
 * assignee (admin override). All reads go through the service-role client.
 */
@Injectable()
export class ConsultantReviewService {
  constructor(
    private readonly writes: ConsultantWriteClient,
    private readonly approval: ConsultantApprovalService,
    @Inject(ASSIGNMENT_REPOSITORY) private readonly repo: IAssignmentRepository,
  ) {}

  async getReview(
    applicationId: string,
    caller: ReviewCaller,
  ): Promise<ConsultantReviewData> {
    const app = await this.repo.getApplicationMeta(applicationId);
    if (!app) throw new NotFoundException('application not found');

    // admin → any; consultant → any ACTIVE assignee (primary OR backup; backups
    // have full access by design, P3c).
    if (caller.appRole !== 'admin') {
      const active = await this.repo.getActiveAssignmentFor(
        applicationId,
        caller.id,
      );
      if (!active) {
        throw new ForbiddenException('not the active assignee');
      }
    }

    const [statusRow, emailMap, provFields, rollup, docs] = await Promise.all([
      this.appStatus(applicationId),
      this.repo.getUserEmails([app.user_id]),
      this.currentFields(applicationId),
      this.approval.getApplicationApproval(applicationId),
      this.documents(applicationId),
    ]);

    const approvalByKey = new Map(rollup.fields.map((f) => [f.fieldKey, f]));

    const fields: ConsultantReviewField[] = provFields.map((p) => {
      const a = approvalByKey.get(p.field_key);
      return {
        fieldKey: p.field_key,
        value: p.value_snapshot,
        valueHash: p.value_hash,
        origin: p.origin,
        confidence: p.confidence,
        decision: a?.decision ?? 'pending',
        approved: a?.approved ?? false,
        stale: a?.stale ?? false,
      };
    });

    return {
      applicationId,
      summary: {
        destination_country: app.destination_country,
        status: statusRow,
        applicant_email: emailMap.get(app.user_id) ?? null,
      },
      fields,
      documents: docs,
    };
  }

  // ---- data access (service-role) --------------------------------------

  private async appStatus(applicationId: string): Promise<string | null> {
    const { data } = await this.writes.client
      .from('applications')
      .select('status')
      .eq('id', applicationId)
      .maybeSingle<{ status: string | null }>();
    return data?.status ?? null;
  }

  private async currentFields(applicationId: string) {
    const { data, error } = await this.writes.client
      .from('field_provenance')
      .select('field_key, value_snapshot, value_hash, origin, confidence')
      .eq('application_id', applicationId)
      .is('superseded_by', null)
      .order('field_key', { ascending: true });
    if (error) throw new Error(`currentFields failed: ${error.message}`);
    return (data ?? []) as {
      field_key: string;
      value_snapshot: string | null;
      value_hash: string | null;
      origin: string | null;
      confidence: number | null;
    }[];
  }

  private async documents(
    applicationId: string,
  ): Promise<ConsultantReviewDocument[]> {
    const { data, error } = await this.writes.client
      .from('documents')
      .select(
        'id, document_type, file_name, upload_status, ocr_status, created_at',
      )
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`documents failed: ${error.message}`);
    type Row = {
      id: string;
      document_type: string | null;
      file_name: string | null;
      upload_status: string | null;
      ocr_status: string | null;
      created_at: string | null;
    };
    return ((data ?? []) as Row[]).map((d) => ({
      id: d.id,
      type: d.document_type,
      name: d.file_name,
      uploadStatus: d.upload_status,
      ocrStatus: d.ocr_status,
      createdAt: d.created_at,
    }));
  }
}
