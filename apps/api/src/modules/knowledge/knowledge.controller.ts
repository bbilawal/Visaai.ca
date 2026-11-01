/**
 * The public read surface of the visa knowledge system.
 *
 * Two endpoints, and the split between them is the safety boundary:
 *
 *   POST /knowledge/search  returns PASSAGES. Every result is verbatim
 *                           government text with a citation. No model runs.
 *   POST /knowledge/answer  returns a GENERATED answer. A model runs, and
 *                           every claim it makes has been verified against the
 *                           passages before it reaches this response.
 *
 * Both are authenticated. The corpus itself is public government text and
 * `anon` can read `kb_chunks` through PostgREST, but similarity search with a
 * caller-supplied query is a compute-bound operation and must not be available
 * at anonymous rate limits — that is a cost amplification vector, not a
 * disclosure one.
 */
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtGuard, type AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeAnswerService } from './knowledge-answer.service';
import { KnowledgeFreshnessService } from './knowledge-freshness.service';
import { KnowledgeSearchDto, KnowledgeAnswerDto } from './knowledge.dto';

@Controller('knowledge')
@UseGuards(JwtGuard)
export class KnowledgeController {
  constructor(
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly answers: KnowledgeAnswerService,
    private readonly freshness: KnowledgeFreshnessService,
  ) {}

  /**
   * Retrieve official passages.
   *
   * Rate-limited harder than the default: each call is an embedding request
   * plus a vector scan, so it is two orders of magnitude more expensive than
   * an ordinary read and must be metered as such.
   */
  @Post('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async search(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = KnowledgeSearchDto.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'invalid request',
      );
    const dto = parsed.data;

    const result = await this.retrieval.search(
      dto.query,
      {
        countryId: dto.countryId,
        visaTypeId: dto.visaTypeId,
        nationality: dto.nationality,
        languages: dto.languages,
        asOf: dto.asOf,
        // A caller cannot ask for superseded content on the public surface.
        // Historical lookups are an admin capability: superseded text served
        // to an applicant reads as current, and no amount of labelling in the
        // response reliably prevents that.
        includeSuperseded: false,
        sourceRoles: dto.sourceRoles,
      },
      { limit: dto.limit, userId: user.id },
    );

    return {
      strategy: result.strategy,
      degraded: result.degraded ?? null,
      formCodes: result.formCodes,
      latencyMs: result.latencyMs,
      results: result.chunks.map((c) => ({
        id: c.chunkId,
        text: c.text,
        score: c.score,
        headingPath: c.headingPath,
        pageNumber: c.pageNumber,
        formCodes: c.formCodes,
        language: c.language,
        citation: c.citation,
      })),
    };
  }

  /** Generate a grounded, cited answer — or refuse. */
  @Post('answer')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async answer(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = KnowledgeAnswerDto.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'invalid request',
      );
    const dto = parsed.data;

    return this.answers.answer({
      question: dto.question,
      filters: {
        countryId: dto.countryId,
        visaTypeId: dto.visaTypeId,
        nationality: dto.nationality,
        languages: dto.languages,
        includeSuperseded: false,
      },
      userId: user.id,
      applicationId: dto.applicationId,
      evidenceLimit: dto.evidenceLimit,
    });
  }

  /**
   * What the corpus can answer about, per country and visa type.
   *
   * Public (to a signed-in user) rather than admin-only on purpose: a user
   * about to ask a question deserves to know the system holds nothing about
   * their route, rather than getting a refusal that reads like a failure.
   */
  @Get('coverage')
  async coverage(@Query('country') country?: string) {
    const report = await this.freshness.coverageReport();
    if (!country) {
      return {
        generatedAt: report.generatedAt,
        supportedCountries: report.supportedCountries,
        supportedVisaTypes: report.supportedVisaTypes,
        visaTypesWithSources: report.visaTypesWithSources,
        visaTypesWithChunks: report.visaTypesWithChunks,
        totals: report.totals,
      };
    }
    const code = country.toUpperCase();
    return {
      generatedAt: report.generatedAt,
      country: code,
      rows: report.rows.filter((r) => r.countryCode === code),
    };
  }
}
