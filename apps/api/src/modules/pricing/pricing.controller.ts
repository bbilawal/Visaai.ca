import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import {
  isCountryInSiteScope,
  isVisaTierInSiteScope,
  readSiteMode,
  type SiteMode,
} from '../../config/site-scope';
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
    @Optional() private readonly config?: ConfigService<Env>,
  ) {}

  private get siteMode(): SiteMode {
    return readSiteMode(this.config);
  }

  /** Canada-only site: refuse any country outside the site's scope. */
  private assertInScope(code: string): void {
    if (!isCountryInSiteScope(this.siteMode, code)) {
      throw new BadRequestException(`Country not served by this site: ${code}`);
    }
  }

  // ---- public (no auth — prices show pre-login, 09) ---------------------

  @Get('quote')
  quote(@Query() query: unknown) {
    const parsed = QuoteQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    this.assertInScope(parsed.data.country);
    return this.pricing.getPublicQuote(
      parsed.data.visaType,
      parsed.data.country,
    );
  }

  @Get('quotes')
  async quotes() {
    const quotes = await this.pricing.listPublicQuotes();
    return quotes.filter(
      (q) =>
        isCountryInSiteScope(this.siteMode, q.country_code) &&
        isVisaTierInSiteScope(this.siteMode, q.visa_type),
    );
  }

  @Get('countries')
  async countries() {
    const countries = await this.pricing.listCountries();
    return countries.filter((c) =>
      isCountryInSiteScope(this.siteMode, c.country_code),
    );
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
    this.assertInScope(countryCode);
    const parsed = UpdateCountryFactorDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.updateCountryFactor(countryCode, parsed.data);
  }
}
