import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { PartnerTokenResponse } from '@visaai/types';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OAuthException } from './partner-errors';
import { PartnerExceptionFilter } from './partner-exception.filter';
import { PartnerOAuthService } from './partner-oauth.service';
import { PartnerConsentService } from './partner-consent.service';
import { parseScopeString } from './partner-scopes';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new OAuthException(
      400,
      'invalid_request',
      `${first?.path.join('.') ?? 'request'}: ${first?.message ?? 'invalid'}`,
    );
  }
  return result.data;
}

const TokenRequestDto = z.object({
  grant_type: z.string(),
  client_id: z.string().min(1).max(128),
  client_secret: z.string().min(1).max(256).optional(),
  scope: z.string().max(1024).optional(),
  code: z.string().max(512).optional(),
  redirect_uri: z.string().max(2048).optional(),
  code_verifier: z.string().max(256).optional(),
});

const RevokeRequestDto = z.object({
  client_id: z.string().min(1).max(128),
  client_secret: z.string().min(1).max(256),
  token: z.string().min(1).max(512),
});

const AuthorizeQueryDto = z.object({
  client_id: z.string().min(1).max(128),
  redirect_uri: z.string().min(1).max(2048),
  scope: z.string().max(1024).optional(),
  state: z.string().max(512).optional(),
});

const ApproveDto = AuthorizeQueryDto.extend({
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
});

/**
 * OAuth 2.0 endpoints.
 *
 * Under `/partner/oauth`, deliberately outside `/v1`: the authorization
 * server's contract is RFC 6749, not ours, and versioning it alongside our
 * resource API would imply we can change it. We cannot — every OAuth client
 * library in existence assumes these shapes.
 *
 * Token and revoke are throttled per IP on top of the partner rate limits,
 * because these are the endpoints reachable BEFORE authentication and are
 * therefore the credential-stuffing surface.
 */
@Controller('partner/oauth')
@UseFilters(PartnerExceptionFilter)
export class PartnerOAuthController {
  constructor(
    private readonly oauth: PartnerOAuthService,
    private readonly consent: PartnerConsentService,
  ) {}

  @Post('token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async token(@Body() body: unknown): Promise<PartnerTokenResponse> {
    const input = parse(TokenRequestDto, body ?? {});

    if (input.grant_type === 'client_credentials') {
      if (!input.client_secret) {
        throw new OAuthException(
          401,
          'invalid_client',
          'client_secret is required for the client_credentials grant.',
        );
      }
      return this.oauth.clientCredentials(
        input.client_id,
        input.client_secret,
        input.scope,
      );
    }

    if (input.grant_type === 'authorization_code') {
      if (!input.code || !input.redirect_uri || !input.code_verifier) {
        throw new OAuthException(
          400,
          'invalid_request',
          'code, redirect_uri and code_verifier are all required for the authorization_code grant.',
        );
      }
      return this.oauth.exchangeAuthorizationCode(
        input.client_id,
        input.client_secret,
        input.code,
        input.redirect_uri,
        input.code_verifier,
      );
    }

    // Named explicitly so the refusal is a documented decision rather than a
    // generic "unsupported": the password grant hands a partner the user's
    // VisaAI password, and no amount of partner trust makes that acceptable.
    if (input.grant_type === 'password') {
      throw new OAuthException(
        400,
        'unsupported_grant_type',
        'The resource owner password credentials grant is not supported and will not be. Use authorization_code with PKCE.',
      );
    }

    throw new OAuthException(
      400,
      'unsupported_grant_type',
      `Unsupported grant_type '${input.grant_type}'. Supported: client_credentials, authorization_code.`,
    );
  }

  @Post('revoke')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async revoke(@Body() body: unknown): Promise<Record<string, never>> {
    const input = parse(RevokeRequestDto, body ?? {});
    await this.oauth.revoke(input.client_id, input.client_secret, input.token);
    // RFC 7009: success regardless, so this endpoint cannot be used to test
    // whether a stolen token is still live.
    return {};
  }

  /**
   * Consent metadata for the approval screen. Requires a signed-in VisaAI
   * user: the user's identity comes from their own session, never from the
   * partner's request.
   */
  @Get('authorize')
  @UseGuards(JwtGuard)
  describeAuthorization(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<Record<string, unknown>> {
    const input = parse(AuthorizeQueryDto, query ?? {});
    return this.consent.describe(
      input.client_id,
      input.redirect_uri,
      parseScopeString(input.scope),
      user.id,
    );
  }

  /** The user approved. Issues the authorization code. */
  @Post('authorize')
  @UseGuards(JwtGuard)
  async approve(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<{ code: string; redirect_uri: string; state: string | null }> {
    const input = parse(ApproveDto, body ?? {});
    const { code } = await this.oauth.issueAuthorizationCode(
      input.client_id,
      user.id,
      input.redirect_uri,
      parseScopeString(input.scope),
      input.code_challenge,
      input.code_challenge_method,
    );
    return {
      code,
      redirect_uri: input.redirect_uri,
      state: input.state ?? null,
    };
  }
}
