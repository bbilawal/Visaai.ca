import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  AttachmentKind,
  MessageAttachment,
  SignedUploadResult,
  VoiceMessage,
} from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AttachmentService } from './attachment.service';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer '))
    throw new BadRequestException('Missing authorization token');
  return authHeader.slice(7);
}

@Controller('messaging')
@UseGuards(JwtGuard)
export class MessagingAttachmentsController {
  constructor(private readonly svc: AttachmentService) {}

  @Post(':applicationId/attachments/upload-url')
  uploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body()
    body: {
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      kind?: AttachmentKind | 'voice';
    },
    @Headers('authorization') auth?: string,
  ): Promise<SignedUploadResult> {
    if (
      !body?.fileName ||
      !body?.mimeType ||
      typeof body?.sizeBytes !== 'number' ||
      !body?.kind
    ) {
      throw new BadRequestException(
        'fileName, mimeType, sizeBytes, kind required',
      );
    }
    return this.svc.createUploadUrl(bearer(auth), user, applicationId, {
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      kind: body.kind,
    });
  }

  @Post(':applicationId/attachments')
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body()
    body: {
      storagePath?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      kind?: AttachmentKind;
      body?: string;
    },
    @Headers('authorization') auth?: string,
  ): Promise<MessageAttachment> {
    if (
      !body?.storagePath ||
      !body?.fileName ||
      !body?.mimeType ||
      typeof body?.sizeBytes !== 'number' ||
      !body?.kind
    ) {
      throw new BadRequestException(
        'storagePath, fileName, mimeType, sizeBytes, kind required',
      );
    }
    return this.svc.confirmAttachment(bearer(auth), user, applicationId, {
      storagePath: body.storagePath,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      kind: body.kind,
      body: body.body,
    });
  }

  @Post(':applicationId/voice')
  confirmVoice(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body()
    body: {
      storagePath?: string;
      mimeType?: string;
      durationMs?: number;
      sizeBytes?: number;
    },
    @Headers('authorization') auth?: string,
  ): Promise<VoiceMessage> {
    if (
      !body?.storagePath ||
      !body?.mimeType ||
      typeof body?.sizeBytes !== 'number'
    ) {
      throw new BadRequestException(
        'storagePath, mimeType, sizeBytes required',
      );
    }
    return this.svc.confirmVoice(bearer(auth), user, applicationId, {
      storagePath: body.storagePath,
      mimeType: body.mimeType,
      durationMs: body.durationMs ?? 0,
      sizeBytes: body.sizeBytes,
    });
  }

  @Get('attachments/:attachmentId/url')
  download(
    @CurrentUser() user: AuthUser,
    @Param('attachmentId') attachmentId: string,
    @Headers('authorization') auth?: string,
  ): Promise<{ url: string }> {
    return this.svc.getDownloadUrl(bearer(auth), user, attachmentId);
  }

  @Get('voice/:voiceId/url')
  voiceUrl(
    @CurrentUser() user: AuthUser,
    @Param('voiceId') voiceId: string,
    @Headers('authorization') auth?: string,
  ): Promise<{ url: string }> {
    return this.svc.getVoiceDownloadUrl(bearer(auth), user, voiceId);
  }
}
