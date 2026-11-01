import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationsService, type OrgCaller } from './organizations.service';
import {
  AcceptInviteDto,
  CreateOrgDto,
  InviteMemberDto,
  UpdateMemberDto,
  UpdateOrgDto,
} from './iam.dto';

/**
 * Organizations API — orgs, team members, invitations. Authenticated; the
 * service enforces org-scoped authorization (platform admin OR active
 * org_admin/member of the specific org).
 */
@Controller('organizations')
@UseGuards(JwtGuard)
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  private caller(user: AuthUser): OrgCaller {
    return { id: user.id, email: user.email, appRole: user.appRole };
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = CreateOrgDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.orgs.create(this.caller(user), parsed.data.name);
  }

  @Get()
  listMine(@CurrentUser() user: AuthUser) {
    return this.orgs.listMine(this.caller(user));
  }

  /** Accept an invitation (token in body); must precede the :id routes by path. */
  @Post('invitations/accept')
  accept(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = AcceptInviteDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.orgs.acceptInvitation(this.caller(user), parsed.data.token);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orgs.get(this.caller(user), id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = UpdateOrgDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.orgs.update(this.caller(user), id, parsed.data);
  }

  // ---- members ----
  @Get(':id/members')
  members(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orgs.listMembers(this.caller(user), id);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = UpdateMemberDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.orgs.updateMemberRole(
      this.caller(user),
      id,
      userId,
      parsed.data,
    );
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orgs.removeMember(this.caller(user), id, userId);
  }

  // ---- invitations ----
  @Post(':id/invitations')
  invite(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = InviteMemberDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.orgs.invite(
      this.caller(user),
      id,
      parsed.data.email,
      parsed.data.role,
    );
  }

  @Get(':id/invitations')
  invitations(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orgs.listInvitations(this.caller(user), id);
  }

  @Delete(':id/invitations/:invId')
  revokeInvitation(
    @Param('id') id: string,
    @Param('invId') invId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orgs.revokeInvitation(this.caller(user), id, invId);
  }
}
