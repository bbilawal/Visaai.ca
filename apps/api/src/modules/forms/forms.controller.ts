import {
  Controller,
  Get,
  Header,
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
import { FormsService } from './forms.service';

@Controller('forms')
@UseGuards(JwtGuard, PlanGuard)
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  /**
   * The blank official forms this application needs, ready to download.
   *
   * `ParseUUIDPipe` rejects a malformed `applicationId` with a 400 BEFORE the
   * DB is ever reached. Review round 2, Finding 5: without this, a malformed
   * id produced Postgres error 22P02 ("invalid input syntax for type uuid"),
   * which FormsService's round-1 fix (Finding 2) correctly treats as a real
   * backend failure — 503, logged at ERROR — since it isn't the RLS/no-rows
   * code (PGRST116). That made a client-input-shape error page the on-call
   * exactly like a genuine DB outage. Rejecting the shape here, at the
   * boundary, is the correct layer: a malformed string can never coincide
   * with a real UUID, so this cannot introduce an enumeration leak, and every
   * well-formed-but-inaccessible UUID still reaches FormsService and still
   * collapses to the uniform 404 (RLS-hidden and genuinely-absent look
   * identical, by design).
   *
   * No `version` pinned: `applications.id` is `uuid_generate_v4()`, and
   * `ParseUUIDPipe`'s default (`version` unset) uses the broadest check
   * (any RFC 4122 UUID shape) — a superset of v4, not a stricter one — so it
   * accepts every id this app actually generates. MEASURED against
   * @nestjs/common 11.1.24's source and in forms.controller.spec.ts.
   */
  @Get(':applicationId')
  async list(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
  ) {
    return this.forms.listForApplication(db, applicationId, user.id);
  }

  /**
   * Stream the cached blank form.
   *
   * Declared AFTER `:applicationId` above but cannot collide with it: this path
   * has three segments and that one has one.
   *
   * The form code travels URL-encoded ('IMM%205257') because real codes contain
   * spaces; Nest decodes the param, so the service compares against the catalog
   * spelling unchanged.
   */
  @Get(':applicationId/file/:formCode')
  @Header('Content-Type', 'application/pdf')
  async file(
    @SupabaseUserClient() db: SupabaseClient,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Param('formCode') formCode: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { bytes, filename } = await this.forms.fileFor(
      db,
      applicationId,
      formCode,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Blank government forms are identical for every applicant, but the URL is
    // per-application, so this is private-cacheable only.
    res.setHeader('Cache-Control', 'private, max-age=900');
    return new StreamableFile(Buffer.from(bytes));
  }
}
