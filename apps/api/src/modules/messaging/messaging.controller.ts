import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AppNotification,
  ConsultantState,
  ConversationStatus,
  ConversationThread,
  GlobalMessageSearchResult,
  Message,
  MessageCategory,
  MessagePage,
} from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MessagingService } from './messaging.service';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new BadRequestException('Missing authorization token');
  }
  return authHeader.slice(7);
}

const CATEGORIES: ReadonlySet<string> = new Set([
  'general',
  'documents',
  'eligibility',
  'application_status',
  'payment',
  'travel_history',
  'biometrics',
  'medical',
  'other',
]);
const STATUSES: ReadonlySet<string> = new Set([
  'open',
  'resolved',
  'closed',
  'archived',
]);
const CONSULTANT_STATES: ReadonlySet<string> = new Set([
  'pending_user_response',
  'waiting_documents',
  'under_review',
  'resolved',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('messaging')
@UseGuards(JwtGuard)
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  @Get('notifications')
  notifications(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<AppNotification[]> {
    return this.svc.listNotifications(bearer(auth), user);
  }

  @Post('notifications/read')
  async readNotifications(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    await this.svc.markNotificationsRead(bearer(auth), user);
    return { ok: true };
  }

  @Get('search')
  searchAll(
    @CurrentUser() user: AuthUser,
    @Query('q') q: string | undefined,
    @Headers('authorization') auth?: string,
  ): Promise<GlobalMessageSearchResult[]> {
    return this.svc.searchAllConversations(bearer(auth), user, q ?? '');
  }

  @Get(':applicationId/search')
  @UseGuards(ApplicationAccessGuard)
  search(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Query('q') q: string | undefined,
    @Headers('authorization') auth?: string,
  ): Promise<Message[]> {
    return this.svc.searchInConversation(
      bearer(auth),
      user,
      applicationId,
      q ?? '',
    );
  }

  @Get(':applicationId/messages')
  @UseGuards(ApplicationAccessGuard)
  olderMessages(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Query('before') before: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('authorization') auth?: string,
  ): Promise<MessagePage> {
    return this.svc.listOlderMessages(
      bearer(auth),
      user,
      applicationId,
      before ?? '',
      Number(limit),
    );
  }

  @Get(':applicationId')
  @UseGuards(ApplicationAccessGuard)
  thread(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Headers('authorization') auth?: string,
  ): Promise<ConversationThread> {
    return this.svc.getThread(bearer(auth), user, applicationId);
  }

  @Post(':applicationId/messages')
  @UseGuards(ApplicationAccessGuard)
  postMessage(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body()
    body: {
      body?: string;
      category?: string;
      parentMessageId?: string | null;
      clientId?: string | null;
    },
    @Headers('authorization') auth?: string,
  ): Promise<{ id: string }> {
    const text = body?.body?.trim();
    if (!text) throw new BadRequestException('Message body is required');
    const category = body?.category ?? 'general';
    if (!CATEGORIES.has(category)) {
      throw new BadRequestException(`Invalid category: ${category}`);
    }
    // Optional idempotency key. Constrained to a UUID: the column is uuid, so a
    // free-form string would fail at the database with an opaque 500 instead of
    // a clear 400.
    const clientId = body?.clientId ?? null;
    if (clientId !== null && !UUID_RE.test(clientId)) {
      throw new BadRequestException('clientId must be a UUID');
    }
    return this.svc.postMessage(bearer(auth), user, applicationId, {
      body: text,
      category: category as MessageCategory,
      parentMessageId: body?.parentMessageId ?? null,
      clientId,
    });
  }

  @Post(':applicationId/read')
  @UseGuards(ApplicationAccessGuard)
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    await this.svc.markRead(bearer(auth), user, applicationId);
    return { ok: true };
  }

  @Patch(':applicationId/status')
  @UseGuards(ApplicationAccessGuard)
  async setStatus(
    @Param('applicationId') applicationId: string,
    @Body() body: { status?: string },
    @Headers('authorization') auth?: string,
  ): Promise<{ status: ConversationStatus }> {
    const status = body?.status;
    if (!status || !STATUSES.has(status)) {
      throw new BadRequestException(`Invalid status: ${status ?? ''}`);
    }
    const updated = await this.svc.setStatus(
      bearer(auth),
      applicationId,
      status as ConversationStatus,
    );
    return { status: updated.status };
  }

  @Patch(':applicationId/consultant-state')
  @UseGuards(ApplicationAccessGuard)
  async setConsultantState(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: { state?: string },
    @Headers('authorization') auth?: string,
  ): Promise<{ state: ConsultantState }> {
    if (!body?.state || !CONSULTANT_STATES.has(body.state)) {
      throw new BadRequestException(`Invalid state: ${body?.state ?? ''}`);
    }
    await this.svc.setConsultantState(
      bearer(auth),
      user,
      applicationId,
      body.state as ConsultantState,
    );
    return { state: body.state as ConsultantState };
  }

  @Post(':applicationId/typing')
  @UseGuards(ApplicationAccessGuard)
  async typing(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    // get-or-create handled in getThread; here resolve recipients + conversation
    const thread = await this.svc.getThread(bearer(auth), user, applicationId);
    const recipients = await this.svc.recipientIds(applicationId, user.id);
    this.svc.emitTyping(thread.conversation.id, applicationId, recipients);
    return { ok: true };
  }
}
