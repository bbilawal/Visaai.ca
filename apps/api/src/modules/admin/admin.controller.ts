import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminService } from './admin.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminUsersService } from './admin-users.service';
import { AssignmentService } from '../consultant/assignment.service';
import {
  AssignConsultantDto,
  AuditQueryDto,
  ListApplicationsQueryDto,
  ListUsersV2Dto,
  BulkUsersDto,
  SetConsultantCountriesDto,
  SetDeadlineDto,
  SetUserRoleDto,
  UserReasonDto,
} from './admin.dto';

import { RegistryOpsService } from './registry-ops.service';

/**
 * Admin API — every route is admin-only (JwtGuard resolves appRole, RolesGuard
 * enforces 'admin'). Delegates to services only. No DB access here.
 */
@Controller('admin')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly assignment: AssignmentService,
    private readonly dashboard: AdminDashboardService,
    private readonly adminUsers: AdminUsersService,
    private readonly registryOps_: RegistryOpsService,
  ) {}

  /** Phase-1 executive dashboard aggregate. range ∈ 7d|30d|90d (default 30d). */
  @Get('dashboard')
  getDashboard(@Query('range') range?: string) {
    return this.dashboard.getDashboard(
      AdminDashboardService.coerceRange(range),
    );
  }

  @Get('users')
  users(@Query() query: unknown) {
    const parsed = ListUsersV2Dto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.adminUsers.listUsers(parsed.data);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminUsers.getUserDetail(id);
  }

  /** All consultant users (for admin assignment pickers). */
  @Get('consultants')
  consultants() {
    return this.admin.listConsultants();
  }

  @Post('users/bulk')
  bulkUsers(@Body() body: unknown, @CurrentUser() u: AuthUser) {
    const parsed = BulkUsersDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.adminUsers.bulk(parsed.data, u.id);
  }

  /** Active ISO-2 codes a consultant covers. */
  @Get('users/:id/countries')
  async getCountries(@Param('id') id: string) {
    const codes = await this.assignment.getConsultantCountries(id);
    return { codes };
  }

  /** Replace a consultant's covered country set (upsert active + deactivate rest). */
  @Put('users/:id/countries')
  async setCountries(@Param('id') id: string, @Body() body: unknown) {
    const parsed = SetConsultantCountriesDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const codes = await this.assignment.setConsultantCountries(
      id,
      parsed.data.codes,
    );
    return { codes };
  }

  @Post('users/:id/role')
  setRole(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = SetUserRoleDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.setRole(id, parsed.data.role, user.id);
  }

  /**
   * §74 registry visibility: pending reviews, sync failures, stale sources,
   * provenance. Read-only — acting on a review still goes through the promotion
   * path, because a one-click activate here would make the queue decorative.
   */
  @Get('registry-ops')
  registryOps() {
    return this.registryOps_.get();
  }

  @Get('audit-logs')
  auditLogs(@Query() query: unknown) {
    const parsed = AuditQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.admin.recentAuditLogs(
      parsed.data.applicationId,
      parsed.data.limit ?? 100,
    );
  }

  // ---- application assignment (admin) ----------------------------------

  /** All applications + derived assignment status + assignee + date. */
  @Get('applications')
  applications(@Query() query: unknown) {
    const parsed = ListApplicationsQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.assignment.listAllForAdmin({
      status: parsed.data.status,
      country: parsed.data.country,
      q: parsed.data.q,
      assignee: parsed.data.assignee,
      assignmentStatus: parsed.data.assignmentStatus,
      deadlineFrom: parsed.data.deadlineFrom,
      deadlineTo: parsed.data.deadlineTo,
    });
  }

  /** Assign an UNASSIGNED application to a consultant (409 if already active). */
  @Post('applications/:id/assign')
  assign(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = AssignConsultantDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.assignment.adminAssign(id, parsed.data.consultantId, user.id);
  }

  /** Reassign to a new consultant (release current + assign new; history kept). */
  @Post('applications/:id/reassign')
  reassign(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = AssignConsultantDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.assignment.adminReassign(id, parsed.data.consultantId, user.id);
  }

  /**
   * Set/override the consultant review deadline. Accepts an absolute datetime
   * (`{ dueAt }`) or a relative window (`{ hours }`, back-compat). Exactly one.
   */
  @Post('applications/:id/deadline')
  setDeadline(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = SetDeadlineDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (parsed.data.dueAt !== undefined) {
      return this.assignment.setDeadlineAt(id, parsed.data.dueAt, user.id);
    }
    return this.assignment.setDeadline(id, parsed.data.hours!, user.id);
  }

  /** Remove ownership -> application returns to UNASSIGNED. */
  @Post('applications/:id/unassign')
  async unassign(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.assignment.unassign(id, user.id);
    return { released: true };
  }

  /** Add a BACKUP consultant to an application (full-access coverage). */
  @Post('applications/:id/backups')
  addBackup(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = AssignConsultantDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.assignment.adminAddBackup(
      id,
      parsed.data.consultantId,
      user.id,
    );
  }

  /** Remove a BACKUP consultant. */
  @Delete('applications/:id/backups/:consultantId')
  async removeBackup(
    @Param('id') id: string,
    @Param('consultantId') consultantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assignment.adminRemoveBackup(id, consultantId, user.id);
    return { removed: true };
  }

  /** Promote an active backup to primary. */
  @Post('applications/:id/promote')
  async promote(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = AssignConsultantDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.assignment.adminPromote(id, parsed.data.consultantId, user.id);
    return { promoted: true };
  }

  // ---- user lifecycle (admin) ------------------------------------------

  @Post('users/:id/suspend')
  suspend(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() u: AuthUser,
  ) {
    const parsed = UserReasonDto.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.adminUsers.suspend(id, u.id, parsed.data.reason);
  }

  @Post('users/:id/reactivate')
  reactivate(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.adminUsers.reactivate(id, u.id);
  }

  @Post('users/:id/soft-delete')
  softDelete(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() u: AuthUser,
  ) {
    const parsed = UserReasonDto.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.adminUsers.softDelete(id, u.id, parsed.data.reason);
  }

  @Post('users/:id/restore')
  restore(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.adminUsers.restore(id, u.id);
  }

  @Post('users/:id/reset-password')
  resetPassword(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.adminUsers.resetPassword(id, u.id);
  }
}
