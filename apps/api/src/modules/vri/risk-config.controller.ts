import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { RiskConfigService } from './risk-config.service';
import {
  DimensionParamDto,
  UpdateThresholdDto,
  UpdateWeightDto,
} from './risk-config.dto';

/**
 * Admin-only config CRUD for the risk scorer. Mirrors pricing.controller's admin
 * endpoints: Zod-validated, behind JwtGuard + RolesGuard('admin'). There is no
 * public surface here — unlike prices, scoring internals must not be exposed.
 */
@Controller('admin/risk-config')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class RiskConfigController {
  constructor(private readonly service: RiskConfigService) {}

  @Get('weights')
  async getWeights() {
    const { weights } = await this.service.getSnapshot();
    return weights;
  }

  @Get('thresholds')
  async getThresholds() {
    const { thresholds } = await this.service.getSnapshot();
    return thresholds;
  }

  @Put('weights/:dimension')
  updateWeight(@Param('dimension') dimension: string, @Body() body: unknown) {
    const dim = DimensionParamDto.safeParse(dimension);
    if (!dim.success) throw new BadRequestException(dim.error.flatten());
    const parsed = UpdateWeightDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.service.updateWeight(dim.data, parsed.data.value);
  }

  @Put('thresholds/:key')
  updateThreshold(@Param('key') key: string, @Body() body: unknown) {
    const parsed = UpdateThresholdDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.service.updateThreshold(key, parsed.data.value);
  }
}
