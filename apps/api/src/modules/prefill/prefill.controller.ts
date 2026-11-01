import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PrefilledFormField } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { PlanGuard } from '../auth/plan.guard';
import {
  CurrentUser,
  SupabaseUserClient,
} from '../auth/current-user.decorator';
import { PrefillService } from './prefill.service';
import type { AuthUser } from '../auth/jwt.guard';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

/** Mirrors PrefilledFormField. */
const PrefilledFieldDto = z.object({
  key: z.string().min(1),
  label: z.string(),
  value: z.string(),
  group: z.string().optional(),
  // Accepted (old clients send back what they loaded, including
  // 'consultant') but IGNORED: the server decides the source.
  source: z.string().optional(),
  note: z.string().optional(),
  needsReview: z.boolean().optional(),
});
const UpdateFieldsDto = z.object({
  fields: z.array(PrefilledFieldDto),
  /** `version` from GET /prefill/:id — a save from an older copy is a 409. */
  baseVersion: z.string().optional(),
});

@Controller('prefill')
@UseGuards(JwtGuard, PlanGuard)
export class PrefillController {
  constructor(private prefill: PrefillService) {}

  // Generating/previewing the prefilled form is free; only downloading and
  // portal auto-fill require the one-time form fee (enforced in the service).
  @Post(':applicationId/generate')
  async generate(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.prefill.generate(db, applicationId, user.id);
  }

  @Get(':applicationId')
  async get(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.prefill.get(db, applicationId, user.id);
  }

  @Patch(':applicationId/fields')
  async updateFields(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() rawBody: unknown,
  ) {
    const body = parseBody(UpdateFieldsDto, rawBody);
    return this.prefill.updateFields(
      db,
      applicationId,
      user.id,
      body.fields as PrefilledFormField[],
      body.baseVersion,
    );
  }

  @Post(':applicationId/approve')
  async approve(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.prefill.approve(db, applicationId, user.id);
  }

  @Get(':applicationId/pdf')
  async getPdf(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Res() res: Response,
  ) {
    const bytes = await this.prefill.getPdf(db, applicationId, user.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="visaai-prefilled-${applicationId}.pdf"`,
    );
    res.send(Buffer.from(bytes));
  }

  @Get(':applicationId/fill-instructions')
  async getFillInstructions(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.prefill.getFillInstructions(db, applicationId, user.id);
  }

  @Get(':applicationId/official-forms')
  async listOfficialForms(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.prefill.listAvailableOfficialForms(db, applicationId, user.id);
  }

  @Get(':applicationId/official-pdf/:formCode')
  async getOfficialPdf(
    @SupabaseUserClient() db: SupabaseClient,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('formCode') formCode: string,
    @Res() res: Response,
  ) {
    const bytes = await this.prefill.getOfficialPdf(
      db,
      applicationId,
      user.id,
      formCode,
    );
    const safeCode = formCode.replace(/[^A-Za-z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="visaai-${safeCode}-${applicationId}.pdf"`,
    );
    res.send(Buffer.from(bytes));
  }
}
