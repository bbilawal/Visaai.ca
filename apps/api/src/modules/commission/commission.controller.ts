import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CommissionService } from './commission.service';
import { CreateCommissionRuleDto } from './commission.dto';

/**
 * Admin CRUD for marketplace commission rules. consultant_commission_rules is
 * admin-only config; every route is admin-gated (JwtGuard resolves appRole,
 * RolesGuard enforces). Splitting itself has no HTTP surface — billing/payouts
 * call CommissionService.splitFor directly.
 */
@Controller('admin/commission-rules')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class CommissionController {
  constructor(private readonly commission: CommissionService) {}

  @Get()
  list() {
    return this.commission.listRules();
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = CreateCommissionRuleDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.commission.createRule(parsed.data);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.commission.deactivateRule(id);
  }
}
