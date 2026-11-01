import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { PricingService } from './pricing.service';
import { PricingAdminService } from './pricing-admin.service';
import {
  QuoteQueryDto,
  UpdateConstantDto,
  UpdateCountryFactorDto,
  UpdateVisaTierDto,
} from './pricing.dto';

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly admin: PricingAdminService,
  ) {}

  // ---- public (no auth — prices show pre-login, 09) ---------------------

  @Get('quote')
  quote(@Query() query: unknown) {
    const parsed = QuoteQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.pricing.getPublicQuote(
      parsed.data.visaType,
      parsed.data.country,
    );
  }

  @Get('quotes')
  quotes() {
    return this.pricing.listPublicQuotes();
  }

  @Get('countries')
  countries() {
    return this.pricing.listCountries();
  }

  @Get('visas')
  visas() {
    return this.pricing.listVisas();
  }

  // ---- admin config CRUD (JwtGuard resolves appRole; RolesGuard enforces) ----

  @Put('admin/constants/:key')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('admin')
  updateConstant(@Param('key') key: string, @Body() body: unknown) {
    const parsed = UpdateConstantDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.updateConstant(key, parsed.data.value);
  }

  @Put('admin/visa-tiers/:visaType')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('admin')
  updateVisaTier(@Param('visaType') visaType: string, @Body() body: unknown) {
    const parsed = UpdateVisaTierDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.updateVisaTier(visaType, parsed.data);
  }

  @Put('admin/country-factors/:countryCode')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('admin')
  updateCountryFactor(
    @Param('countryCode') countryCode: string,
    @Body() body: unknown,
  ) {
    const parsed = UpdateCountryFactorDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.updateCountryFactor(countryCode, parsed.data);
  }
}
