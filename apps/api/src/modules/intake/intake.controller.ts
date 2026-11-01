import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AllowAnonymous, JwtGuard } from '../auth/jwt.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { IntakeService } from './intake.service';
import type { AuthUser } from '../auth/jwt.guard';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

// null is a real, meaningful value here: it returns the application to
// discovery mode. `.nullable()` rather than `.optional()` so clearing a route
// is expressible, and a missing key is rejected instead of silently clearing.
const SetVisaTypeDto = z.object({
  visaTypeId: z.string().uuid().nullable(),
});

const CreateApplicationDto = z.object({
  country: z.string().min(2).max(16).optional(),
  state: z.string().max(64).optional(),
  frameworkId: z.string().max(64).optional(),
});

// Public intake surface: guests (anonymous Supabase identities) complete the AI
// interview before creating an account. JwtGuard still runs — every request is a
// real authenticated (possibly anonymous) identity, and RLS scopes all data to
// that uid. @AllowAnonymous opts this controller out of the fail-closed anonymous
// rejection; every other controller stays gated.
@Controller('intake')
@UseGuards(JwtGuard)
@AllowAnonymous()
export class IntakeController {
  constructor(private intake: IntakeService) {}

  @Post('applications')
  async createApplication(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(CreateApplicationDto, rawBody);
    const applicationId = await this.intake.createApplication(db, user.id, {
      country: body.country,
      state: body.state,
      frameworkId: body.frameworkId,
    });
    return { applicationId };
  }

  @Get('applications/:applicationId')
  async getApplication(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    // SEC-102: returning the raw result answered 200 with an EMPTY body when the
    // row was invisible under the caller's RLS scope — a client cannot tell that
    // from a real record, and JSON-parsing an empty body breaks it. Deny
    // explicitly, matching every other ownership check in the module. A
    // nonexistent id answers identically, so this is not an existence oracle.
    const app = await this.intake.getApplication(db, applicationId, user.id);
    if (!app) throw new ForbiddenException('Access denied');
    return app;
  }

  @Get('applications/:applicationId/visa-types')
  async listVisaTypes(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.intake.listVisaTypesForApplication(db, applicationId, user.id);
  }

  @Patch('applications/:applicationId/visa-type')
  async setVisaType(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(SetVisaTypeDto, rawBody);
    return this.intake.setVisaType(db, applicationId, user.id, body.visaTypeId);
  }

  @Get('applications/:applicationId/checklist')
  async getChecklist(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.intake.getChecklist(db, applicationId, user.id);
  }

  /**
   * Regenerate the checklist and return it.
   *
   * Separate verb from the GET on purpose: this one can spend a structured
   * generation, and a GET that quietly costs money is a trap for the next
   * caller. The documents surface calls it on open — the first moment the list
   * is actually read — instead of the interview rebuilding it every turn.
   */
  @Post('applications/:applicationId/checklist/rebuild')
  @HttpCode(200)
  async rebuildChecklist(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Headers('accept') accept: string | undefined,
    @Res() res: Response,
  ) {
    // Streaming is OPT-IN, on the Accept header, on the same route.
    //
    // The generation takes 9-21s and for a route whose registry has no
    // document-kind requirements it is the only thing that fills the vault, so
    // an applicant who has just picked one sits in front of an empty page for
    // all of it. A client that asks for NDJSON is fed each item as the model
    // finishes writing it.
    //
    // Same URL, same method, same verb semantics: a caller that does not ask
    // for it — the mobile app, the tests, anything already deployed — gets the
    // single JSON array it has always got.
    // `@Res()` without `passthrough` on purpose. The streaming branch ends the
    // response itself, and Nest's passthrough handling would then try to send
    // again on a finished response — so this method owns the response on BOTH
    // branches. Exceptions thrown before anything is written still reach the
    // exception filter, which is what keeps 403 a 403.
    if (!accept?.includes('application/x-ndjson')) {
      const items = await this.intake.rebuildChecklist(
        db,
        applicationId,
        user.id,
      );
      res.status(200).json(items);
      return;
    }

    // Headers go out with the FIRST line, not before it. Until something is
    // written the response still belongs to Nest, so an authorization failure
    // is still a 403 rather than a 200 carrying an apology — `rebuildChecklist`
    // checks ownership before it does any work, so that is the common case.
    let started = false;
    const write = (payload: unknown) => {
      if (res.writableEnded) return;
      if (!started) {
        started = true;
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        // The proxy in front of this buffers by default, which would hold every
        // line back until the response ended and defeat the whole exercise.
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
      }
      res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      const items = await this.intake.rebuildChecklist(
        db,
        applicationId,
        user.id,
        (partial) => write({ type: 'items', items: partial }),
      );
      // The authoritative list, always last. Previews carry no database id —
      // they are what the model wrote, not what was stored — so the client
      // replaces rather than merges.
      write({ type: 'done', items });
    } catch (err) {
      // Nothing sent yet means the status line is still ours: let Nest map the
      // exception, so 403 stays 403.
      if (!started) throw err;
      // Otherwise the status is long gone and the failure has to be reported
      // inside the stream, so a client holding only previews and no terminator
      // does not mistake them for the finished list.
      write({
        type: 'error',
        message: err instanceof Error ? err.message : 'rebuild failed',
      });
    } finally {
      if (started) res.end();
    }
  }

  @Get('applications/:applicationId/messages')
  async getMessages(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.intake.getMessages(db, applicationId, user.id);
  }
}
