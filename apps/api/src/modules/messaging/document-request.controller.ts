import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  DocumentRequest,
  DocumentRequestPriority,
  DocumentRequestStatus,
} from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DocumentRequestService } from './document-request.service';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer '))
    throw new BadRequestException('Missing authorization token');
  return authHeader.slice(7);
}

const PRIORITIES: ReadonlySet<string> = new Set([
  'low',
  'normal',
  'high',
  'urgent',
]);
const STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'submitted',
  'under_review',
  'approved',
  'rejected',
]);

@Controller('messaging')
@UseGuards(JwtGuard)
export class DocumentRequestController {
  constructor(private readonly svc: DocumentRequestService) {}

  @Get(':applicationId/document-requests')
  list(
    @Param('applicationId') applicationId: string,
    @Headers('authorization') auth?: string,
  ): Promise<DocumentRequest[]> {
    return this.svc.list(bearer(auth), applicationId);
  }

  @Post(':applicationId/document-requests')
  create(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body()
    body: {
      documentType?: string;
      label?: string;
      notes?: string;
      dueDate?: string;
      priority?: string;
      checklistItemId?: string;
    },
    @Headers('authorization') auth?: string,
  ): Promise<DocumentRequest> {
    if (!body?.documentType || !body?.label)
      throw new BadRequestException('documentType and label required');
    if (body.priority && !PRIORITIES.has(body.priority))
      throw new BadRequestException(`Invalid priority: ${body.priority}`);
    return this.svc.create(bearer(auth), user, applicationId, {
      documentType: body.documentType,
      label: body.label,
      notes: body.notes,
      dueDate: body.dueDate,
      priority: body.priority as DocumentRequestPriority | undefined,
      checklistItemId: body.checklistItemId,
    });
  }

  @Post('document-requests/:requestId/fulfill')
  fulfill(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() body: { attachmentId?: string },
    @Headers('authorization') auth?: string,
  ): Promise<DocumentRequest> {
    if (!body?.attachmentId)
      throw new BadRequestException('attachmentId required');
    return this.svc.fulfill(bearer(auth), user, requestId, {
      attachmentId: body.attachmentId,
    });
  }

  @Patch('document-requests/:requestId/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('requestId') requestId: string,
    @Body() body: { status?: string },
    @Headers('authorization') auth?: string,
  ): Promise<DocumentRequest> {
    if (!body?.status || !STATUSES.has(body.status))
      throw new BadRequestException(`Invalid status: ${body?.status ?? ''}`);
    return this.svc.setStatus(
      bearer(auth),
      user,
      requestId,
      body.status as DocumentRequestStatus,
    );
  }
}
