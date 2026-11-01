import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { DocumentsService } from './documents.service';
import type { AuthUser } from '../auth/jwt.guard';

@Controller('documents')
@UseGuards(JwtGuard)
export class DocumentsController {
  constructor(private docs: DocumentsService) {}

  @Post('presign/:applicationId')
  async getPresignedUrl(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: { fileName: string; mimeType: string },
  ) {
    return this.docs.getPresignedUploadUrl(
      db,
      applicationId,
      user.id,
      body.fileName,
      body.mimeType,
    );
  }

  @Post('register/:applicationId')
  async registerDocument(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body()
    body: {
      storagePath: string;
      mimeType: string;
      fileName: string;
      checklistItemId?: string;
    },
  ) {
    return this.docs.registerUploadedDocument(db, {
      applicationId,
      userId: user.id,
      storagePath: body.storagePath,
      mimeType: body.mimeType,
      fileName: body.fileName,
      checklistItemId: body.checklistItemId,
    });
  }

  @Get(':applicationId')
  @SkipThrottle()
  async getDocuments(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.docs.getDocuments(db, applicationId, user.id);
  }

  @Get(':applicationId/access-log')
  async getAccessLog(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.docs.getAccessLog(db, applicationId, user.id);
  }

  @Delete('item/:documentId')
  async deleteDocument(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
  ) {
    return this.docs.deleteDocument(db, documentId, user.id);
  }
}
