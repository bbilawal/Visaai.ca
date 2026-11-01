import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JwtGuard } from '../auth/jwt.guard';
import { PlanGuard } from '../auth/plan.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.guard';
import { DocTemplatesService } from './doc-templates.service';

@Controller('document-templates')
@UseGuards(JwtGuard, PlanGuard)
export class DocTemplatesController {
  constructor(private readonly templates: DocTemplatesService) {}

  /**
   * The official document checklists, specifications, declaration templates
   * and route guidance this application needs, ready to download.
   *
   * `ParseUUIDPipe` rejects a malformed id with a 400 BEFORE the DB is reached.
   * Without it, Postgres answers 22P02 ("invalid input syntax for type uuid"),
   * which the service correctly treats as a real backend failure — 503, logged
   * at ERROR — since it is not the RLS/no-rows code (PGRST116). That would page
   * on-call for a client-input-shape error. Rejecting the shape at the boundary
   * cannot introduce an enumeration leak either: a malformed string can never
   * coincide with a real UUID, and every well-formed-but-inaccessible id still
   * reaches the service and still collapses to the uniform 404.
   */
  @Get(':applicationId')
  async list(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
  ) {
    return this.templates.listForApplication(db, applicationId, user.id);
  }

  /**
   * Stream the cached artifact. Three segments, so it cannot collide with the
   * single-segment listing route above. The code travels URL-encoded because
   * real codes contain spaces ('IMM 5484').
   */
  @Get(':applicationId/file/:templateCode')
  async file(
    @SupabaseUserClient() db: SupabaseClient,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Param('templateCode') templateCode: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { bytes, filename, contentType } = await this.templates.fileFor(
      db,
      applicationId,
      templateCode,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=900');
    return new StreamableFile(Buffer.from(bytes));
  }
}
